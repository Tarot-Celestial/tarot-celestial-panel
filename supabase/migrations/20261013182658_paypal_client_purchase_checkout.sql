begin;

-- Extend the existing private order store. Historical staff collections keep
-- their original meaning; client purchases use a separate completion function.
alter table public.crm_paypal_orders
  add column if not exists checkout_kind text not null default 'crm_collection',
  add column if not exists purchaser_auth_user_id uuid;
alter table public.crm_paypal_orders alter column worker_id drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.crm_paypal_orders'::regclass and conname='crm_paypal_orders_checkout_actor_check') then
    alter table public.crm_paypal_orders add constraint crm_paypal_orders_checkout_actor_check check (
      (checkout_kind='crm_collection' and worker_id is not null and purchaser_auth_user_id is null)
      or (checkout_kind='client_purchase' and worker_id is null and purchaser_auth_user_id is not null)
    );
  end if;
end $$;

-- A different request ID must not create a second live checkout for one client.
-- Completed and cancelled attempts remain in the audit history.
create unique index if not exists crm_paypal_orders_one_client_pending
  on public.crm_paypal_orders(cliente_id,environment)
  where checkout_kind='client_purchase' and status='pending';

alter table public.cliente_payment_settings
  add column if not exists paypal_client_enabled boolean not null default false;
do $$ begin
  update public.cliente_payment_settings set paypal_client_enabled=true where id='default';
  if not found then raise exception 'CLIENT_PAYMENT_SETTINGS_MISSING'; end if;
end $$;

-- Existing live collection-only function, with only the checkout-kind guard
-- added. It must never fulfil a client purchase, even after a routing mistake.
create or replace function public.tc_complete_paypal_crm(
  p_id uuid,p_order_id text,p_capture_id text,p_amount numeric,p_currency text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.crm_paypal_orders;
begin
  select * into a from public.crm_paypal_orders where id=p_id for update;
  if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
  if a.checkout_kind is distinct from 'crm_collection' then raise exception 'PAYPAL_CHECKOUT_KIND_MISMATCH'; end if;
  if p_order_id is distinct from a.order_id or p_amount is distinct from a.amount
    or p_currency is distinct from a.currency or coalesce(p_capture_id,'')='' then
    raise exception 'PAYPAL_CAPTURE_MISMATCH';
  end if;
  if a.status='completed' then
    if a.capture_id is distinct from p_capture_id then raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
    return jsonb_build_object('ok',true,'duplicated',true,'payment_id',a.payment_id);
  end if;
  update public.crm_paypal_orders
    set status='completed',remote_status='CAPTURE_COMPLETED',capture_id=p_capture_id,
        last_error=null,completed_at=now(),checked_at=now()
    where id=a.id;
  insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data,is_pinned)
    values(a.cliente_id::text,
      format('Pago PayPal confirmado: %s %s. Cobro recibido; no registra una compra ni concede beneficios.',a.amount,a.currency),
      'Sistema · PayPal','paypal_collection_confirmed',
      jsonb_build_object('paypal_attempt_id',a.id,'paypal_order_id',a.order_id,
        'paypal_capture_id',p_capture_id,'amount',a.amount,'currency',a.currency,
        'collection_only',true),false);
  return jsonb_build_object('ok',true,'collection_only',true,'payment_id',a.payment_id);
end $$;

