-- TAROT CELESTIAL · CEREBRO CELESTIAL · FASE 6
-- Ciclo de vida de incidentes, historial y comparación entre despliegues.
-- Esta migración ya fue aplicada al proyecto Supabase conectado.

create extension if not exists pgcrypto;

alter table public.brain_observability_events
  add column if not exists status text not null default 'open',
  add column if not exists cycle_started_at timestamptz null,
  add column if not exists reopened_count bigint not null default 0,
  add column if not exists resolved_reason text null,
  add column if not exists resolved_by text null;

update public.brain_observability_events
set cycle_started_at = coalesce(cycle_started_at, first_seen_at, now())
where cycle_started_at is null;

alter table public.brain_observability_events
  alter column cycle_started_at set default now(),
  alter column cycle_started_at set not null;

alter table public.brain_observability_events
  drop constraint if exists brain_observability_events_status_check;

alter table public.brain_observability_events
  add constraint brain_observability_events_status_check
  check (status in ('open','recovering','resolved'));

create index if not exists brain_observability_events_status_seen_idx
  on public.brain_observability_events (status, last_seen_at desc);

create table if not exists public.brain_observability_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.brain_observability_events(id) on delete cascade,
  fingerprint text not null,
  event_type text not null check (event_type in ('opened','occurred','reopened','recovering','resolved')),
  status_after text not null check (status_after in ('open','recovering','resolved')),
  source text not null default 'app',
  severity text not null default 'error' check (severity in ('warning','error','critical')),
  subsystem text not null default 'core',
  route text null,
  code text null,
  title text not null,
  message text not null,
  affected_node_ids text[] not null default '{}',
  occurrences_snapshot bigint not null default 1,
  cycle_started_at timestamptz not null,
  deployment_commit text null,
  deployment_url text null,
  deployment_env text null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists brain_observability_history_event_idx
  on public.brain_observability_history (event_id, occurred_at desc);

create index if not exists brain_observability_history_fingerprint_idx
  on public.brain_observability_history (fingerprint, occurred_at desc);

create index if not exists brain_observability_history_deployment_idx
  on public.brain_observability_history (deployment_commit, occurred_at desc)
  where deployment_commit is not null;

create index if not exists brain_observability_history_type_idx
  on public.brain_observability_history (event_type, occurred_at desc);

alter table public.brain_observability_history enable row level security;

drop policy if exists brain_observability_history_service_role on public.brain_observability_history;
create policy brain_observability_history_service_role
  on public.brain_observability_history
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.brain_observability_history from anon, authenticated;
grant select, insert, update, delete on table public.brain_observability_history to service_role;

create table if not exists public.brain_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  generated_at timestamptz not null default now(),
  deployment_commit text null,
  deployment_url text null,
  deployment_env text null,
  duration_ms integer not null default 0,
  healthy_nodes integer not null default 0,
  attention_nodes integer not null default 0,
  error_nodes integer not null default 0,
  total_nodes integer not null default 0,
  open_incidents integer not null default 0,
  recovering_incidents integer not null default 0,
  resolved_recent integer not null default 0,
  details jsonb not null default '{}'::jsonb
);

create index if not exists brain_health_snapshots_generated_idx
  on public.brain_health_snapshots (generated_at desc);

create index if not exists brain_health_snapshots_deployment_idx
  on public.brain_health_snapshots (deployment_commit, generated_at desc)
  where deployment_commit is not null;

alter table public.brain_health_snapshots enable row level security;

drop policy if exists brain_health_snapshots_service_role on public.brain_health_snapshots;
create policy brain_health_snapshots_service_role
  on public.brain_health_snapshots
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.brain_health_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.brain_health_snapshots to service_role;

create or replace function public.brain_record_observability_event(
  p_fingerprint text,
  p_source text,
  p_severity text,
  p_subsystem text,
  p_route text,
  p_code text,
  p_title text,
  p_message text,
  p_affected_node_ids text[],
  p_metadata jsonb default '{}'::jsonb
)
returns public.brain_observability_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.brain_observability_events;
  v_existing public.brain_observability_events;
  v_severity text;
  v_event_type text;
  v_now timestamptz := clock_timestamp();
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_deployment_commit text := nullif(trim(coalesce(v_meta->>'deployment_commit', '')), '');
  v_deployment_url text := nullif(trim(coalesce(v_meta->>'deployment_url', '')), '');
  v_deployment_env text := nullif(trim(coalesce(v_meta->>'deployment_env', '')), '');
