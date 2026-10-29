-- Additive tracking from activation onward; historical attendance events are preserved.
-- CLI unavailable on this host; filename uses the verified UTC clock (2026-10-28 22:26:46).
create table if not exists public.attendance_panel_sessions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_activity_at timestamptz not null default now(),
  last_manual_activity_at timestamptz not null default now(),
  call_confirmed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  close_reason text,
  constraint attendance_panel_session_dates check (
    last_activity_at >= started_at and expires_at >= last_activity_at
    and (ended_at is null or ended_at >= started_at)
  ),
  constraint attendance_panel_session_closed check ((ended_at is null) = (close_reason is null))
);
create unique index if not exists attendance_panel_one_open_per_worker
  on public.attendance_panel_sessions(worker_id) where ended_at is null;
create index if not exists attendance_panel_worker_started
  on public.attendance_panel_sessions(worker_id, started_at);
create index if not exists attendance_panel_open_expiry
  on public.attendance_panel_sessions(expires_at) where ended_at is null;
alter table public.attendance_panel_sessions enable row level security;
revoke all on public.attendance_panel_sessions from public, anon, authenticated;
grant select, insert, update on public.attendance_panel_sessions to service_role;

create or replace function public.tc_panel_attendance_event(
  p_worker_id uuid,
  p_action text,
  p_session_id uuid default null,
  p_activity_at timestamptz default null,
  p_call_started_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.attendance_panel_sessions%rowtype;
  v_status text;
  v_event text;
  v_reason text;
  v_end timestamptz;
  v_activity timestamptz;
  v_call boolean := false;
  v_matched boolean := false;
begin
  if p_action not in ('connect','disconnect','break','bathroom','heartbeat','status') then
    raise exception 'BAD_ATTENDANCE_ACTION';
  end if;
  -- Serialize all transitions for one worker, including the first connection.
  perform 1 from public.workers where id=p_worker_id and role in ('admin','central')
    and is_active is distinct from false for update;
  if not found then raise exception 'WORKER_NOT_ALLOWED'; end if;
  v_now := clock_timestamp();

  select * into v_session from public.attendance_panel_sessions
    where worker_id=p_worker_id and ended_at is null for update;
  v_matched := v_session.id is not null and p_session_id=v_session.id;
  -- Accept a recently delivered interaction only if it happened before the
  -- existing deadline. Waking after sleep cannot count as pre-expiry activity.
  if p_action='heartbeat' and v_matched and p_activity_at is not null
    and p_activity_at >= v_now-interval '90 seconds' and p_activity_at <= v_now+interval '5 seconds'
    and p_activity_at <= v_session.expires_at and p_activity_at >= v_session.started_at then
    v_activity := greatest(v_session.last_activity_at,least(v_now,p_activity_at));
    update public.attendance_panel_sessions set last_activity_at=v_activity,
      last_manual_activity_at=greatest(last_manual_activity_at,least(v_now,p_activity_at)),
      expires_at=v_activity+interval '10 minutes' where id=v_session.id returning * into v_session;
  end if;
  -- Only server-verified ongoing calls that began before the deadline can
  -- preserve an existing session. They can never create or reopen a closed one.
  v_call := v_session.id is not null and p_call_started_at is not null
    and p_call_started_at <= v_now and p_call_started_at <= v_session.expires_at
    and (p_action='status' or v_matched);
  if v_call and p_action in ('status','heartbeat') then
    update public.attendance_panel_sessions set last_activity_at=v_now,
      expires_at=v_now+interval '10 minutes',call_confirmed_at=v_now where id=v_session.id returning * into v_session;
  end if;

  if v_session.id is not null and v_session.expires_at <= v_now then
    v_end := greatest(v_session.started_at,v_session.expires_at);
    update public.attendance_panel_sessions set ended_at=v_end,close_reason='inactivity'
      where id=v_session.id;
    insert into public.attendance_events(worker_id,event_type,at,meta)
      values(p_worker_id,'offline',v_end,jsonb_build_object('source','panel_session_v1','session_id',v_session.id,'reason','inactivity','idle_minutes',10));
    insert into public.attendance_state(worker_id,is_online,status,last_event_at,updated_at)
      values(p_worker_id,false,'offline',v_end,v_now)
      on conflict(worker_id) do update set is_online=false,status='offline',last_event_at=v_end,updated_at=v_now;
    v_session.id := null;
    v_reason := 'inactivity';
  end if;

  if p_action='connect' then
    if v_session.id is null then
      insert into public.attendance_panel_sessions(worker_id,started_at,last_activity_at,last_manual_activity_at,expires_at)
        values(p_worker_id,v_now,v_now,v_now,v_now+interval '10 minutes') returning * into v_session;
      v_event := 'online';
    elsif p_session_id is not null and not v_matched then
      return jsonb_build_object('ok',false,'error','SESSION_CHANGED','state_updated',false);
    end if;
    v_status := 'working';
  elsif p_action in ('disconnect','break','bathroom') then
    if v_session.id is not null and not v_matched then
      return jsonb_build_object('ok',false,'error','SESSION_CHANGED','state_updated',false);
    end if;
    if v_session.id is not null then
      update public.attendance_panel_sessions set ended_at=v_now,close_reason=p_action where id=v_session.id;
      v_event := 'offline';
      v_reason := p_action;
    end if;
    v_status := case when p_action='disconnect' then 'offline' else p_action end;
  elsif p_action='heartbeat' then
    if v_session.id is null then
      return jsonb_build_object('ok',true,'online',false,'status','offline','session_id',null,'close_reason',coalesce(v_reason,'connection_required'),'state_updated',true,'server_now',v_now,'idle_timeout_seconds',600);
    end if;
    if not v_matched then
      return jsonb_build_object('ok',false,'error','SESSION_CHANGED','state_updated',false);
    end if;
    v_event := 'heartbeat';
    v_status := 'working';
  else
    select status into v_status from public.attendance_state where worker_id=p_worker_id;
    v_status := case when v_session.id is not null then 'working'
      when v_status in ('break','bathroom') then v_status else 'offline' end;
  end if;

  if v_event is not null then
    insert into public.attendance_events(worker_id,event_type,at,meta)
      values(p_worker_id,v_event,v_now,jsonb_build_object('source','panel_session_v1','session_id',v_session.id,'action',p_action,'reason',v_reason,'call_confirmed',v_call));
  end if;
  insert into public.attendance_state(worker_id,is_online,status,last_event_at,updated_at)
    values(p_worker_id,v_status<>'offline',v_status,v_now,v_now)
    on conflict(worker_id) do update set is_online=excluded.is_online,status=excluded.status,
      last_event_at=case when v_event is not null then v_now else attendance_state.last_event_at end,updated_at=v_now;

  return jsonb_build_object('ok',true,'online',v_status<>'offline','status',v_status,
    'session_id',case when v_status='working' then v_session.id else null end,
    'session_started_at',case when v_status='working' then v_session.started_at else null end,
    'last_activity_at',case when v_status='working' then v_session.last_activity_at else null end,
    'last_manual_activity_at',case when v_status='working' then v_session.last_manual_activity_at else null end,
    'call_confirmed_at',case when v_status='working' then v_session.call_confirmed_at else null end,
    'expires_at',case when v_status='working' then v_session.expires_at else null end,
    'last_event_at',v_now,'server_now',v_now,'close_reason',v_reason,
    'call_active',v_call,'state_updated',true,'idle_timeout_seconds',600);
end;
$$;
revoke all on function public.tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz) to service_role;
comment on table public.attendance_panel_sessions is 'Verified panel work intervals from activation forward; breaks and prior attendance history remain separate.';
