-- Also release abandoned legacy creation attempts: no issued link, no capture, expired retry window.
create or replace function public.tc_replace_paypal_crm_attempt(
  p_attempt jsonb, p_previous jsonb, p_is_admin boolean default false
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  cid uuid := (p_attempt->>'cliente_id')::uuid;
  aid uuid := (p_attempt->>'id')::uuid;
  wid uuid := (p_attempt->>'worker_id')::uuid;
  old public.crm_paypal_orders;
  snapshot jsonb;
  changed_ids jsonb := '[]'::jsonb;
  new_attempt jsonb;
begin
  if cid is null or aid is null or wid is null or jsonb_typeof(p_previous) is distinct from 'array' then
    raise exception 'PAYPAL_REPLACEMENT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paypal-crm:' || cid::text,0));
  select * into old from public.crm_paypal_orders where id=aid;
  if found then return to_jsonb(old); end if; -- A retry never cancels another link.

  -- Lock in a deterministic order. The capture claim competes for these rows.
  perform 1 from public.crm_paypal_orders o
    where o.id in (select (value->>'id')::uuid from jsonb_array_elements(p_previous))
    order by o.id for update;
  for snapshot in select value from jsonb_array_elements(p_previous) loop
    select * into old from public.crm_paypal_orders where id=(snapshot->>'id')::uuid;
    if not found or old.cliente_id is distinct from cid or old.environment is distinct from p_attempt->>'environment'
      or old.checkout_kind is distinct from 'crm_collection' then raise exception 'PAYPAL_REPLACEMENT_CHANGED'; end if;
    if not coalesce(p_is_admin,false) and old.worker_id is distinct from wid then raise exception 'PAYPAL_REPLACEMENT_FORBIDDEN'; end if;
    if old.status='completed' or old.capture_id is not null or old.payment_id is not null
      or old.remote_status in ('CAPTURE_REQUESTED','CAPTURE_PENDING','CAPTURE_COMPLETED') then
      raise exception 'PAYPAL_REPLACEMENT_PROCESSING';
    end if;
    if old.status is distinct from snapshot->>'status' or old.remote_status is distinct from snapshot->>'remote_status'
      or old.order_id is distinct from snapshot->>'order_id' then raise exception 'PAYPAL_REPLACEMENT_CHANGED'; end if;
    if old.status='pending' and not coalesce((
      (old.order_id is not null and old.remote_status in ('CREATED','SAVED','PAYER_ACTION_REQUIRED','APPROVED','VOIDED'))
      or (old.order_id is null and old.approval_url is null and old.remote_status='CREATING' and (
        old.create_payload->'payment_source' ? 'card'
        or (old.created_at <= now() - interval '5 hours' and old.create_payload->>'intent'='CAPTURE'
          and old.create_payload->'purchase_units'->0->>'custom_id'=old.id::text
          and old.create_payload->'purchase_units'->0->>'invoice_id'='TC-'||old.id::text)
      ))
    ),false) then raise exception 'PAYPAL_REPLACEMENT_PROCESSING'; end if;
  end loop;
  -- A second operator may have created a different link during the provider check.
  if exists(select 1 from public.crm_paypal_orders o where o.cliente_id=cid
    and o.environment=p_attempt->>'environment' and o.checkout_kind='crm_collection' and o.status='pending'
    and not exists(select 1 from jsonb_array_elements(p_previous) x where x->>'id'=o.id::text)) then
    raise exception 'PAYPAL_REPLACEMENT_CHANGED';
  end if;
  for snapshot in select value from jsonb_array_elements(p_previous) loop
    update public.crm_paypal_orders set status='cancelled',remote_status='CANCELLED_BY_STAFF',
      last_error=left(coalesce(snapshot->>'note','Enlace sustituido automáticamente. No es un reembolso.'),1000),
      checked_at=now(),purchase_payload=coalesce(purchase_payload,'{}'::jsonb)||jsonb_build_object(
        'superseded_by',aid,'superseded_at',now(),'superseded_by_worker',wid)
      where id=(snapshot->>'id')::uuid and status='pending';
    if found then changed_ids:=changed_ids||jsonb_build_array(snapshot->>'id'); end if;
  end loop;
  new_attempt:=jsonb_set(p_attempt,'{purchase_payload}',coalesce(p_attempt->'purchase_payload','{}'::jsonb)
    ||jsonb_build_object('replaces_attempt_ids',changed_ids,'replaced_count',jsonb_array_length(changed_ids)));
  -- The original insertion retains its validation, lock and idempotency rules.
  -- A failed insertion rolls back every cancellation in this transaction.
  return public.tc_create_paypal_crm_attempt(new_attempt);
end $$;
revoke all on function public.tc_replace_paypal_crm_attempt(jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.tc_replace_paypal_crm_attempt(jsonb,jsonb,boolean) to service_role;