begin
  v_severity := case
    when p_severity in ('warning','error','critical') then p_severity
    else 'error'
  end;

  select *
  into v_existing
  from public.brain_observability_events
  where fingerprint = left(coalesce(nullif(trim(p_fingerprint), ''), 'unknown'), 128)
  for update;

  if not found then
    begin
      insert into public.brain_observability_events (
        fingerprint, source, severity, subsystem, route, code, title, message,
        affected_node_ids, metadata, occurrences, first_seen_at, last_seen_at,
        status, cycle_started_at, reopened_count, resolved_at, resolved_reason, resolved_by, updated_at
      )
      values (
        left(coalesce(nullif(trim(p_fingerprint), ''), 'unknown'), 128),
        left(coalesce(nullif(trim(p_source), ''), 'app'), 40),
        v_severity,
        left(coalesce(nullif(trim(p_subsystem), ''), 'core'), 80),
        nullif(left(coalesce(p_route, ''), 240), ''),
        nullif(left(coalesce(p_code, ''), 80), ''),
        left(coalesce(nullif(trim(p_title), ''), 'Incidente de producción'), 180),
        left(coalesce(nullif(trim(p_message), ''), 'Sin detalle'), 1200),
        coalesce(p_affected_node_ids, '{}'::text[]),
        v_meta,
        1,
        v_now,
        v_now,
        'open',
        v_now,
        0,
        null,
        null,
        null,
        v_now
      )
      returning * into v_row;
      v_event_type := 'opened';
    exception when unique_violation then
      select *
      into v_existing
      from public.brain_observability_events
      where fingerprint = left(coalesce(nullif(trim(p_fingerprint), ''), 'unknown'), 128)
      for update;
    end;
  end if;

  if v_row.id is null then
    v_event_type := case
      when v_existing.status = 'resolved' or v_existing.resolved_at is not null then 'reopened'
      else 'occurred'
    end;

    update public.brain_observability_events
    set source = left(coalesce(nullif(trim(p_source), ''), 'app'), 40),
        severity = case
          when severity = 'critical' then 'critical'
          when v_severity = 'critical' then 'critical'
          when severity = 'error' then 'error'
          else v_severity
        end,
        subsystem = left(coalesce(nullif(trim(p_subsystem), ''), 'core'), 80),
        route = nullif(left(coalesce(p_route, ''), 240), ''),
        code = nullif(left(coalesce(p_code, ''), 80), ''),
        title = left(coalesce(nullif(trim(p_title), ''), 'Incidente de producción'), 180),
        message = left(coalesce(nullif(trim(p_message), ''), 'Sin detalle'), 1200),
        affected_node_ids = coalesce(p_affected_node_ids, '{}'::text[]),
        metadata = metadata || v_meta,
        occurrences = occurrences + 1,
        last_seen_at = v_now,
        status = 'open',
        cycle_started_at = case
          when status = 'resolved' or resolved_at is not null then v_now
          else cycle_started_at
        end,
        reopened_count = case
          when status = 'resolved' or resolved_at is not null then reopened_count + 1
          else reopened_count
        end,
        resolved_at = null,
        resolved_reason = null,
        resolved_by = null,
        updated_at = v_now
    where id = v_existing.id
    returning * into v_row;
  end if;

  insert into public.brain_observability_history (
    event_id, fingerprint, event_type, status_after, source, severity, subsystem,
    route, code, title, message, affected_node_ids, occurrences_snapshot,
    cycle_started_at, deployment_commit, deployment_url, deployment_env, metadata, occurred_at
  )
  values (
    v_row.id, v_row.fingerprint, v_event_type, v_row.status, v_row.source, v_row.severity,
    v_row.subsystem, v_row.route, v_row.code, v_row.title, v_row.message,
    v_row.affected_node_ids, v_row.occurrences, v_row.cycle_started_at,
    v_deployment_commit, v_deployment_url, v_deployment_env, v_meta, v_now
  );

  return v_row;
end;
$$;

