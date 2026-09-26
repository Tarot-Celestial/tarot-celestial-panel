-- TAROT CELESTIAL · CEREBRO CELESTIAL · FASE 5
-- Observabilidad de producción y correlación de incidentes.
-- Esta migración ya fue aplicada al proyecto Supabase conectado.

create table if not exists public.brain_observability_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source text not null default 'app',
  severity text not null default 'error' check (severity in ('warning','error','critical')),
  subsystem text not null default 'core',
  route text null,
  code text null,
  title text not null,
  message text not null,
  affected_node_ids text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  occurrences bigint not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists brain_observability_events_last_seen_idx
  on public.brain_observability_events (last_seen_at desc);

create index if not exists brain_observability_events_active_idx
  on public.brain_observability_events (severity, last_seen_at desc)
  where resolved_at is null;

create index if not exists brain_observability_events_nodes_idx
  on public.brain_observability_events using gin (affected_node_ids);

alter table public.brain_observability_events enable row level security;

drop policy if exists brain_observability_service_role on public.brain_observability_events;
create policy brain_observability_service_role
  on public.brain_observability_events
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.brain_observability_events from anon, authenticated;
grant select, insert, update, delete on table public.brain_observability_events to service_role;

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
  v_severity text;
begin
  v_severity := case
    when p_severity in ('warning','error','critical') then p_severity
    else 'error'
  end;

  insert into public.brain_observability_events (
    fingerprint, source, severity, subsystem, route, code, title, message,
    affected_node_ids, metadata
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
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (fingerprint) do update
    set source = excluded.source,
        severity = case
          when public.brain_observability_events.severity = 'critical' then 'critical'
          when excluded.severity = 'critical' then 'critical'
          when public.brain_observability_events.severity = 'error' then 'error'
          else excluded.severity
        end,
        subsystem = excluded.subsystem,
        route = excluded.route,
        code = excluded.code,
        title = excluded.title,
        message = excluded.message,
        affected_node_ids = excluded.affected_node_ids,
        metadata = public.brain_observability_events.metadata || excluded.metadata,
        occurrences = public.brain_observability_events.occurrences + 1,
        last_seen_at = now(),
        resolved_at = null,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.brain_record_observability_event(
  text, text, text, text, text, text, text, text, text[], jsonb
) from public, anon, authenticated;

grant execute on function public.brain_record_observability_event(
  text, text, text, text, text, text, text, text, text[], jsonb
) to service_role;
