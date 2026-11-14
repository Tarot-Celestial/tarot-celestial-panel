begin;

-- Oracle question grants are fulfilled only by the verified server payment
-- handlers. Their definer RPC must not be callable with forged receipt metadata.
revoke all on function public.grant_cliente_oracle_questions(uuid,integer,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.grant_cliente_oracle_questions(uuid,integer,text,text,jsonb)
  to service_role;

-- Legacy Stripe Oracle checkouts have no CRM payment row. Match their exact
-- server-written receipt, not movement_type alone: daily/rank rewards also use
-- "purchase". Malformed metadata must neither count nor break fulfillment.
create or replace function public.tc_crm_is_paid_stripe_oracle_purchase(
  p_amount integer,p_movement_type text,p_reference text,p_meta jsonb
) returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare session_id text := p_meta->>'stripe_session_id'; paid_amount text := p_meta->>'amount_eur';
begin
  if p_movement_type is distinct from 'purchase' or coalesce(p_amount,0)<=0
    or session_id is null or session_id !~ '^cs_[A-Za-z0-9_]+$'
    or p_reference is distinct from 'stripe:' || session_id
    or paid_amount is null or length(paid_amount)>40
    or paid_amount !~ '^[0-9]+([.][0-9]+)?$'
  then return false; end if;
  return paid_amount::numeric>0;
end;
$$;

create or replace function public.tc_crm_paid_web_activity_event() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name='cliente_payment_attempts' then
    -- Completion is written after provider verification and fulfillment. Never
    -- infer a payment from creation/update timestamps or pending attempts.
    if tg_op='UPDATE' then
      -- Retrying an already completed payment must not manufacture new activity,
      -- even if a provider retry overwrites its completion timestamp.
      if old.status='completed' and old.completed_at is not null then return new; end if;
    end if;
    if new.status='completed' and new.amount>0 and new.completed_at is not null then
      perform public.tc_crm_record_activity(new.cliente_id,new.completed_at,'web_payment_attempt',new.id);
    end if;
  elsif public.tc_crm_is_paid_stripe_oracle_purchase(new.amount,new.movement_type,new.reference,new.meta) then
    perform public.tc_crm_record_activity(new.cliente_id,new.created_at,
      case when tg_table_name='cliente_oracle_credit_movements' then 'stripe_oracle_credit_purchase'
        else 'stripe_oracle_question_purchase' end,new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.tc_crm_is_paid_stripe_oracle_purchase(integer,text,text,jsonb),
  public.tc_crm_paid_web_activity_event() from public,anon,authenticated;
grant execute on function public.tc_crm_is_paid_stripe_oracle_purchase(integer,text,text,jsonb),
  public.tc_crm_paid_web_activity_event() to service_role;

drop trigger if exists tc_crm_month_paid_web_attempt on public.cliente_payment_attempts;
create trigger tc_crm_month_paid_web_attempt after insert or update of status,completed_at,amount,cliente_id
  on public.cliente_payment_attempts for each row execute function public.tc_crm_paid_web_activity_event();
drop trigger if exists tc_crm_month_stripe_oracle_credit on public.cliente_oracle_credit_movements;
create trigger tc_crm_month_stripe_oracle_credit after insert on public.cliente_oracle_credit_movements
  for each row execute function public.tc_crm_paid_web_activity_event();
drop trigger if exists tc_crm_month_stripe_oracle_question on public.cliente_oracle_question_movements;
create trigger tc_crm_month_stripe_oracle_question after insert on public.cliente_oracle_question_movements
  for each row execute function public.tc_crm_paid_web_activity_event();

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
      where public.tc_crm_is_paid_stripe_oracle_purchase(amount,movement_type,reference,meta)
      union all
      select cliente_id,created_at,'stripe_oracle_question_purchase',id from public.cliente_oracle_question_movements
      where public.tc_crm_is_paid_stripe_oracle_purchase(amount,movement_type,reference,meta)
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
