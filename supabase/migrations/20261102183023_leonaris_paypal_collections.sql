-- Additive: no existing order, balance or purchase is rewritten.
create or replace function public.tc_create_paypal_crm_attempt(p_attempt jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.crm_paypal_orders; cid uuid := (p_attempt->>'cliente_id')::uuid;
begin
  -- Serialize creation across operators, tabs and BOTH accounts for this client.
  perform pg_advisory_xact_lock(hashtextextended('paypal-crm:' || cid::text,0));
  select * into a from public.crm_paypal_orders where id=(p_attempt->>'id')::uuid;
  if found then return to_jsonb(a); end if;
  if exists(select 1 from public.crm_paypal_orders where cliente_id=cid and environment=p_attempt->>'environment'
    and checkout_kind='crm_collection' and status='pending') then
    raise exception 'PAYPAL_PENDING_COLLECTION';
  end if;
  if coalesce(p_attempt->'purchase_payload'->>'paypal_account','legacy') not in ('legacy','client_business_v1') then
    raise exception 'PAYPAL_ACCOUNT_INVALID';
  end if;
  insert into public.crm_paypal_orders(id,cliente_id,worker_id,environment,public_token,amount,currency,pack_id,pack_name,purchase_payload,create_payload,checkout_kind)
  values((p_attempt->>'id')::uuid,cid,(p_attempt->>'worker_id')::uuid,p_attempt->>'environment',
    (p_attempt->>'public_token')::uuid,(p_attempt->>'amount')::numeric,p_attempt->>'currency',p_attempt->>'pack_id',p_attempt->>'pack_name',
    p_attempt->'purchase_payload',p_attempt->'create_payload','crm_collection') returning * into a;
  return to_jsonb(a);
end $$;
revoke all on function public.tc_create_paypal_crm_attempt(jsonb) from public,anon,authenticated;
grant execute on function public.tc_create_paypal_crm_attempt(jsonb) to service_role;

create or replace function public.tc_complete_paypal_crm(p_id uuid,p_order_id text,p_capture_id text,p_amount numeric,p_currency text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.crm_paypal_orders; recipient text;
begin
  select * into a from public.crm_paypal_orders where id=p_id for update;
  if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
  if a.checkout_kind is distinct from 'crm_collection' then raise exception 'PAYPAL_CHECKOUT_KIND_MISMATCH'; end if;
  if p_order_id is distinct from a.order_id or p_amount is distinct from a.amount or p_currency is distinct from a.currency or coalesce(p_capture_id,'')='' then
    raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
  if a.status='completed' then
    if a.capture_id is distinct from p_capture_id then raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
    return jsonb_build_object('ok',true,'duplicated',true,'payment_id',a.payment_id);
  end if;
  recipient := case when a.purchase_payload->>'paypal_account'='client_business_v1' then 'Leonaris' else 'cuenta habitual' end;
  update public.crm_paypal_orders set status='completed',remote_status='CAPTURE_COMPLETED',capture_id=p_capture_id,last_error=null,completed_at=now(),checked_at=now() where id=a.id;
  insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data,is_pinned)
  values(a.cliente_id::text,format('Pago PayPal confirmado · %s: %s %s. Cobro recibido; no registra una compra ni concede beneficios.',recipient,a.amount,a.currency),
    'Sistema · PayPal','paypal_collection_confirmed',jsonb_build_object('paypal_attempt_id',a.id,'paypal_order_id',a.order_id,'paypal_capture_id',p_capture_id,
    'amount',a.amount,'currency',a.currency,'collection_only',true,'paypal_account',coalesce(a.purchase_payload->>'paypal_account','legacy')),false);
  return jsonb_build_object('ok',true,'collection_only',true,'payment_id',a.payment_id);
end $$;
revoke all on function public.tc_complete_paypal_crm(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.tc_complete_paypal_crm(uuid,text,text,numeric,text) to service_role;
