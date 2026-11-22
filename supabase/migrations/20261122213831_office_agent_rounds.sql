begin;

create function public.office_crm_first_purchase_year(p_actor uuid, p_year int)
returns table(month text, captured_clients bigint)
language plpgsql stable security invoker set search_path='' as $$
declare today_madrid date := (now() at time zone 'Europe/Madrid')::date;
begin
  perform public.office_actor(p_actor);
  if p_year is null or p_year<1000 or p_year>extract(year from today_madrid) then raise exception 'OFFICE_INVALID'; end if;
  return query with firsts as (
    select r.client_id,min(r.at) first_at from public.office_crm_purchase_evidence r
      join public.crm_clientes c on c.id=r.client_id
      where coalesce(lower(c.origen),'') not like '%orion%' and c.created_at<=now()
      and r.at<=now() and r.recorded_at<=now() group by r.client_id
  ), grouped as (
    select date_trunc('month', first_at at time zone 'Europe/Madrid') as start_month,count(*) as n
      from firsts group by 1
  )
  select to_char(d,'YYYY-MM'),coalesce(g.n,0::bigint)
    from generate_series(make_date(p_year,1,1)::timestamp,
      least(make_date(p_year,12,1),today_madrid)::timestamp,interval '1 month') d
    left join grouped g on g.start_month=d order by d;
end $$;
revoke all on function public.office_crm_first_purchase_year(uuid,int) from public, anon, authenticated, service_role;
grant execute on function public.office_crm_first_purchase_year(uuid,int) to service_role;

-- These are internal work receipts. The CRM, both agendas and the accounting ledger
-- remain the systems of record. No names, telephone numbers or ledger entries go here.
create table public.office_agent_booking_reviews (
  source text not null,
  booking_id uuid not null,
  client_id uuid not null,
  signature text not null,
  captured boolean not null,
  reviewed_at timestamptz not null,
  primary key (source, booking_id)
);
create index office_agent_booking_recent on public.office_agent_booking_reviews (reviewed_at desc);
create table public.office_agent_monthly_reports (
  month date primary key,
  revision integer not null check (revision > 0),
  report jsonb not null,
  intake_at timestamptz not null,
  analysis_at timestamptz not null,
  delivered_at timestamptz not null,
  checked_at timestamptz not null
);
alter table public.office_agent_booking_reviews enable row level security;
alter table public.office_agent_monthly_reports enable row level security;
revoke all on public.office_agent_booking_reviews, public.office_agent_monthly_reports from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_booking_reviews, public.office_agent_monthly_reports to service_role;

create view public.office_agent_linked_bookings with (security_invoker = true) as
  select r.id, 'reservas'::text as source, r.cliente_id as client_id,
    r.fecha_reserva at time zone 'UTC' as booked_at, r.estado as state,
    coalesce(r.tarotista_id::text, r.tarotista_nombre_manual, r.tarotista_nombre) as assignee
  from public.reservas r join public.crm_clientes c on c.id=r.cliente_id
  where r.deleted_at is null and coalesce(lower(c.origen),'') not like '%orion%'
  union all
  select r.id, 'first_tarotist_reservations', r.completion_cliente_id, r.scheduled_at,
    r.status, coalesce(r.tarotista_id::text, r.tarotista_name)
  from public.first_tarotist_reservations r join public.crm_clientes c on c.id=r.completion_cliente_id
  where r.brand='celestial' and coalesce(lower(c.origen),'') not like '%orion%';
revoke all on public.office_agent_linked_bookings from public, anon, authenticated, service_role;
grant select on public.office_agent_linked_bookings to service_role;

create function public.office_agent_round() returns jsonb
language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare
  cutoff timestamptz := statement_timestamp();
  current_month date := date_trunc('month', cutoff at time zone 'Europe/Madrid')::date;
  period date;
  result jsonb;
  payload jsonb;
  intake timestamptz;
  analysed timestamptz;
  delivered timestamptz;
  changed integer;
  reviewed integer;
  reports_changed integer := 0;