revoke all on function public.brain_record_observability_event(
  text, text, text, text, text, text, text, text, text[], jsonb
) from public, anon, authenticated;

grant execute on function public.brain_record_observability_event(
  text, text, text, text, text, text, text, text, text[], jsonb
) to service_role;

create or replace function public.brain_refresh_incident_lifecycle(
  p_recovering_after_minutes integer default 5,
  p_resolve_after_minutes integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_recovering_after interval;
  v_resolve_after interval;
  v_row public.brain_observability_events;
  v_recovering integer := 0;
  v_resolved integer := 0;
  v_meta jsonb;
begin
  p_recovering_after_minutes := greatest(1, least(coalesce(p_recovering_after_minutes, 5), 1440));
  p_resolve_after_minutes := greatest(p_recovering_after_minutes + 1, least(coalesce(p_resolve_after_minutes, 20), 10080));
  v_recovering_after := make_interval(mins => p_recovering_after_minutes);
  v_resolve_after := make_interval(mins => p_resolve_after_minutes);

  for v_row in
    select *
    from public.brain_observability_events
    where status = 'open'
      and resolved_at is null
      and last_seen_at <= v_now - v_recovering_after
      and last_seen_at > v_now - v_resolve_after
    for update skip locked
  loop
    update public.brain_observability_events
    set status = 'recovering', updated_at = v_now
    where id = v_row.id;

    v_meta := coalesce(v_row.metadata, '{}'::jsonb);

    insert into public.brain_observability_history (
      event_id, fingerprint, event_type, status_after, source, severity, subsystem,
      route, code, title, message, affected_node_ids, occurrences_snapshot,
      cycle_started_at, deployment_commit, deployment_url, deployment_env, metadata, occurred_at
    ) values (
      v_row.id, v_row.fingerprint, 'recovering', 'recovering', v_row.source, v_row.severity,
      v_row.subsystem, v_row.route, v_row.code, v_row.title, v_row.message,
      v_row.affected_node_ids, v_row.occurrences, v_row.cycle_started_at,
      nullif(v_meta->>'deployment_commit',''), nullif(v_meta->>'deployment_url',''),
      nullif(v_meta->>'deployment_env',''), jsonb_build_object('reason','silence_window'), v_now
    );

    v_recovering := v_recovering + 1;
  end loop;

  for v_row in
    select *
    from public.brain_observability_events
    where status in ('open','recovering')
      and resolved_at is null
      and last_seen_at <= v_now - v_resolve_after
    for update skip locked
  loop
    update public.brain_observability_events
    set status = 'resolved',
        resolved_at = v_now,
        resolved_reason = 'auto_silence',
        resolved_by = 'brain_lifecycle',
        updated_at = v_now
    where id = v_row.id;

    v_meta := coalesce(v_row.metadata, '{}'::jsonb);

    insert into public.brain_observability_history (
      event_id, fingerprint, event_type, status_after, source, severity, subsystem,
      route, code, title, message, affected_node_ids, occurrences_snapshot,
      cycle_started_at, deployment_commit, deployment_url, deployment_env, metadata, occurred_at
    ) values (
      v_row.id, v_row.fingerprint, 'resolved', 'resolved', v_row.source, v_row.severity,
      v_row.subsystem, v_row.route, v_row.code, v_row.title, v_row.message,
      v_row.affected_node_ids, v_row.occurrences, v_row.cycle_started_at,
      nullif(v_meta->>'deployment_commit',''), nullif(v_meta->>'deployment_url',''),
      nullif(v_meta->>'deployment_env',''),
      jsonb_build_object(
        'reason','auto_silence',
        'silence_minutes', p_resolve_after_minutes,
        'duration_ms', greatest(0, floor(extract(epoch from (v_now - v_row.cycle_started_at)) * 1000)::bigint)
      ),
      v_now
    );

    v_resolved := v_resolved + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'recovering', v_recovering,
    'resolved', v_resolved,
    'checked_at', v_now,
    'recovering_after_minutes', p_recovering_after_minutes,
    'resolve_after_minutes', p_resolve_after_minutes
  );
end;
$$;

revoke all on function public.brain_refresh_incident_lifecycle(integer, integer)
  from public, anon, authenticated;

grant execute on function public.brain_refresh_incident_lifecycle(integer, integer)
  to service_role;
