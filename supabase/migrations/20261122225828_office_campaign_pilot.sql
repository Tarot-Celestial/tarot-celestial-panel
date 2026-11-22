begin;

-- Meta supplies campaign IDs independently of mutable CRM labels. A processed form
-- must point to the same customer via both foreign keys, as in phase 6.
create view public.office_campaign_form_evidence with (security_invoker=true) as
select e.leadgen_id,e.captacion_lead_id as lead_id,e.cliente_id as client_id,
  coalesce(nullif(e.page_id,''),'form:'||nullif(e.form_id,''),'meta-leads') as account_key,
  coalesce(e.meta_created_at,e.received_at) as at, coalesce(e.inserted_at,e.received_at) as recorded_at,
  case when e.campaign_id ~ '^[0-9]{1,40}$' then e.campaign_id
    when nullif(e.campaign_id,'') is null and e.form_id ~ '^[0-9]{1,40}$' then 'form-'||e.form_id end as campaign_key,
  case when e.campaign_id ~ '^[0-9]{1,40}$' then left(coalesce(nullif(trim(e.payload#>>'{lead,campaign_name}'),''),nullif(trim(l.campaign_name),'')),140)
       else left(coalesce(nullif(trim(e.payload#>>'{lead,form_name}'),''),nullif(trim(l.form_name),'')),140) end as label,
  case lower(coalesce(e.payload#>>'{lead,platform}','')) when 'ig' then 'instagram' when 'instagram' then 'instagram'
       when 'fb' then 'facebook' when 'facebook' then 'facebook' else 'meta_form' end as channel
from public.meta_lead_events e join public.captacion_leads l on l.id=e.captacion_lead_id and l.cliente_id=e.cliente_id
join public.crm_clientes c on c.id=e.cliente_id
where e.status='processed' and nullif(trim(e.leadgen_id),'') is not null
  and coalesce(lower(c.origen),'') not like '%orion%' and coalesce(lower(l.origen),'') not like '%orion%'
  and not exists(select 1 from public.meta_lead_events other where other.leadgen_id=e.leadgen_id and other.status='processed'
    and other.cliente_id is not null and other.cliente_id<>e.cliente_id);
revoke all on public.office_campaign_form_evidence from public,anon,authenticated,service_role;
grant select on public.office_campaign_form_evidence to service_role;

create table public.office_campaign_cost_evidence(
  id uuid primary key default gen_random_uuid(), campaign_id text not null check(campaign_id~'^[0-9]{1,40}$'),
  account_id text not null check(account_id~'^[0-9]{1,40}$'), currency text not null check(currency~'^[A-Z]{3}$'),
  account_zone text not null, from_day date not null, through_day date not null, spend numeric(20,6) not null check(spend>=0),
  file_sha256 text not null check(file_sha256~'^[a-f0-9]{64}$'), source_kind text not null check(source_kind='ads_manager_csv'),
  worker_id uuid not null references public.workers(id), recorded_at timestamptz not null default now(),
  unique(campaign_id,from_day,through_day),check(from_day<=through_day)
);
alter table public.office_campaign_cost_evidence enable row level security;
revoke all on public.office_campaign_cost_evidence from public,anon,authenticated,service_role;
grant select,insert on public.office_campaign_cost_evidence to service_role;

create function public.office_pilot_record_csv(p_actor uuid,p_campaign text,p_account text,p_currency text,p_zone text,
  p_from date,p_through date,p_spend numeric,p_sha256 text) returns uuid
language plpgsql volatile security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); receipt uuid;
begin
  if actor is null or p_spend is null or p_spend<0 or p_spend>99999999999999 or p_spend<>round(p_spend,6)
    or p_from is null or extract(day from p_from)<>1 or p_through is null or p_through<p_from or p_through>=(p_from+interval '1 month')::date
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone)
    or p_through>(now() at time zone p_zone)::date or not exists(select 1 from public.office_campaign_form_evidence where campaign_key=p_campaign) then raise exception 'OFFICE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('office:pilot:spend:'||p_campaign,0));
  if exists(select 1 from public.office_campaign_cost_evidence where campaign_id=p_campaign and (account_id,currency,account_zone) is distinct from (p_account,p_currency,p_zone)) then raise exception 'OFFICE_CONFLICT'; end if;
  insert into public.office_campaign_cost_evidence(campaign_id,account_id,currency,account_zone,from_day,through_day,spend,file_sha256,source_kind,worker_id)
    values(p_campaign,p_account,p_currency,p_zone,p_from,p_through,p_spend,p_sha256,'ads_manager_csv',actor)
    on conflict(campaign_id,from_day,through_day) do nothing returning id into receipt;
  if receipt is null then
    select id into receipt from public.office_campaign_cost_evidence where campaign_id=p_campaign and from_day=p_from and through_day=p_through
      and account_id=p_account and account_zone=p_zone and currency=p_currency and spend=p_spend and file_sha256=p_sha256;
    if receipt is null then raise exception 'OFFICE_CONFLICT'; end if;
  end if;
  return receipt;
end $$;

create function public.office_pilot_catalog(p_actor uuid,p_month date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); data jsonb;
begin
  if actor is null or p_month is null or extract(day from p_month)<>1 then raise exception 'OFFICE_INVALID'; end if;
  -- Include contacts at either boundary of a verified ad account's possible time zone.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.contacts desc,x.id),'[]'::jsonb) into data from (
    select campaign_key id,(array_agg(label order by at desc,leadgen_id) filter(where label is not null))[1] name,count(distinct client_id) contacts
    from public.office_campaign_form_evidence where campaign_key is not null and recorded_at<=now() and at<=now()
      and at>=(p_month::timestamp at time zone 'UTC')-interval '14 hours'
      and at<((p_month+interval '1 month') at time zone 'UTC')+interval '12 hours'
    group by campaign_key
  ) x;
  return data;
end $$;

create function public.office_campaign_pilot(p_actor uuid,p_campaign text,p_month date,p_zone text,p_as_of timestamptz,
  p_after_at timestamptz default null,p_after_client uuid default null,p_through date default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); report jsonb; period_start timestamptz; period_end timestamptz; cost_end timestamptz;
begin
  if actor is null or p_campaign!~'^(form-)?[0-9]{1,40}$' or p_month is null or extract(day from p_month)<>1
    or p_as_of is null or p_as_of>clock_timestamp()+interval '5 seconds' or (p_after_at is null)<>(p_after_client is null)
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone)
    or (p_through is not null and (p_through<p_month or p_through>=(p_month+interval '1 month')::date)) then raise exception 'OFFICE_INVALID'; end if;
  period_start:=p_month::timestamp at time zone p_zone;
  period_end:=(p_month+interval '1 month') at time zone p_zone;
  cost_end:=coalesce((p_through+1)::timestamp,p_month+interval '1 month') at time zone p_zone;
  with e as materialized (select * from public.office_campaign_form_evidence where at<=p_as_of and recorded_at<=p_as_of),
  contacts as materialized (select distinct client_id from e where campaign_key=p_campaign and at>=period_start and at<period_end),
  first_form as (
    select a.*,min(at) over(partition by account_key,lead_id,client_id) first_at from e a
  ), forms as (
    select account_key,lead_id,client_id,first_at as contact_at,
      case when count(distinct campaign_key)=1 and count(campaign_key)=count(*) then min(campaign_key) end campaign_key,
      case when count(distinct channel)=1 then min(channel) else 'meta_form' end channel,
      md5(jsonb_build_array('tc:meta:form',account_key,lead_id)::text)::uuid as logical_id
    from first_form where at=first_at group by account_key,lead_id,client_id,first_at
  ), links as (
    select client_id,contact_at,0 as priority,opportunity_id as logical_id,null::text as campaign_key,null::text as account_key,null::uuid as lead_id,channel
    from public.office_meta_verified_clients b where b.bound_at<=p_as_of
    union all select client_id,contact_at,1,logical_id,campaign_key,account_key,lead_id,channel from forms
  ), owners as (
    select distinct on(l.client_id) l.* from links l order by l.client_id,l.contact_at,l.priority,l.logical_id
  ), attributed as materialized (
    select o.* from owners o where o.campaign_key is not null and not exists(
      select 1 from links l where l.client_id=o.client_id and l.contact_at=o.contact_at and l.campaign_key is distinct from o.campaign_key)
  ), acquired as materialized (
    select * from attributed where campaign_key=p_campaign and contact_at>=period_start and contact_at<period_end
  ), receipts as materialized (
    select r.* from public.office_crm_receipts(p_as_of) r join public.crm_clientes c on c.id=r.client_id
    where coalesce(lower(c.origen),'') not like '%orion%'
    and not exists(select 1 from public.crm_cliente_pagos p where r.source='crm_cliente_pagos' and p.id=r.id and p.cliente_id=r.client_id and
      (p.stripe_session_id ~ '^cs_test_' or p.referencia_externa ~ '^(stripe:)?cs_test_' or p.benefits_context->>'livemode'='false'))
    and not exists(select 1 from public.cliente_oracle_credit_movements m where r.source='stripe_oracle_credits' and m.id=r.id and m.cliente_id=r.client_id and
      (m.reference ~ '^(stripe:)?cs_test_' or m.meta->>'stripe_session_id' ~ '^cs_test_' or m.meta->>'livemode'='false'))
    and not exists(select 1 from public.cliente_oracle_question_movements m where r.source='stripe_oracle_questions' and m.id=r.id and m.cliente_id=r.client_id and
      (m.reference ~ '^(stripe:)?cs_test_' or m.meta->>'stripe_session_id' ~ '^cs_test_' or m.meta->>'livemode'='false'))
    and not exists(select 1 from public.cliente_chat_payment_links m where r.source='stripe_chat' and m.id=r.id and m.cliente_id=r.client_id and m.stripe_session_id ~ '^cs_test_')
    and not exists(select 1 from public.cliente_chat_creditos m where r.source='stripe_chat_credits' and m.id=r.id and m.cliente_id=r.client_id and m.meta->>'stripe_session_id' ~ '^cs_test_')
    and not exists(select 1 from public.cliente_payment_attempts t where r.source='cliente_payment_attempts' and t.id=r.id and t.cliente_id=r.client_id
        and (t.order_id ~ '^cs_test_' or t.provider_response->>'livemode'='false'))
  ), first_receipts as (
    select distinct on(client_id) * from receipts order by client_id,at,source<>'crm_cliente_pagos',source,id
  ), unattributed as (
    select count(*) total from first_receipts r where r.at>=period_start and r.at<period_end and not exists(
      select 1 from attributed a where a.client_id=r.client_id and a.contact_at<r.at and a.campaign_key ~ '^[0-9]{1,40}$')
  ), buyers as materialized (
    select a.*,f.id as receipt_id,f.at as purchase_at,f.source,f.amount,f.currency,f.status
    from acquired a join first_receipts f using(client_id) where f.at>a.contact_at
  ), amounts as (
    select r.currency,count(*) receipts,count(*) filter(where b.receipt_id=r.id and r.source=b.source) first_count,
      case when count(*) filter(where b.receipt_id=r.id and r.source=b.source and r.amount is null)=0
        then coalesce(sum(r.amount) filter(where b.receipt_id=r.id and r.source=b.source),0) end first_gross,
      case when count(r.amount)=count(*) then sum(r.amount) end gross,
      count(*) filter(where r.status in ('refunded','partially_refunded','reversed')) refund_flagged,
      case when count(*) filter(where r.amount is null and r.status in ('recorded','completed'))=0 then coalesce(sum(r.amount) filter(where r.status in ('recorded','completed')),0) end confirmed
    from receipts r join buyers b using(client_id) group by r.currency
  ), batch as materialized (
    select * from buyers where p_after_client is null or (purchase_at,client_id)<(p_after_at,p_after_client)
    order by purchase_at desc,client_id desc limit 26
  ), details as (
    select b.client_id,b.lead_id,b.contact_at,b.channel,b.purchase_at,b.source,b.amount,b.currency,b.status,
      (select jsonb_agg(x.event order by x.at) from (
        select a.completed_at at,jsonb_build_object('kind','automated','at',a.completed_at,'route',a.route) as event
        from public.office_capture_opportunities o join public.office_capture_attempts a on a.opportunity_id=o.id
        where o.channel='meta_form' and o.kind='form' and o.account_id=b.account_key and o.lead_id=b.lead_id and o.client_id=b.client_id
          and a.outcome='sent' and nullif(a.receipt_id,'') is not null and a.completed_at between b.contact_at and b.purchase_at
        union all
        select ch.created_at,jsonb_build_object('kind','commercial','at',ch.created_at,'route',ch.action,'operator',w.display_name)
        from public.office_capture_opportunities o join public.office_commercial_changes ch on ch.opportunity_id=o.id
        left join public.workers w on w.id=ch.actor_id
        where o.client_id=b.client_id and (o.lead_id=b.lead_id or exists(select 1 from public.office_meta_verified_clients v
          where v.opportunity_id=o.id and v.client_id=b.client_id and v.bound_at<=ch.created_at))
          and ch.created_at between b.contact_at and b.purchase_at
        union all
        select evidence.at,jsonb_build_object('kind','whatsapp','at',evidence.at,'route','whatsapp','operator',w.display_name)
        from public.captacion_whatsapp_deliveries d left join public.workers w on w.id=d.worker_id
        cross join lateral (select coalesce(min(t.created_at),case when d.status in ('accepted','sent','delivered','read') then d.updated_at end) at
          from public.captacion_whatsapp_delivery_events t where t.delivery_id=d.id and t.message_sid=d.message_sid
            and t.status in ('accepted','sent','delivered','read')) evidence
        where d.lead_id=b.lead_id and d.cliente_id=b.client_id and nullif(d.message_sid,'') is not null
          and exists(select 1 from e where client_id=b.client_id and lead_id=b.lead_id and account_key=b.account_key and campaign_key=p_campaign and d.submission_key='meta:'||e.leadgen_id)
          and evidence.at between b.contact_at and b.purchase_at and not exists(select 1 from public.office_capture_attempts a where a.request_id=d.request_id or a.receipt_id=d.message_sid)
      ) x) as handling,
      (select w.display_name from public.rendimiento_llamadas l join public.workers w on w.id::text=trim(l.telefonista_worker_id)
        where trim(l.cliente_id)=b.client_id::text and (b.source='rendimiento_llamadas' and l.id=b.receipt_id or b.source='crm_cliente_pagos' and exists(
          select 1 from public.crm_cliente_pagos p where p.id=b.receipt_id and p.cliente_id=b.client_id and p.source_rendimiento_id=l.id)) limit 1) as call_operator
    from (select * from batch order by purchase_at desc,client_id desc limit 25) b
  )
  select jsonb_build_object('campaign',p_campaign,'month',to_char(p_month,'YYYY-MM'),'zone',p_zone,'as_of',p_as_of,
    'contacts',(select count(*) from contacts),'first_buyers',(select count(*) from buyers),'cost_first_buyers',(select count(*) from buyers where contact_at<cost_end),
    'unattributed_first_purchases',(select total from unattributed),
    'amounts',coalesce((select jsonb_agg(to_jsonb(a) order by currency nulls last) from amounts a),'[]'::jsonb),
    'buyers',coalesce((select jsonb_agg(to_jsonb(d) order by purchase_at desc,client_id desc) from details d),'[]'::jsonb),
    'has_more',(select count(*)>25 from batch)) into report;
  return report;
end $$;
revoke all on function public.office_pilot_catalog(uuid,date),public.office_pilot_record_csv(uuid,text,text,text,text,date,date,numeric,text),
 public.office_campaign_pilot(uuid,text,date,text,timestamptz,timestamptz,uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.office_pilot_catalog(uuid,date),public.office_pilot_record_csv(uuid,text,text,text,text,date,date,numeric,text),
 public.office_campaign_pilot(uuid,text,date,text,timestamptz,timestamptz,uuid,date) to service_role;
commit;
