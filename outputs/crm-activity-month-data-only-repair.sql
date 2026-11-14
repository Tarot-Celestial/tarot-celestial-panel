begin;

-- Keep existing catalog IDs (including manual assignments) while presenting
-- case-only variants such as MAYO 2026 with the same canonical spelling.
with labels as (
  select month_name || ' 2026' as label from unnest(array[
    'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
    'Septiembre','Octubre','Noviembre','Diciembre'
  ]) month_name
)
update public.crm_etiquetas e set nombre=labels.label
from labels where lower(e.nombre)=lower(labels.label) and e.nombre<>labels.label;

-- Historical extension of the November repair: one month/year from the latest
-- real 2026 activity. Reuse the live monotonic writer; do not invent activity
-- from login timestamps, profile edits or an existing month tag.
do $$
declare
  activity_row record;
  before_client jsonb;
  before_other_tags uuid[];
  year_start constant timestamptz := '2026-01-01 00:00 Europe/Madrid'::timestamptz;
  year_end constant timestamptz := '2027-01-01 00:00 Europe/Madrid'::timestamptz;
begin
  for activity_row in
    with events as (
      select c.id cliente_id,coalesce(r.fecha_hora,r.created_at) event_at,'call'::text source,r.id source_id
      from public.rendimiento_llamadas r
      join public.crm_clientes c on c.id::text=btrim(r.cliente_id)
      union all
      select cliente_id,created_at,'purchase',id from public.crm_cliente_pagos
      where estado='completed' and importe>0
      union all
      select cliente_id,completed_at,'web_payment_attempt',id from public.cliente_payment_attempts
      where status='completed' and amount>0 and completed_at is not null
      union all
      select cliente_id,created_at,'stripe_oracle_credit_purchase',id from public.cliente_oracle_credit_movements
      where case when movement_type='purchase' and amount>0
        and meta->>'stripe_session_id' ~ '^cs_[A-Za-z0-9_]+$'
        and reference='stripe:' || (meta->>'stripe_session_id')
        and length(meta->>'amount_eur')<=40
        and meta->>'amount_eur' ~ '^[0-9]+([.][0-9]+)?$'
        then (meta->>'amount_eur')::numeric>0 else false end
      union all
      select id,captured_at,'capture',id from public.crm_clientes where captured_at is not null
      union all
      select client_id,created_at,'capture_confirmed',id from public.crm_client_capture_audit
      where action='capture_confirmed'
      union all
      select cliente_id,coalesce(closed_at,updated_at,created_at),'captacion',id from public.captacion_leads
      where estado='captado'
    )
    select distinct on(cliente_id) * from events
    where cliente_id is not null and event_at>=year_start and event_at<year_end and event_at<=now()
    order by cliente_id,event_at desc,source,source_id
  loop
    select to_jsonb(c) into before_client from public.crm_clientes c
    where c.id=activity_row.cliente_id for update;
    if not found then continue; end if;
    select coalesce(array_agg(ce.etiqueta_id order by ce.etiqueta_id),'{}'::uuid[])
      into before_other_tags
    from public.crm_cliente_etiquetas ce join public.crm_etiquetas e on e.id=ce.etiqueta_id
    where ce.cliente_id=activity_row.cliente_id and not public.tc_crm_is_month_tag(e.nombre);

    perform public.tc_crm_record_activity(
      activity_row.cliente_id,activity_row.event_at,activity_row.source,activity_row.source_id
    );

    -- Balances, ranks, profile data, and all non-month associations are invariant.
    if before_client is distinct from (
      select to_jsonb(c) from public.crm_clientes c where c.id=activity_row.cliente_id
    ) then raise exception 'CRM_MONTH_HISTORY_CHANGED_CLIENT_DATA'; end if;
    if before_other_tags is distinct from (
      select coalesce(array_agg(ce.etiqueta_id order by ce.etiqueta_id),'{}'::uuid[])
      from public.crm_cliente_etiquetas ce join public.crm_etiquetas e on e.id=ce.etiqueta_id
      where ce.cliente_id=activity_row.cliente_id and not public.tc_crm_is_month_tag(e.nombre)
    ) then raise exception 'CRM_MONTH_HISTORY_CHANGED_NON_MONTH_TAGS'; end if;
  end loop;
end;
$$;

set constraints tc_crm_month_tag_guard immediate;
commit;
