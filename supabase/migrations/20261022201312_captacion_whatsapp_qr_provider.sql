-- Additive QR transport: preserve historic Twilio receipts and submission uniqueness.
alter table public.captacion_whatsapp_deliveries add column if not exists provider text not null default 'twilio';
alter table public.captacion_whatsapp_deliveries add column if not exists gateway_session_id text;
alter table public.captacion_whatsapp_deliveries drop constraint if exists captacion_whatsapp_delivery_provider;
alter table public.captacion_whatsapp_deliveries add constraint captacion_whatsapp_delivery_provider check (provider in ('twilio','qr'));
alter table public.captacion_whatsapp_deliveries drop constraint if exists captacion_whatsapp_delivery_qr_session;
alter table public.captacion_whatsapp_deliveries add constraint captacion_whatsapp_delivery_qr_session check (provider <> 'qr' or (gateway_session_id is not null and gateway_session_id ~ '^[A-Za-z0-9_-]{1,64}$'));
alter table public.captacion_whatsapp_delivery_events drop constraint if exists captacion_whatsapp_delivery_events_source_check;
alter table public.captacion_whatsapp_delivery_events add constraint captacion_whatsapp_delivery_events_source_check check (source in ('claim','send_response','provider_callback','qr_response','qr_poll'));
create or replace function public.tc_captacion_whatsapp_qr_claim(
  p_delivery_id uuid, p_request_id uuid, p_lead_id uuid, p_worker_id uuid, p_auth_user_id uuid,
  p_submission_key text, p_from_number text, p_to_number text, p_callback_token uuid,
  p_expected_cliente_id uuid, p_client_snapshot jsonb, p_gateway_session_id text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_lead public.captacion_leads%rowtype;
  v_worker public.workers%rowtype;
  v_client public.crm_clientes%rowtype;
  v_delivery public.captacion_whatsapp_deliveries%rowtype;
  v_origin text;
  v_event_key text;
  v_submitted_at timestamptz;
begin
  -- Serialize different central users and tabs acting on the same customer lead.
  select * into v_lead from public.captacion_leads where id = p_lead_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  select * into v_worker from public.workers where id = p_worker_id and is_active = true
    and role in ('admin','central') and (user_id = p_auth_user_id or auth_user_id = p_auth_user_id);
  if not found then raise exception 'FORBIDDEN'; end if;
  if v_worker.role <> 'admin' and v_lead.assigned_worker_id is not null and v_lead.assigned_worker_id <> p_worker_id then raise exception 'FORBIDDEN'; end if;
  -- Provider preflight can take seconds. Recheck the exact CRM snapshot while
  -- locking both the lead and client before reserving any outbound message.
  if v_lead.cliente_id is distinct from p_expected_cliente_id then raise exception 'CLIENT_CHANGED'; end if;
  select * into v_client from public.crm_clientes where id = v_lead.cliente_id for share;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if p_client_snapshot is distinct from jsonb_build_object(
    'telefono_normalizado',v_client.telefono_normalizado,'telefono',v_client.telefono,
    'pais',v_client.pais,'nombre',v_client.nombre,'apellido',v_client.apellido
  ) then raise exception 'CLIENT_CHANGED'; end if;
  v_origin := coalesce(nullif(v_client.origen,''),v_lead.origen,'');
  if lower(v_origin) like '%orion%' then raise exception 'LEAD_NOT_FOUND'; end if;
  select * into v_delivery from public.captacion_whatsapp_deliveries where request_id = p_request_id;
  if found then
    if v_delivery.lead_id <> p_lead_id then raise exception 'REQUEST_CONFLICT'; end if;
    return jsonb_build_object('claimed',false,'delivery',to_jsonb(v_delivery));
  end if;
  select 'meta:' || leadgen_id, meta_created_at into v_event_key, v_submitted_at
    from public.meta_lead_events where captacion_lead_id = p_lead_id and status = 'processed' and meta_created_at <= now()
    order by meta_created_at desc, leadgen_id desc limit 1;
  v_event_key := coalesce(v_event_key,'initial');
  if p_submission_key is distinct from v_event_key then raise exception 'SUBMISSION_CHANGED'; end if;
  select * into v_delivery from public.captacion_whatsapp_deliveries where lead_id = p_lead_id and submission_key = p_submission_key;
  if found then return jsonb_build_object('claimed',false,'delivery',to_jsonb(v_delivery)); end if;
  if v_lead.closed_at is not null and (v_submitted_at is null or v_lead.closed_at >= v_submitted_at) then raise exception 'LEAD_CLOSED'; end if;
  if p_gateway_session_id is null or p_gateway_session_id !~ '^[A-Za-z0-9_-]{1,64}$' or p_from_number !~ '^whatsapp:\+[1-9][0-9]{7,14}$' or p_to_number !~ '^whatsapp:\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_MESSAGE'; end if;
  insert into public.captacion_whatsapp_deliveries (id,lead_id,cliente_id,submission_key,request_id,worker_id,auth_user_id,content_sid,from_number,to_number,callback_token,provider,gateway_session_id)
    values (p_delivery_id,p_lead_id,v_lead.cliente_id,p_submission_key,p_request_id,p_worker_id,p_auth_user_id,'qr:captacion-beneficios-v1',p_from_number,p_to_number,p_callback_token,'qr',p_gateway_session_id)
    returning * into v_delivery;
  insert into public.captacion_whatsapp_delivery_events (delivery_id,status,source) values (v_delivery.id,'sending','claim');
  return jsonb_build_object('claimed',true,'delivery',to_jsonb(v_delivery));
end;
$$;

create or replace function public.tc_captacion_whatsapp_record(
  p_delivery_id uuid, p_callback_token uuid, p_message_sid text, p_status text, p_error_code text, p_source text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_delivery public.captacion_whatsapp_deliveries%rowtype;
  v_old_rank integer;
  v_new_rank integer;
begin
  if p_status not in ('sending','unknown','accepted','queued','sent','delivered','read','failed','undelivered')
    or p_source not in ('send_response','provider_callback','qr_response','qr_poll') then raise exception 'INVALID_STATUS'; end if;

  select * into v_delivery from public.captacion_whatsapp_deliveries where id = p_delivery_id for update;
  if not found or v_delivery.callback_token is distinct from p_callback_token then raise exception 'INVALID_DELIVERY'; end if;
  if (v_delivery.provider = 'qr' and p_source not in ('qr_response','qr_poll'))
    or (v_delivery.provider = 'twilio' and p_source not in ('send_response','provider_callback')) then raise exception 'INVALID_SOURCE'; end if;
  if p_message_sid is not null and ((v_delivery.provider = 'twilio' and p_message_sid !~ '^SM[0-9a-fA-F]{32}$')
    or (v_delivery.provider = 'qr' and p_message_sid !~ '^[A-Za-z0-9._:-]{1,160}$')) then raise exception 'INVALID_MESSAGE'; end if;
  if v_delivery.message_sid is not null and p_message_sid is not null and v_delivery.message_sid <> p_message_sid then raise exception 'MESSAGE_CONFLICT'; end if;
  v_old_rank := case v_delivery.status when 'sending' then 0 when 'unknown' then 0 when 'accepted' then 1 when 'queued' then 2 when 'sent' then 3 when 'failed' then 4 when 'undelivered' then 4 when 'delivered' then 5 when 'read' then 6 end;
  v_new_rank := case p_status when 'sending' then 0 when 'unknown' then 0 when 'accepted' then 1 when 'queued' then 2 when 'sent' then 3 when 'failed' then 4 when 'undelivered' then 4 when 'delivered' then 5 when 'read' then 6 end;
  -- A callback can arrive before the send response. Never regress delivered/read,
  -- and never delete the provider SID after an ambiguous HTTP result.
  if v_new_rank < v_old_rank then return to_jsonb(v_delivery); end if;
  if v_delivery.status = p_status and (p_message_sid is null or v_delivery.message_sid = p_message_sid) then return to_jsonb(v_delivery); end if;
  update public.captacion_whatsapp_deliveries set status = p_status, message_sid = coalesce(message_sid,p_message_sid), error_code = left(p_error_code,30), updated_at = now()
    where id = p_delivery_id returning * into v_delivery;
  insert into public.captacion_whatsapp_delivery_events (delivery_id,status,message_sid,error_code,source)
    values (p_delivery_id,v_delivery.status,v_delivery.message_sid,v_delivery.error_code,p_source);
  return to_jsonb(v_delivery);
end;
$$;
revoke all on function public.tc_captacion_whatsapp_qr_claim(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.tc_captacion_whatsapp_qr_claim(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,jsonb,text) to service_role;
revoke all on function public.tc_captacion_whatsapp_record(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.tc_captacion_whatsapp_record(uuid,uuid,text,text,text,text) to service_role;
