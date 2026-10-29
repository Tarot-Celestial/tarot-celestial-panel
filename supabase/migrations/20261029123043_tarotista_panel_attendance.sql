-- Extend the existing service-only presence contract to active tarotistas.
-- CLI unavailable on this host; filename uses verified UTC clock 2026-10-29 12:30:43.
alter table public.attendance_panel_sessions
  add column consultation_started_at timestamptz,
  add column consultation_until timestamptz,
  add constraint attendance_panel_consultation_bound check (
    (consultation_started_at is null and consultation_until is null)
    or (consultation_started_at is not null and consultation_until is not null
      and consultation_until > consultation_started_at
      and consultation_until <= consultation_started_at + interval '60 minutes')
  );
comment on column public.attendance_panel_sessions.consultation_until is
  'Self-reported external consultation, explicitly confirmed for at most 60 minutes. Not PBX call verification.';

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
  v_role text;
  v_event text;
  v_reason text;
  v_end timestamptz;
  v_activity timestamptz;
  v_call boolean := false;
  v_matched boolean := false;
begin
  if p_action not in ('connect','disconnect','break','bathroom','heartbeat','status','consultation_start','consultation_end') then
    raise exception 'BAD_ATTENDANCE_ACTION';
  end if;
  -- Serialize all transitions for one worker, including the first connection.
  select role into v_role from public.workers where id=p_worker_id and role in ('admin','central','tarotista')
    and is_active is distinct from false for update;
  if not found then raise exception 'WORKER_NOT_ALLOWED'; end if;
  if p_action in ('consultation_start','consultation_end') and v_role<>'tarotista' then
    raise exception 'WORKER_NOT_ALLOWED';
  end if;
  v_now := clock_timestamp();

  select * into v_session from public.attendance_panel_sessions
    where worker_id=p_worker_id and ended_at is null for update;
  v_matched := v_session.id is not null and p_session_id is not null and p_session_id=v_session.id;
  -- Accept a recently delivered interaction only if it happened before the
  -- existing deadline. Waking after sleep cannot count as pre-expiry activity.
  if p_action='heartbeat' and v_matched and p_activity_at is not null
    and p_activity_at >= v_now-interval '90 seconds' and p_activity_at <= v_now+interval '5 seconds'
    and p_activity_at <= v_session.expires_at and p_activity_at >= v_session.started_at then
    v_activity := greatest(v_session.last_activity_at,least(v_now,p_activity_at));
    update public.attendance_panel_sessions set last_activity_at=v_activity,
      last_manual_activity_at=greatest(last_manual_activity_at,least(v_now,p_activity_at)),
      expires_at=greatest(v_activity+interval '10 minutes',v_session.consultation_until)
      where id=v_session.id returning * into v_session;
  end if;
  -- Only server-verified ongoing calls that began before the deadline can
  -- preserve an existing session. They can never create or reopen a closed one.
  v_call := v_session.id is not null and p_call_started_at is not null
    and p_call_started_at <= v_now and p_call_started_at <= v_session.expires_at
    and (p_action='status' or v_matched);
  if v_call and p_action in ('status','heartbeat') then
    update public.attendance_panel_sessions set last_activity_at=v_now,
      expires_at=greatest(v_now+interval '10 minutes',v_session.consultation_until),call_confirmed_at=v_now
      where id=v_session.id returning * into v_session;
  end if;

  if v_session.id is not null and v_session.expires_at <= v_now then
    v_end := greatest(v_session.started_at,v_session.expires_at);
    v_reason := case when v_session.consultation_until is not null and v_session.expires_at<=v_session.consultation_until
      then 'consultation_timeout' else 'inactivity' end;
    update public.attendance_panel_sessions set ended_at=v_end,close_reason=v_reason
      where id=v_session.id;
    insert into public.attendance_events(worker_id,event_type,at,meta)
      values(p_worker_id,'offline',v_end,jsonb_build_object('source','panel_session_v1','session_id',v_session.id,'reason',v_reason,'idle_minutes',10));
    insert into public.attendance_state(worker_id,is_online,status,last_event_at,updated_at)
      values(p_worker_id,false,'offline',v_end,v_now)
      on conflict(worker_id) do update set is_online=false,status='offline',last_event_at=v_end,updated_at=v_now;
    v_session.id := null;
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
  elsif p_action in ('consultation_start','consultation_end') then
    -- Only a deliberate action on the currently open session can start/extend
    -- this manual mode. Heartbeats, reloads, stale tabs and expired sessions cannot.
    if v_session.id is null then
      return jsonb_build_object('ok',false,'error','PANEL_CONNECTION_REQUIRED','state_updated',false);
    end if;
    if not v_matched then
      return jsonb_build_object('ok',false,'error','SESSION_CHANGED','state_updated',false);
    end if;
    update public.attendance_panel_sessions set
      consultation_started_at=case when p_action='consultation_start' then v_now else null end,
      consultation_until=case when p_action='consultation_start' then v_now+interval '60 minutes' else null end,
      last_activity_at=v_now,last_manual_activity_at=v_now,
      expires_at=v_now+case when p_action='consultation_start' then interval '60 minutes' else interval '10 minutes' end
      where id=v_session.id returning * into v_session;
    v_event := 'online';
    v_status := 'working';
  elsif p_action in ('disconnect','break','bathroom') then
    if v_session.id is not null and not v_matched then
      return jsonb_build_object('ok',false,'error','SESSION_CHANGED','state_updated',false);
    end if;
    if v_session.id is not null then
      update public.attendance_panel_sessions set ended_at=v_now,close_reason=p_action where id=v_session.id;
      -- Preserve tarotista pause metadata consumed by the existing hours reports.
      -- The tracked work interval still ends here; no historical events are rewritten.
      v_event := case when v_role='tarotista' and p_action in ('break','bathroom') then 'online' else 'offline' end;
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
      values(p_worker_id,v_event,v_now,jsonb_build_object('source','panel_session_v1','session_id',v_session.id,'action',p_action,'reason',v_reason,'call_confirmed',v_call)
        || case when v_role='tarotista' and p_action in ('break','bathroom') then jsonb_build_object('phase','start') else '{}'::jsonb end
        || case when p_action in ('consultation_start','consultation_end') then
          jsonb_build_object('consultation_source','self_reported_external_call','consultation_until',v_session.consultation_until)
          else '{}'::jsonb end);
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
    'consultation_started_at',case when v_status='working' and v_session.consultation_until>v_now then v_session.consultation_started_at else null end,
    'consultation_until',case when v_status='working' and v_session.consultation_until>v_now then v_session.consultation_until else null end,
    'consultation_source',case when v_status='working' and v_session.consultation_until>v_now then 'self_reported_external_call' else null end,
    'expires_at',case when v_status='working' then v_session.expires_at else null end,
    'last_event_at',v_now,'server_now',v_now,'close_reason',v_reason,
    'call_active',v_call,'state_updated',true,'idle_timeout_seconds',600);
end;
$$;
revoke all on function public.tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz) to service_role;
