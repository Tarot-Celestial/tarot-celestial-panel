begin;

-- Only identifiers from a known provider may join different physical rows.
-- Free-form manual references, prices and timestamps are not receipt identifiers.
create function public.office_crm_receipt_ref(ref text) returns text
language sql immutable strict security invoker set search_path='' as $$
  select case when ref ~ '^(stripe:)?(cs_|pi_)[A-Za-z0-9_]+$' then 'stripe:'||regexp_replace(ref,'^stripe:','')
    when ref ~ '^tr_[A-Za-z0-9]+$' then 'mollie:'||ref
    when ref ~ '^(mollie:tr_[A-Za-z0-9]+|redsys:[A-Za-z0-9]+|paypal-client:[A-Za-z0-9]+|paypal-capture:[A-Za-z0-9]+)$' then ref end
$$;

create function public.office_crm_receipts(p_cutoff timestamptz)
returns table(client_id uuid,id uuid,source text,at timestamptz,recorded_at timestamptz,
  amount numeric,currency text,status text)
language sql stable security invoker set search_path='' as $$
with recursive observations as materialized (
  select p.cliente_id client_id,p.id,'crm_cliente_pagos'::text source,p.created_at at,p.created_at recorded_at,
    p.importe amount,nullif(upper(trim(p.moneda)),'') currency,
    case when paypal.remote_status='CAPTURE_REFUNDED' then 'refunded'
      when paypal.remote_status='CAPTURE_PARTIALLY_REFUNDED' then 'partially_refunded' else lower(p.estado) end status,
    array[public.office_crm_receipt_ref(p.referencia_externa),public.office_crm_receipt_ref(p.stripe_session_id),
      public.office_crm_receipt_ref(p.payment_intent),public.office_crm_receipt_ref('paypal-client:'||p.paypal_order_id),
      public.office_crm_receipt_ref('paypal-capture:'||p.paypal_capture_id),
      case when p.source_rendimiento_id is not null then 'call:'||p.source_rendimiento_id end] aliases
  from public.crm_cliente_pagos p left join lateral (
    select o.remote_status from public.crm_paypal_orders o where o.payment_id=p.id and o.cliente_id=p.cliente_id
      and o.checkout_kind='client_purchase' and o.status='completed' and o.capture_id=p.paypal_capture_id
      and o.amount=p.importe and o.currency=p.moneda and o.checked_at<=p_cutoff
      and o.remote_status in ('CAPTURE_REFUNDED','CAPTURE_PARTIALLY_REFUNDED')
    order by o.checked_at desc,o.id limit 1
  ) paypal on true
  where p.created_at<=p_cutoff and p.importe>0 and coalesce(p.benefits_context->>'collection_only','false')<>'true'
    and (lower(p.estado) in ('completed','refunded','partially_refunded')
      or (lower(p.estado)='reversed' and (nullif(trim(p.paypal_capture_id),'') is not null or exists (
        select 1 from public.cliente_payment_attempts a where a.cliente_id=p.cliente_id and a.completed_at<=p_cutoff
          and a.status in ('completed','refunded','partially_refunded','reversed') and a.amount=p.importe
          and upper(a.currency)=upper(p.moneda) and p.referencia_externa=a.provider||':'||a.order_id))))
  union all
  select c.id,l.id,'rendimiento_llamadas',coalesce(l.fecha_hora,l.created_at),l.created_at,l.importe,null,'recorded',array[]::text[]
  from public.rendimiento_llamadas l join public.crm_clientes c on c.id::text=btrim(coalesce(l.cliente_id,''))
  where l.cliente_compra_minutos is true and l.importe>0 and l.created_at<=p_cutoff and coalesce(l.fecha_hora,l.created_at)<=p_cutoff
    and not exists(select 1 from public.crm_cliente_pagos p where p.source_rendimiento_id=l.id)
  union all
  select a.cliente_id,a.id,'cliente_payment_attempts',a.completed_at,a.created_at,a.amount,nullif(upper(trim(a.currency)),''),a.status,
    array[public.office_crm_receipt_ref(a.provider||':'||a.order_id)]
  from public.cliente_payment_attempts a
  where a.amount>0 and a.completed_at<=p_cutoff and a.created_at<=p_cutoff and a.status in ('completed','refunded','partially_refunded','reversed')
    and a.provider_response#>>'{metadata,collection_only}' is distinct from 'true'
    -- Preserve the CRM boundary for failed, cancelled and collection-only rows. Valid duplicates below can convey refunds.
    and not exists(select 1 from public.crm_cliente_pagos p where p.cliente_id=a.cliente_id
      and p.referencia_externa=a.provider||':'||a.order_id and
        (p.importe<=0 or lower(p.estado) not in ('completed','refunded','partially_refunded','reversed')
          or p.benefits_context->>'collection_only'='true'))
  union all
  select m.cliente_id,m.id,m.source,m.created_at,m.created_at,(m.meta->>'amount_eur')::numeric,'EUR','completed',
    array[public.office_crm_receipt_ref(m.reference),public.office_crm_receipt_ref(m.meta->>'payment_intent')]
  from (
    select cliente_id,id,created_at,amount,movement_type,reference,meta,'stripe_oracle_credits'::text source from public.cliente_oracle_credit_movements
    union all select cliente_id,id,created_at,amount,movement_type,reference,meta,'stripe_oracle_questions' from public.cliente_oracle_question_movements
  ) m where m.created_at<=p_cutoff and public.tc_crm_is_paid_stripe_oracle_purchase(m.amount,m.movement_type,m.reference,m.meta)
  union all
  select l.cliente_id,l.id,'stripe_chat',l.paid_at,l.created_at,l.amount,'USD','completed',array[public.office_crm_receipt_ref(l.stripe_session_id)]
  from public.cliente_chat_payment_links l where l.status='paid' and l.paid_at<=p_cutoff and l.created_at<=p_cutoff
    and l.amount>0 and l.stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'
  union all
  select m.cliente_id,m.id,'stripe_chat_credits',m.created_at,m.created_at,
    (m.meta->>'amount_usd')::numeric,'USD','completed',
    array[public.office_crm_receipt_ref(m.meta->>'stripe_session_id'),public.office_crm_receipt_ref(m.meta->>'payment_intent')]
  from public.cliente_chat_creditos m where m.tipo='purchase' and m.cantidad>0 and m.created_at<=p_cutoff
    and m.meta->>'stripe_session_id' ~ '^cs_[A-Za-z0-9_]+$' and case when length(m.meta->>'amount_usd')<=40
      and m.meta->>'amount_usd' ~ '^[0-9]+([.][0-9]+)?$' then (m.meta->>'amount_usd')::numeric>0 else false end
), nodes as materialized (
  select o.*,o.source||':'||o.id as node from observations o
), keys as (
  select n.client_id,n.node,k, min(n.node) over(partition by n.client_id,k) as anchor
  from nodes n cross join lateral unnest(n.aliases) k where k is not null
), edges as (
  select client_id,node a,anchor b from keys where node<>anchor
  union select client_id,anchor,node from keys where node<>anchor
), reachable(client_id,node,root) as (
  select client_id,node,node from nodes
  union select e.client_id,e.b,r.root from reachable r join edges e on e.client_id=r.client_id and e.a=r.node
), groups as (
  select client_id,node,min(root) as cluster from reachable group by client_id,node
), members as (
  select n.*,g.cluster from nodes n join groups g using(client_id,node)
)
select m.client_id,
  (array_agg(m.id order by m.at,m.source<>'crm_cliente_pagos',m.source,m.id))[1],
  (array_agg(m.source order by m.at,m.source<>'crm_cliente_pagos',m.source,m.id))[1],
  min(m.at),min(m.recorded_at),
  case when count(distinct m.amount)=1 then min(m.amount) end,
  case when count(distinct m.currency)=1 and min(m.currency) ~ '^[A-Z]{3}$' then min(m.currency) end,
  case when bool_or(m.status='refunded') then 'refunded' when bool_or(m.status='partially_refunded') then 'partially_refunded'
    when bool_or(m.status='reversed') then 'reversed' when bool_or(m.status='completed') then 'completed' else 'recorded' end
