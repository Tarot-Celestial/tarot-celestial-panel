-- Read-only verification of the complete 2026 activity cohort.
-- Mirrors the historical migration without depending on its new functions.
with stripe_rows as (
  select cliente_id,created_at event_at,id source_id,'stripe_oracle_credit_purchase'::text source,
    amount,movement_type,reference,meta from public.cliente_oracle_credit_movements
  union all
  select cliente_id,created_at,id,'stripe_oracle_question_purchase',
    amount,movement_type,reference,meta from public.cliente_oracle_question_movements
), paid_stripe as (
  select cliente_id,event_at,source,source_id from stripe_rows
  where movement_type='purchase' and amount>0
    and meta->>'stripe_session_id' ~ '^cs_[A-Za-z0-9_]+$'
    and reference='stripe:' || (meta->>'stripe_session_id')
    and case when length(meta->>'amount_eur')<=40
      and meta->>'amount_eur' ~ '^[0-9]+([.][0-9]+)?$'
      then (meta->>'amount_eur')::numeric>0 else false end
), events as (
  select c.id cliente_id,coalesce(r.fecha_hora,r.created_at) event_at,'call'::text source,r.id source_id
  from public.rendimiento_llamadas r join public.crm_clientes c on c.id::text=btrim(r.cliente_id)
  union all
  select cliente_id,created_at,'purchase',id from public.crm_cliente_pagos where estado='completed' and importe>0
  union all
  select cliente_id,completed_at,'web_payment_attempt',id from public.cliente_payment_attempts
  where status='completed' and amount>0 and completed_at is not null
  union all
  select cliente_id,event_at,source,source_id from paid_stripe
  union all
  select id,captured_at,'capture',id from public.crm_clientes where captured_at is not null
  union all
  select client_id,created_at,'capture_confirmed',id from public.crm_client_capture_audit where action='capture_confirmed'
  union all
  select cliente_id,coalesce(closed_at,updated_at,created_at),'captacion',id from public.captacion_leads where estado='captado'
), latest as (
  select distinct on(e.cliente_id) e.*
  from events e join public.crm_clientes c on c.id=e.cliente_id
  where event_at>='2026-01-01 00:00 Europe/Madrid'::timestamptz
    and event_at<'2027-01-01 00:00 Europe/Madrid'::timestamptz and event_at<=now()
  order by e.cliente_id,event_at desc,source,source_id
), expected as (
  select l.*,to_char(event_at at time zone 'Europe/Madrid','YYYY-MM') month_key,
    (array['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])
      [extract(month from event_at at time zone 'Europe/Madrid')::integer] || ' 2026' label
  from latest l
), checked as (
  select x.*,a.last_activity_at tracked_at,
    coalesce((select array_agg(e.nombre order by e.nombre)
      from public.crm_cliente_etiquetas ce join public.crm_etiquetas e on e.id=ce.etiqueta_id
      where ce.cliente_id=x.cliente_id and public.tc_crm_is_month_tag(e.nombre)),'{}'::text[]) month_labels
  from expected x left join public.crm_client_activity_month a on a.cliente_id=x.cliente_id
)
select jsonb_build_object(
  'observed_at',now(),
  'qualifying_clients',(select count(*) from checked),
  'exact_label_mismatches',(select count(*) from checked where month_labels is distinct from array[label]),
  'untracked_clients',(select count(*) from checked where tracked_at is null),
  'tracked_older_than_latest',(select count(*) from checked where tracked_at<event_at),
  'months',(select jsonb_object_agg(month_key,n) from (select month_key,count(*) n from checked group by month_key order by month_key) m),
  'latest_sources',(select jsonb_object_agg(source,n) from (select source,count(*) n from checked group by source order by source) s),
  'paid_stripe_ledger_rows',(select count(*) from paid_stripe),
  'completed_positive_attempts',(select count(*) from public.cliente_payment_attempts where status='completed' and amount>0 and completed_at is not null)
) audit;