-- Server-only: call AFTER retrieving and validating a COMPLETED capture from
-- PayPal. The stored server-built snapshot supplies the original purchase terms.
-- Webhook, browser return and staff reconciliation all converge on this RPC.
create or replace function public.tc_complete_paypal_client(
  p_id uuid,p_order_id text,p_capture_id text,p_amount numeric,p_currency text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  a public.crm_paypal_orders;
  payment public.crm_cliente_pagos;
  result jsonb;
  payload jsonb;
  normal_minutes integer;
  free_minutes integer;
  total_minutes integer;
  credited_coins integer;
  credited_oracle integer;
  extra_free integer;
  spin_summary jsonb;
  spin_text text;
  note_text text;
  summary jsonb;
  free_before numeric;
  normal_before numeric;
  free_after numeric;
  normal_after numeric;
begin
  select * into a from public.crm_paypal_orders where id=p_id for update;
  if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
  if a.checkout_kind is distinct from 'client_purchase' or a.purchaser_auth_user_id is null or a.worker_id is not null then
    raise exception 'PAYPAL_CHECKOUT_KIND_MISMATCH';
  end if;
  if a.order_id is null or p_order_id is distinct from a.order_id
    or p_amount is distinct from a.amount or p_currency is distinct from a.currency
    or a.currency<>'EUR' or nullif(btrim(coalesce(p_capture_id,'')),'') is null then
    raise exception 'PAYPAL_CAPTURE_MISMATCH';
  end if;
  if a.status='completed' then
    if a.capture_id is distinct from p_capture_id or a.payment_id is null then raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
    return jsonb_build_object('ok',true,'duplicated',true,'payment_id',a.payment_id);
  end if;

  -- Reject malformed snapshots before invoking the canonical crediting engine.
  -- Do not look up today's price or split: the charged checkout owns its terms.
  if jsonb_typeof(a.purchase_payload)<>'object'
    or a.purchase_payload->>'pack_id' is distinct from a.pack_id
    or a.purchase_payload->>'pack_name' is distinct from a.pack_name
    or coalesce(a.purchase_payload->>'normal','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'free','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'total_minutes','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'points','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'oracle_credits','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'roulette_level','') !~ '^[1-3]$'
    or coalesce(a.purchase_payload->>'roulette_spins','') !~ '^[0-9]+$' then
    raise exception 'PAYPAL_PURCHASE_SNAPSHOT_INVALID';
  end if;
  normal_minutes := (a.purchase_payload->>'normal')::integer;
  free_minutes := (a.purchase_payload->>'free')::integer;
  total_minutes := (a.purchase_payload->>'total_minutes')::integer;
  if total_minutes<=0 or normal_minutes+free_minutes<>total_minutes then
    raise exception 'PAYPAL_PURCHASE_SNAPSHOT_INVALID';
  end if;

  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into free_before,normal_before from public.crm_clientes where id=a.cliente_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;

  payload := a.purchase_payload || jsonb_build_object(
    'cliente_id',a.cliente_id,'amount',a.amount,'currency',a.currency,
    'payment_ref','paypal-client:'||a.order_id,'metodo','paypal_cliente',
    'created_by_user_id',a.purchaser_auth_user_id,'created_by_role','cliente',
    'notas',format('Compra web · panel cliente · PayPal · %s.',a.pack_name)
  );
  result := public.cliente_confirmar_compra_ruleta_v3(payload);
  if result is null or result->>'ok'='false' or nullif(result->'payment'->>'id','') is null then
    raise exception 'PURCHASE_NOT_CONFIRMED';
  end if;
  select * into payment from public.crm_cliente_pagos where id=(result->'payment'->>'id')::uuid;
  if not found or payment.cliente_id is distinct from a.cliente_id
    or payment.estado is distinct from 'completed' or payment.importe is distinct from a.amount
    or payment.moneda is distinct from a.currency or payment.pack_id is distinct from a.pack_id
    or payment.paid_minutes is distinct from normal_minutes::numeric
    or payment.bonus_minutes is distinct from free_minutes::numeric then
    raise exception 'PURCHASE_MISMATCH';
  end if;
  if (payment.paypal_order_id is not null and payment.paypal_order_id<>a.order_id)
    or (payment.paypal_capture_id is not null and payment.paypal_capture_id<>p_capture_id) then
    raise exception 'PAYPAL_CAPTURE_MISMATCH';
  end if;

  -- Read actual delivered events, including rank benefits, not advertised totals.
  select coalesce(sum(coins),0)::integer,coalesce(sum(oracle_credits),0)::integer,
    coalesce(sum(case when benefit_key='diamond_purchase_minutes' then minutes else 0 end),0)::integer
    into credited_coins,credited_oracle,extra_free
    from public.tc_client_benefit_events where payment_id=payment.id;
  select coalesce(jsonb_agg(jsonb_build_object('level',nivel,'count',n) order by nivel),'[]'::jsonb),
    coalesce(string_agg(format('%s giro(s) %s',n,case when nivel=4 then 'Especial' else 'Nivel '||nivel::text end),', ' order by nivel),'ninguno')
    into spin_summary,spin_text
    from (select nivel,count(*)::integer n from public.cliente_ruleta_giros where purchase_id=payment.id group by nivel) s;
  summary := jsonb_build_object(
    'normal',normal_minutes,'free',free_minutes,'rank_free_minutes',extra_free,
    'total_minutes',normal_minutes+free_minutes+extra_free,
    'coins',credited_coins,'oracle_credits',credited_oracle,'spins',spin_summary
  );
  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into free_after,normal_after from public.crm_clientes where id=a.cliente_id;
  summary := summary || jsonb_build_object('balances',jsonb_build_object(
    'free_before',free_before,'normal_before',normal_before,'free_after',free_after,'normal_after',normal_after));
  note_text := format('Compra web confirmada · panel cliente · PayPal. %s por %s %s. Minutos añadidos: %s normales + %s FREE. Extra FREE por rango: %s. Beneficios acreditados: %s Coins; %s tirada(s) de Oráculo; ruleta: %s. Referencia PayPal: %s.',
    a.pack_name,a.amount,a.currency,normal_minutes,free_minutes,extra_free,credited_coins,credited_oracle,spin_text,a.order_id);
  note_text := note_text || format(' Saldo anterior: %s normales + %s FREE. Saldo final: %s normales + %s FREE.',normal_before,free_before,normal_after,free_after);
  update public.crm_cliente_pagos set paypal_order_id=a.order_id,paypal_capture_id=p_capture_id,notas=note_text where id=payment.id;
  insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,event_type,event_data,is_pinned)
    values(a.cliente_id::text,note_text,a.purchaser_auth_user_id,'Sistema · Compra web','client_paypal_purchase',
      jsonb_build_object('payment_id',payment.id,'paypal_attempt_id',a.id,'paypal_order_id',a.order_id,
        'paypal_capture_id',p_capture_id,'amount',a.amount,'currency',a.currency,'pack_id',a.pack_id,
        'source','cliente_panel','credited',summary),false);
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
    values(a.cliente_id,'purchase_completed','Pago confirmado',
      format('Tu compra %s ya está activa. Hemos añadido %s minutos, %s Coins y %s tirada(s) de Oráculo. Ruleta: %s.',
        a.pack_name,total_minutes+extra_free,credited_coins,credited_oracle,spin_text),
      jsonb_build_object('payment_id',payment.id,'pack_id',a.pack_id,'pack_name',a.pack_name,
        'total_minutes',total_minutes+extra_free,'coins',credited_coins,'oracle_credits',credited_oracle,
        'roulette_level',(a.purchase_payload->>'roulette_level')::integer,
        'roulette_spins',(select count(*) from public.cliente_ruleta_giros where purchase_id=payment.id and nivel=(a.purchase_payload->>'roulette_level')::integer),
        'spins',spin_summary,'payment_reference','paypal-client:'||a.order_id,'currency',a.currency),false,now());
  update public.crm_paypal_orders
    set status='completed',remote_status='CAPTURE_COMPLETED',capture_id=p_capture_id,payment_id=payment.id,
        last_error=null,completed_at=now(),checked_at=now()
    where id=a.id;
  return jsonb_build_object('ok',true,'duplicated',false,'payment_id',payment.id,'credited',summary);
end $$;

-- New columns do not open client access to orders, tokens or fulfilment.
alter table public.crm_paypal_orders enable row level security;
revoke all on public.crm_paypal_orders from public,anon,authenticated;
grant select,insert,update on public.crm_paypal_orders to service_role;
revoke all on function public.tc_complete_paypal_crm(uuid,text,text,numeric,text) from public,anon,authenticated;
revoke all on function public.tc_complete_paypal_client(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.tc_complete_paypal_crm(uuid,text,text,numeric,text) to service_role;
grant execute on function public.tc_complete_paypal_client(uuid,text,text,numeric,text) to service_role;

notify pgrst,'reload schema';
commit;