from members m group by m.client_id,m.cluster
$$;

-- Keep the phase 4 acquisition date, detail, portfolio and counters on the same verified receipts.
create or replace view public.office_crm_purchase_evidence with (security_invoker=true) as
select * from public.office_crm_receipts(now());

create function public.office_crm_origin_key(raw text) returns text
language sql immutable security invoker set search_path='' as $$
 select case lower(trim(coalesce(raw,'')))
   when 'facebook_ads' then 'meta_lead' when 'meta_ads' then 'meta_lead' when 'meta' then 'meta_lead'
   when 'facebook' then 'facebook' when 'instagram' then 'instagram' when 'whatsapp' then 'whatsapp'
   when 'registro_web' then 'web_registration' when 'web' then 'web_registration' when 'manual' then 'manual'
   when 'referido' then 'referral' when 'referidos' then 'referral' when '' then 'unknown' else 'other_recorded' end
$$;

create function public.office_crm_cohort_report(p_month date,p_as_of timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare report jsonb; start_at timestamptz; end_at timestamptz;
begin
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 or p_as_of is null
    or not isfinite(p_as_of) or p_as_of>now()+interval '1 minute' then raise exception 'OFFICE_INVALID'; end if;
  start_at:=p_month::timestamp at time zone 'Europe/Madrid';
  end_at:=(p_month+interval '1 month') at time zone 'Europe/Madrid';
  if start_at>p_as_of then raise exception 'OFFICE_INVALID'; end if;
  with receipts as materialized (
    select e.*, row_number() over(partition by e.client_id order by e.at,e.source<>'crm_cliente_pagos',e.source,e.id) as seq
    from public.office_crm_receipts(p_as_of) e join public.crm_clientes c on c.id=e.client_id
    where coalesce(lower(c.origen),'') not like '%orion%' and c.created_at<=p_as_of
  ), members as materialized (
    select r.client_id,coalesce(o.origin,public.office_crm_origin_key(c.origen)) origin,
      case when o.origin is not null then 'historical' when public.office_crm_origin_key(c.origen)<>'unknown' then 'current_only' else 'unknown' end basis
    from receipts r
    join public.crm_clientes c on c.id=r.client_id
    left join lateral (
      -- The earliest supported origin is an association with a client, never a claim that a campaign caused a payment.
      select recorded.origin from (
        select greatest(e.received_at,e.inserted_at) at,1 priority,'meta_lead'::text origin
        from public.meta_lead_events e where e.cliente_id=c.id and e.status='processed' and e.inserted_at is not null
        union all select greatest(h.created_at,c.created_at),2,
          case when h.profile->>'source'='instagram' then 'instagram' else 'web_registration' end
          from public.tc_client_registration_challenges h where h.cliente_id=c.id and h.state='completed'
        union all select f.created_at,3,'referral' from public.client_referrals f where f.referred_id=c.id
        union all select l.created_at,4,public.office_crm_origin_key(l.origen) from public.captacion_leads l
          where l.cliente_id=c.id and coalesce(lower(l.origen),'') not like '%orion%' and coalesce(l.updated_at,l.created_at)<=r.at
        union all select c.created_at,5,public.office_crm_origin_key(c.origen) where coalesce(c.updated_at,c.created_at)<=r.at
      ) recorded where recorded.at<=r.at and recorded.origin<>'unknown'
      order by recorded.at,recorded.priority,recorded.origin limit 1
    ) o on true where r.seq=1 and r.at>=start_at and r.at<end_at
  ), amounts as (
    select m.origin,m.basis,r.*,scope.name from members m join receipts r using(client_id)
    cross join (values('first'),('month_to_date'),('lifetime_to_cutoff')) scope(name)
    where scope.name='lifetime_to_cutoff' or (scope.name='month_to_date' and r.at<end_at) or (scope.name='first' and r.seq=1)
  ), slices as (
    select case when grouping(a.origin)=1 then '__all__' else a.origin end origin, a.basis,a.currency,a.name,
      jsonb_build_object('purchases',count(*),'gross',case when a.currency is not null and count(a.amount)=count(*) then sum(a.amount) end,
        'confirmed',case when a.currency is not null and count(a.amount)=count(*) then coalesce(sum(a.amount) filter(where a.status in ('completed','recorded')),0) end,
        'refund_flagged',case when a.currency is not null and count(a.amount)=count(*) then coalesce(sum(a.amount) filter(where a.status in ('refunded','partially_refunded','reversed')),0) end,
        'refund_unknown_count',count(*) filter(where a.status in ('partially_refunded','reversed')),
        'unresolved_count',count(*) filter(where a.currency is null or a.amount is null)) as figures
    from amounts a group by grouping sets ((a.origin,a.basis,a.currency,a.name),(a.currency,a.name))
  ), matrices as (
    select origin,basis,currency,jsonb_object_agg(name,figures) windows from slices group by origin,basis,currency
  ), currencies as (
    select origin,basis,jsonb_agg(jsonb_build_object('currency',currency,'first',empty.value,'month_to_date',empty.value,
      'lifetime_to_cutoff',empty.value)||windows order by currency nulls last) amounts from matrices
    cross join lateral (select jsonb_build_object('purchases',0,'gross',case when currency is not null then 0 end,
      'confirmed',case when currency is not null then 0 end,'refund_flagged',case when currency is not null then 0 end,
      'refund_unknown_count',0,'unresolved_count',0) value) empty group by origin,basis
  ), origins as (
    select m.origin,m.basis,count(*) captured_clients from members m group by m.origin,m.basis
  )
  select jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'zone','Europe/Madrid','as_of',p_as_of,
    'captured_clients',(select count(*) from members),'totals',coalesce((select amounts from currencies where origin='__all__'),'[]'::jsonb),
    'origins',coalesce((select jsonb_agg(jsonb_build_object('origin',o.origin,'basis',o.basis,'captured_clients',o.captured_clients,'amounts',v.amounts)
      order by o.origin,o.basis) from origins o join currencies v using(origin,basis)),'[]'::jsonb)) into report;
  return report;
end $$;

revoke all on function public.office_crm_receipt_ref(text),public.office_crm_receipts(timestamptz),public.office_crm_origin_key(text),
  public.office_crm_cohort_report(date,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.office_crm_receipt_ref(text),public.office_crm_receipts(timestamptz),public.office_crm_origin_key(text),
  public.office_crm_cohort_report(date,timestamptz) to service_role;
commit;
