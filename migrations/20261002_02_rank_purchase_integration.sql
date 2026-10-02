-- Requires 01 and the existing purchase RPCs. This adapter keeps their minute,
-- roulette, pack and payment behavior, replacing only their Coins input.
-- Review the real RPC definitions before deployment (not included in the input ZIP).
begin;
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.cliente_confirmar_compra_ruleta_v3(jsonb)',
    'public.cliente_confirmar_compra_ruleta_v2(jsonb)',
    'public.cliente_confirmar_compra_promocion_v1(uuid)',
    'public.crm_register_call_atomic_v8(jsonb)'
  ] loop
    if to_regprocedure(signature) is null then raise exception 'MISSING_PURCHASE_RPC: %',signature; end if;
    select lower(pg_get_functiondef(to_regprocedure(signature))) into definition;
    if definition ~ 'tc_client_rank_benefits|tc_apply.*benefit|tc_grant.*benefit' then
      raise exception 'EXISTING_RANK_GRANT_REQUIRES_REVIEW: %',signature;
    end if;
    execute 'revoke all on function '||signature||' from public,anon,authenticated';
    execute 'grant execute on function '||signature||' to service_role';
  end loop;
end $$;

-- Idempotency receipts, not a second balance/Coins ledger. Existing RPCs still
-- credit crm_clientes.puntos and write their existing histories in this transaction.
create table if not exists public.tc_rank_purchase_receipts (
  operation_key text primary key,
  cliente_id uuid not null references public.crm_clientes(id),
  rank_key text references public.tc_client_rank_benefits(rank_key),
  coins integer not null check(coins>=0),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.tc_rank_purchase_receipts enable row level security;
revoke all on public.tc_rank_purchase_receipts from public,anon,authenticated;
grant all on public.tc_rank_purchase_receipts to service_role;

create or replace function public.tc_confirm_rank_purchase(p_kind text,p jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare client_id uuid; v_operation_key text; benefit jsonb; outcome jsonb; receipt public.tc_rank_purchase_receipts;
  attempt public.cliente_payment_attempts; payment public.crm_cliente_pagos; coin_amount integer; starting_points bigint; final_points bigint;
begin
  if p_kind not in ('minutes','manual','promotion','call','paypal') then raise exception 'INVALID_PURCHASE_KIND'; end if;
  client_id=(p->>'cliente_id')::uuid;
  if client_id is null then raise exception 'CLIENTE_REQUIRED'; end if;
  -- Serialize all purchase types for one customer, including simultaneous callbacks.
  select coalesce(puntos,0) into starting_points from public.crm_clientes where id=client_id for update;
  if not found then raise exception 'CLIENTE_NO_EXISTE'; end if;
  if p_kind='call' and not coalesce((p->>'cliente_compra_minutos')::boolean,false) then
    return public.crm_register_call_atomic_v8(p);
  end if;
  v_operation_key=case when p_kind='call' then 'registrar_llamada:'||(p->>'operation_id')
    when p_kind='paypal' then 'paypal:'||(p->>'payment_id') else p->>'payment_ref' end;
  if v_operation_key is null or length(trim(v_operation_key))=0 then raise exception 'PURCHASE_REFERENCE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_operation_key,0));
  select * into receipt from public.tc_rank_purchase_receipts r where r.operation_key=v_operation_key;
  if found then
    if receipt.cliente_id<>client_id then raise exception 'PURCHASE_CLIENT_MISMATCH'; end if;
    return receipt.result||jsonb_build_object('duplicated',true,'duplicate_prevented',true);
  end if;
  benefit=public.tc_rank_phase_one_state(client_id);
  coin_amount=(benefit->>'purchase_coins')::integer;
  if p_kind in ('minutes','manual') then
    if coalesce((p->>'amount')::numeric,0)<=0 then raise exception 'INVALID_PURCHASE_AMOUNT'; end if;
    p=p||jsonb_build_object('points',coin_amount);
    if p_kind='minutes' then outcome=public.cliente_confirmar_compra_ruleta_v3(p);
    else outcome=public.cliente_confirmar_compra_ruleta_v2(p); end if;
  elsif p_kind='promotion' then
    select * into attempt from public.cliente_payment_attempts where id=(p->>'attempt_id')::uuid for update;
    if not found or attempt.cliente_id<>client_id then raise exception 'PURCHASE_CLIENT_MISMATCH'; end if;
    -- Only the delivered snapshot changes; package definitions remain untouched.
    if attempt.status<>'completed' then
      update public.cliente_payment_attempts set promotion_snapshot=jsonb_set(promotion_snapshot,'{coins}',to_jsonb(coin_amount))
      where id=attempt.id;
    end if;
    outcome=public.cliente_confirmar_compra_promocion_v1(attempt.id);
  elsif p_kind='call' then
    if coalesce((p->>'importe')::numeric,0)<=0 or coalesce((p->>'misma_compra')::boolean,false) then coin_amount=0; end if;
    p=p||jsonb_build_object('points_to_add',coin_amount,
      'purchase_benefits',coalesce(p->'purchase_benefits','{}'::jsonb)||jsonb_build_object('coins',coin_amount));
    outcome=public.crm_register_call_atomic_v8(p);
  else
    select * into payment from public.crm_cliente_pagos where id=(p->>'payment_id')::uuid for update;
    if not found or payment.cliente_id<>client_id then raise exception 'PURCHASE_CLIENT_MISMATCH'; end if;
    if payment.estado='completed' then return jsonb_build_object('duplicated',true,'payment',to_jsonb(payment)); end if;
    if payment.importe<=0 or payment.paypal_order_id is null then raise exception 'INVALID_PAYPAL_PAYMENT'; end if;
    update public.crm_cliente_pagos set estado='completed',paypal_capture_id=p->>'capture_id',paypal_payer_id=p->>'payer_id',updated_at=now()
      where id=payment.id returning * into payment;
    update public.crm_clientes set puntos=coalesce(puntos,0)+coin_amount where id=client_id;
    if coin_amount>0 then
      insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion)
      values(client_id,'ganado',coin_amount,'Compra PayPal · beneficio de rango · '||payment.id);
    end if;
    outcome=jsonb_build_object('ok',true,'payment',to_jsonb(payment));
  end if;
  if outcome is null or outcome->>'ok'='false' then raise exception 'PURCHASE_NOT_CONFIRMED: %',outcome; end if;
  if outcome->'payment'->>'cliente_id' is not null and (outcome->'payment'->>'cliente_id')::uuid<>client_id then
    raise exception 'PURCHASE_CLIENT_MISMATCH';
  end if;
  -- Already-processed purchases from before deployment receive no retroactive credit.
  if coalesce((outcome->>'duplicated')::boolean,false) or coalesce((outcome->>'duplicate_prevented')::boolean,false) then return outcome; end if;
  select coalesce(puntos,0) into final_points from public.crm_clientes where id=client_id;
  if final_points-starting_points<>coin_amount then
    raise exception 'PURCHASE_COINS_MISMATCH: expected %, credited %. Review existing RPCs/triggers.',coin_amount,final_points-starting_points;
  end if;
  outcome=outcome||jsonb_build_object('rank_coins',coin_amount,'rank_at_purchase',benefit->>'rank_key');
  insert into public.tc_rank_purchase_receipts(operation_key,cliente_id,rank_key,coins,result)
    values(v_operation_key,client_id,benefit->>'rank_key',coin_amount,outcome);
  return outcome;
end $$;
revoke all on function public.tc_confirm_rank_purchase(text,jsonb) from public,anon,authenticated;
grant execute on function public.tc_confirm_rank_purchase(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
