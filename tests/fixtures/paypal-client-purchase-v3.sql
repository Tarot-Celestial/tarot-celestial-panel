-- Read-only production RPC snapshot verified 2026-10-13. No provider calls.
CREATE OR REPLACE FUNCTION public.cliente_confirmar_compra_ruleta_v3(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.crm_cliente_pagos%rowtype; cid uuid:=(p->>'cliente_id')::uuid;
  ref text:=nullif(p->>'payment_ref',''); amount numeric:=round((p->>'amount')::numeric,2);
  curr text:=upper(p->>'currency'); f integer:=coalesce((p->>'free')::integer,0); n integer:=coalesce((p->>'normal')::integer,0);
  ctx jsonb; result jsonb;
begin
  if ref is null or cid is null or amount is null or amount<=0 or curr not in ('EUR','USD') or curr is null or f<0 or n<0 then raise exception 'INVALID_PURCHASE'; end if;
  -- Siempre mismo orden de bloqueos que el motor y las reclamaciones.
  perform 1 from public.crm_clientes where id=cid for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('purchase:'||ref));
  select * into v from public.crm_cliente_pagos where referencia_externa=ref for update;
  if found then
    if v.cliente_id<>cid or v.importe<>amount or upper(v.moneda)<>curr then raise exception 'PAYMENT_REFERENCE_CONFLICT'; end if;
    if v.estado='completed' then return jsonb_build_object('duplicated',true,'payment',to_jsonb(v)); end if;
    if v.benefits_processed_at is not null or v.estado not in ('pending','processing') then raise exception 'PAYMENT_STATE_CONFLICT'; end if;
  end if;
  ctx:=jsonb_build_object('coins',greatest(coalesce((p->>'points')::integer,0),0),
    'oracle_credits',greatest(coalesce((p->>'oracle_credits')::integer,0),0),
    'special_spins',case when (p->>'roulette_level')::integer=4 then greatest(coalesce((p->>'roulette_spins')::integer,0),0) else 0 end,
    'pack_id',p->>'pack_id','source','purchase_rpc');
  if v.id is null then
    insert into public.crm_cliente_pagos(cliente_id,importe,moneda,metodo,estado,referencia_externa,notas,
      pack_id,pack_name,paid_minutes,bonus_minutes,stripe_session_id,payment_intent,created_by_user_id,created_by_role,benefits_context)
    values(cid,amount,curr,p->>'metodo','completed',ref,p->>'notas',p->>'pack_id',p->>'pack_name',n,f,
      p->>'stripe_session_id',p->>'payment_intent',nullif(p->>'created_by_user_id','')::uuid,p->>'created_by_role',ctx) returning * into v;
  else
    update public.crm_cliente_pagos set estado='completed',paid_minutes=n,bonus_minutes=f,benefits_context=ctx where id=v.id returning * into v;
  end if;
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+f,
    minutos_normales_pendientes=coalesce(minutos_normales_pendientes,0)+n,updated_at=now() where id=cid;
  result:=public.tc_apply_purchase_benefits(v.id);
  return jsonb_build_object('duplicated',false,'payment',to_jsonb(v),'benefits',result,'creditedMinutes',jsonb_build_object('free',f,'normal',n));
end $function$