begin
  if not pg_try_advisory_xact_lock(279404, 5) then
    return jsonb_build_object('busy',true);
  end if;
  -- Re-evaluate previously reviewed reservations as well: a later first purchase or
  -- a change of date / reader / verified CRM identity is a new internal handoff.
  with firsts as (
    select client_id,min(at) first_purchase from public.office_crm_purchase_evidence
    where at<=cutoff and recorded_at<=cutoff group by client_id
  ), verified as (
    select b.*, f.first_purchase is not null as captured,
      md5(jsonb_build_array(b.client_id,b.booked_at,b.state,b.assignee,f.first_purchase)::text) signature
    from public.office_agent_linked_bookings b left join firsts f on f.client_id=b.client_id
  ), pending as (
    select v.* from verified v left join public.office_agent_booking_reviews old
      on old.source=v.source and old.booking_id=v.id
    where old.signature is distinct from v.signature
    order by (v.booked_at>=cutoff) desc nulls last,
      abs(extract(epoch from (v.booked_at-cutoff))) nulls last,v.source,v.id limit 60
  )
  insert into public.office_agent_booking_reviews(source,booking_id,client_id,signature,captured,reviewed_at)
    select source,id,client_id,signature,captured,clock_timestamp() from pending
    on conflict (source,booking_id) do update set client_id=excluded.client_id,signature=excluded.signature,
      captured=excluded.captured,reviewed_at=excluded.reviewed_at;
  get diagnostics reviewed = row_count;

  foreach period in array array[(current_month - interval '1 month')::date,current_month] loop
    result := public.office_crm_cohort_report(period,cutoff);
    intake := clock_timestamp();
    if jsonb_typeof(result->'captured_clients') is distinct from 'number' or
       jsonb_typeof(result->'origins') is distinct from 'array' or
       jsonb_typeof(result->'totals') is distinct from 'array' then
      raise exception 'OFFICE_INCOMPLETE_COHORT';
    end if;
    if (select coalesce(sum((origin->>'captured_clients')::bigint),0) from jsonb_array_elements(result->'origins') origin)
       <> (result->>'captured_clients')::bigint then raise exception 'OFFICE_COHORT_MISMATCH'; end if;
    analysed := clock_timestamp();
    -- All currency groups and unknown amounts are kept as reported by the CRM.
    payload := result - 'as_of';
    delivered := clock_timestamp();
    insert into public.office_agent_monthly_reports(month,revision,report,intake_at,analysis_at,delivered_at,checked_at)
      values(period,1,payload,intake,analysed,delivered,cutoff)
      on conflict(month) do update set revision=office_agent_monthly_reports.revision+1,
        report=excluded.report,intake_at=excluded.intake_at,analysis_at=excluded.analysis_at,
        delivered_at=excluded.delivered_at,checked_at=excluded.checked_at
      where office_agent_monthly_reports.report is distinct from excluded.report;
    get diagnostics changed = row_count;
    reports_changed := reports_changed+changed;
    if changed=0 then update public.office_agent_monthly_reports set checked_at=cutoff where month=period; end if;
  end loop;
  return jsonb_build_object('busy',false,'bookings_reviewed',reviewed,'reports_delivered',reports_changed);
end $$;

create function public.office_agent_activity(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.office_actor(p_actor);
  with bookings as (
    select r.* from public.office_agent_booking_reviews r join public.office_agent_linked_bookings b
      on b.source=r.source and b.id=r.booking_id and b.client_id=r.client_id
    order by r.reviewed_at desc,r.booking_id limit 5
  ), reports as (
    select * from public.office_agent_monthly_reports order by month desc limit 2
  ), events as (
    select r.source||':'||r.booking_id||':'||r.signature id,'cliente:'||r.client_id task_id,
      'Revisión de ficha y reserva' title,'clientes' sender,'captacion-reservas' recipient,
      case when r.captured then 'Ficha con reserva vinculada y primera compra confirmada'
        else 'Ficha con reserva vinculada, pendiente de primera compra' end subject,r.reviewed_at happened_at
    from bookings r
    union all
    select to_char(r.month,'YYYY-MM')||':'||r.revision||':'||h.sender,'cohorte:'||to_char(r.month,'YYYY-MM'),
      'Informe mensual · '||to_char(r.month,'MM/YYYY'),h.sender,h.recipient,h.subject,h.happened_at
    from reports r cross join lateral (values
      ('captacion-reservas','inteligencia',(r.report->>'captured_clients')||' clientes con primera compra',r.intake_at),
      ('inteligencia','finanzas','Clientes agrupados por procedencia registrada',r.analysis_at),
      ('finanzas','atlas','Informe de facturación del CRM por moneda',r.delivered_at)
    ) h(sender,recipient,subject,happened_at)
  )
  select jsonb_build_object('checked_at',(select max(checked_at) from reports),'handoffs',
    coalesce(jsonb_agg(jsonb_build_object('id',id,'taskId',task_id,'taskTitle',title,'from',sender,
      'to',recipient,'what',subject,'at',happened_at) order by happened_at desc,id),'[]'::jsonb))
    into result from events;
  return result;
end $$;
revoke all on function public.office_agent_round(), public.office_agent_activity(uuid) from public, anon, authenticated, service_role;
grant execute on function public.office_agent_round(), public.office_agent_activity(uuid) to service_role;
commit;
