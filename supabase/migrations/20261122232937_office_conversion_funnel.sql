begin;

create function public.office_conversion_funnel(p_actor uuid,p_campaign text,p_month date,p_zone text,p_as_of timestamptz,
  p_country_names jsonb, p_after_at timestamptz default null,p_after_client uuid default null,p_through date default null) returns jsonb
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
  ), entries as materialized (
    select form.* from e form where form.campaign_key=p_campaign and form.at>=period_start and form.at<period_end
  ), enrolled as materialized (
    select client_id, min(at) as entered_at from entries group by client_id
  ), declared_markets as (
    select e.client_id, count(distinct known.country) as choices, min(known.country) as country
    from entries e join public.meta_lead_events m on m.leadgen_id=e.leadgen_id and m.captacion_lead_id=e.lead_id
      and m.cliente_id=e.client_id and m.status='processed' and coalesce(m.inserted_at,m.received_at)<=p_as_of
    cross join lateral jsonb_array_elements(case when jsonb_typeof(m.payload#>'{lead,field_data}')='array'
      then m.payload#>'{lead,field_data}' else '[]'::jsonb end) field
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(field->'values')='array'
      then field->'values' else '[]'::jsonb end) answer
    cross join lateral (select p_country_names->>lower(trim(answer)) as country) known
    where lower(trim(field->>'name')) in ('country','country_code','pais','país','país_de_residencia','pais_de_residencia','country_of_residence')
    group by e.client_id
  ), form_attempts as (
    select e.client_id, a.completed_at as at, a.route
    from entries e join public.office_capture_opportunities o
      on o.channel='meta_form' and o.kind='form' and o.account_id=e.account_key
      and o.lead_id=e.lead_id and o.client_id=e.client_id
    join public.office_capture_attempts a on a.opportunity_id=o.id and a.source_id=e.leadgen_id
    where a.outcome='sent' and nullif(trim(a.receipt_id),'') is not null and a.completed_at between e.at and p_as_of
      -- A template receipt can precede a later provider delivery failure. Use its ledger below.
      and a.route<>'whatsapp_template'
  ), whatsapp_receipts as (
    select e.client_id, delivery.at, 'whatsapp_template'::text as route
    from entries e join public.captacion_whatsapp_deliveries d on d.lead_id=e.lead_id and d.cliente_id=e.client_id
      and d.submission_key='meta:'||e.leadgen_id and nullif(trim(d.message_sid),'') is not null
    cross join lateral (
      select coalesce(min(h.created_at) filter(where h.status in ('accepted','sent','delivered','read')),
        case when d.updated_at<=p_as_of and d.status in ('accepted','sent','delivered','read') then d.updated_at end) as at,
        (array_agg(h.status order by h.created_at desc,h.id desc))[1] as last_status
      from public.captacion_whatsapp_delivery_events h where h.delivery_id=d.id and h.message_sid=d.message_sid and h.created_at<=p_as_of
    ) delivery
    where delivery.at between e.at and p_as_of
      and coalesce(case when d.updated_at<=p_as_of then d.status end,delivery.last_status,'') not in ('failed','undelivered')
  ), bound_threads as materialized (
    -- Only the attributed customer and their identity-confirmed private conversation can contribute.
    select distinct v.client_id, o.id, o.thread_id, o.channel, greatest(a.contact_at,v.contact_at) as earliest
    from acquired a join public.office_meta_verified_clients v on v.client_id=a.client_id and v.bound_at<=p_as_of
    join public.office_capture_opportunities o on o.id=v.opportunity_id and o.kind='message' and o.channel=v.channel
      and (o.client_id is null or o.client_id=v.client_id)
    where v.contact_at>=a.contact_at
  ), digital as (
    select * from form_attempts union all select * from whatsapp_receipts
    union all
    select t.client_id, s.completed_at, s.route from bound_threads t
    join public.office_capture_attempts s on s.opportunity_id=t.id and s.outcome='sent' and nullif(trim(s.receipt_id),'') is not null
    where s.completed_at between t.earliest and p_as_of
    union all
    select t.client_id, s.completed_at, null::text from bound_threads t join public.tc_instagram_sends s on t.channel='instagram' and s.thread_id=t.thread_id
    where (s.status='sent' or (s.status='confirmed_sent' and s.resolved_at<=p_as_of))
      and nullif(trim(s.remote_message_id),'') is not null and s.completed_at between t.earliest and p_as_of
    union all
    select t.client_id, s.completed_at, null::text from bound_threads t join public.tc_facebook_sends s on t.channel='facebook' and s.thread_id=t.thread_id
    where (s.status='sent' or (s.status='confirmed_sent' and s.resolved_at<=p_as_of))
      and nullif(trim(s.remote_message_id),'') is not null and s.completed_at between t.earliest and p_as_of
  ), first_response as (
    select client_id,min(at) replied_at, bool_or(route='phone') as phone_routed, bool_or(route='oracle') as oracle_routed
    from digital group by client_id
  ), consultations as (
    -- A recorded consultation is a distinct observation. It does not establish an outbound callback.
    select distinct n.client_id from enrolled n join public.rendimiento_llamadas l on l.cliente_id=n.client_id::text
    where l.created_at<=p_as_of and l.fecha_hora between n.entered_at and p_as_of and l.tiempo>0 and (l.usa_minutos or l.usa_7_free)
  ), conversion as (
    select n.client_id,n.entered_at,b.purchase_at,r.replied_at,r.phone_routed,r.oracle_routed,
      case when m.choices=1 then m.country when coalesce(m.choices,0)=0 and length(c.pais)<=80
        then p_country_names->>lower(trim(c.pais)) end as country,
      n.entered_at+interval '168 hours' as day_seven, t.client_id is not null as consultation
    from enrolled n join public.crm_clientes c on c.id=n.client_id
    left join declared_markets m using(client_id)
    left join first_response r using(client_id) left join buyers b using(client_id) left join consultations t using(client_id)
  ), breakdown as materialized (
    select grouping(country) is_total,country,count(*) as contacts,count(replied_at) as replied,
      round((percentile_cont(0.5) within group(order by extract(epoch from replied_at-entered_at)/60))::numeric,1) as median_reply_minutes,
      count(purchase_at) as first_buyers,count(*) filter(where replied_at<purchase_at) as buyers_after_reply,
      count(*) filter(where phone_routed) as phone_routed,count(*) filter(where oracle_routed) as oracle_routed,
      count(*) filter(where replied_at is null and purchase_at is null) as without_reply_or_purchase,
      count(*) filter(where day_seven<=p_as_of) as matured_contacts,
      count(*) filter(where day_seven<=p_as_of and purchase_at<=day_seven) as buyers_within_7d,
      count(*) filter(where consultation) as recorded_consultations
    from conversion group by grouping sets((country),())
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
    'funnel',case when p_country_names is not null and p_campaign is not null then jsonb_build_object(
      'total',(select to_jsonb(x)-'is_total' from breakdown x where is_total=1),
      'countries',coalesce((select jsonb_agg(to_jsonb(x)-'is_total' order by contacts desc,country nulls last) from breakdown x where is_total=0),'[]'::jsonb)) end,
    'amounts',coalesce((select jsonb_agg(to_jsonb(a) order by currency nulls last) from amounts a),'[]'::jsonb),
    'buyers',coalesce((select jsonb_agg(to_jsonb(d) order by purchase_at desc,client_id desc) from details d),'[]'::jsonb),
    'has_more',(select count(*)>25 from batch)) into report;
  return report;
end $$;

-- The prior API and administrative SQL continue to use the same attribution and purchase normalizer.
create or replace function public.office_campaign_pilot(p_actor uuid,p_campaign text,p_month date,p_zone text,p_as_of timestamptz,
  p_after_at timestamptz default null,p_after_client uuid default null,p_through date default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  select public.office_conversion_funnel(p_actor,p_campaign,p_month,p_zone,p_as_of,null,p_after_at,p_after_client,p_through)-'funnel'
$$;

revoke all on function public.office_conversion_funnel(uuid,text,date,text,timestamptz,jsonb,timestamptz,uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.office_conversion_funnel(uuid,text,date,text,timestamptz,jsonb,timestamptz,uuid,date) to service_role;
commit;
