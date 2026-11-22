begin;

-- Graph stores answers to a custom disclaimer separately from field_data.
-- Only keys explicitly naming WhatsApp can establish permission.
create function public.office_meta_whatsapp_answer(p_lead jsonb) returns text
language sql immutable parallel safe security invoker set search_path='' as $$
  with answers as (
    select lower(btrim(f->>'name')) key,
      case when jsonb_typeof(f->'values')='array' then
        case when jsonb_array_length(f->'values')=1 then lower(btrim(f#>>'{values,0}')) end
      end value
    from jsonb_array_elements(case when jsonb_typeof(p_lead->'field_data')='array'
      then p_lead->'field_data' else '[]' end) f
    union all
    select lower(btrim(c->>'checkbox_key')), case lower(btrim(c->>'is_checked'))
      when '1' then 'true' when 'true' then 'true' when '0' then 'false' when 'false' then 'false' end
    from jsonb_array_elements(case when jsonb_typeof(p_lead->'custom_disclaimer_responses')='array'
      then p_lead->'custom_disclaimer_responses' else '[]' end) c
  ), decisions as (
    select case when value in ('true','1','yes','sí','si','acepto','autorizo') then 'granted'
      when value in ('false','0','no','no acepto','no autorizo') then 'declined'
      else 'review' end decision from answers
    where key in ('whatsapp_opt_in','consent_whatsapp','acepto_contacto_por_whatsapp','autorizo_contacto_por_whatsapp')
  )
  select case when count(*)=0 then 'missing'
    when bool_and(decision='granted') then 'granted'
    when bool_and(decision='declined') then 'declined'
    else 'review' end from decisions
$$;

-- The form can attest contact only at the submitted number. A local number
-- without its international prefix is ambiguous across the supported markets.
create function public.office_meta_whatsapp_number(p_lead jsonb) returns text
language sql immutable parallel safe security invoker set search_path='' as $$
  with phones as (
    select case when jsonb_typeof(f->'values')='array' then
      case when jsonb_array_length(f->'values')=1 then regexp_replace(btrim(f#>>'{values,0}'),'[[:space:]().-]','','g') end
    end value from jsonb_array_elements(case when jsonb_typeof(p_lead->'field_data')='array'
      then p_lead->'field_data' else '[]' end) f
    where lower(btrim(f->>'name')) in ('phone_number','mobile_phone_number','telefono','teléfono')
  ), normalized as (
    select case when value ~ '^[+][1-9][0-9]{7,14}$' then value
      when value ~ '^00[1-9][0-9]{7,14}$' then '+'||substr(value,3)
      when value ~ '^[1-9][0-9]{10,14}$' then '+'||value end phone from phones
  )
  select case when count(*)=count(phone) and count(distinct phone)=1 then min(phone) end from normalized
$$;

create view public.office_meta_whatsapp_evidence with (security_invoker=true) as
  select m.leadgen_id source_id,coalesce(nullif(m.page_id,''),'form:'||nullif(m.form_id,''),'meta-leads') account_id,
    m.captacion_lead_id lead_id,m.cliente_id client_id,m.meta_created_at source_at,
    public.office_meta_whatsapp_answer(m.payload->'lead') answer,
    public.office_meta_whatsapp_number(m.payload->'lead') phone
  from public.meta_lead_events m
    join public.captacion_leads l on l.id=m.captacion_lead_id and l.cliente_id=m.cliente_id
    join public.crm_clientes c on c.id=m.cliente_id
  where m.status='processed' and m.payload#>>'{lead,id}'=m.leadgen_id
    and coalesce(lower(c.origen),'') not like '%orion%' and coalesce(lower(l.origen),'') not like '%orion%';

-- The source, timestamp and both identities must belong to the same submission.
-- Apply this at the write boundary, including rows inserted by older workers.
create function public.office_form_set_whatsapp_consent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.whatsapp_consent := new.verified and exists (
    select from public.office_meta_whatsapp_evidence e where e.source_id=new.source_id and e.account_id=new.account_id
      and e.source_at=new.latest_inbound_at and e.lead_id=new.lead_id and e.client_id=new.client_id and e.answer='granted'
  );
  return new;
end $$;

create trigger office_form_set_whatsapp_consent before insert or update of source_id,latest_inbound_at,whatsapp_consent,lead_id,client_id,account_id,verified
on public.office_capture_opportunities for each row when (new.channel='meta_form' and new.kind='form')
execute function public.office_form_set_whatsapp_consent();

create function public.office_form_verify_whatsapp_target(p_id uuid,p_request uuid,p_phone text) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select from public.office_capture_opportunities o join public.office_meta_whatsapp_evidence e
    on (e.source_id,e.account_id,e.source_at,e.lead_id,e.client_id)=(o.source_id,o.account_id,o.latest_inbound_at,o.lead_id,o.client_id)
    where o.id=p_id and o.request_id=p_request and o.channel='meta_form' and o.kind='form'
      and o.status in ('claimed','dispatching') and o.verified and o.whatsapp_consent and not o.opted_out
      and e.answer='granted' and e.phone=p_phone
      and not exists(select from public.meta_lead_events newer
        where newer.status='processed' and newer.captacion_lead_id=o.lead_id
          and newer.meta_created_at<=now() and (newer.meta_created_at,newer.leadgen_id)>(e.source_at,e.source_id)))
$$;

create function public.office_form_whatsapp_coverage(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare month_start timestamptz:=date_trunc('month',now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
begin
  perform public.office_actor(p_actor);
  return (select jsonb_build_object('month',to_char(month_start at time zone 'Europe/Madrid','YYYY-MM'),
    'submissions',count(*),'granted',count(*) filter(where answer='granted'),
    'declined',count(*) filter(where answer='declined'),'missing',count(*) filter(where answer='missing'),
    'review',count(*) filter(where answer='review'))
    from public.office_meta_whatsapp_evidence where source_at>=month_start and source_at<=now());
end $$;

revoke all on public.office_meta_whatsapp_evidence from public,anon,authenticated,service_role;
grant select on public.office_meta_whatsapp_evidence to service_role;
revoke all on function public.office_meta_whatsapp_answer(jsonb),public.office_meta_whatsapp_number(jsonb),
  public.office_form_set_whatsapp_consent(),public.office_form_verify_whatsapp_target(uuid,uuid,text),
  public.office_form_whatsapp_coverage(uuid) from public,anon,authenticated,service_role;
grant execute on function public.office_meta_whatsapp_answer(jsonb),public.office_meta_whatsapp_number(jsonb),
  public.office_form_set_whatsapp_consent(),public.office_form_verify_whatsapp_target(uuid,uuid,text),
  public.office_form_whatsapp_coverage(uuid) to service_role;
commit;
