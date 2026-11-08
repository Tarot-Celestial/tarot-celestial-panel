-- Private signaling only. No audio is recorded or stored.
create table if not exists public.staff_panel_calls (
  id uuid primary key,
  thread_id uuid not null references public.chat_threads(id),
  caller_worker_id uuid not null references public.workers(id),
  callee_worker_id uuid not null references public.workers(id),
  caller_name text not null,
  callee_name text not null,
  caller_tab_id uuid not null,
  callee_tab_id uuid,
  status text not null default 'ringing' check (status in ('ringing','accepted','ended','rejected','missed','failed')),
  offer_sdp text check (length(offer_sdp) <= 48000),
  answer_sdp text check (length(answer_sdp) <= 48000),
  created_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null,
  caller_seen_at timestamptz not null default clock_timestamp(),
  callee_seen_at timestamptz,
  check (caller_worker_id <> callee_worker_id)
);
create index if not exists staff_panel_calls_caller_active_idx on public.staff_panel_calls(caller_worker_id,created_at desc);
create index if not exists staff_panel_calls_callee_active_idx on public.staff_panel_calls(callee_worker_id,created_at desc);
create index if not exists staff_panel_calls_thread_idx on public.staff_panel_calls(thread_id);
create index if not exists staff_panel_calls_expiry_idx on public.staff_panel_calls(expires_at) where status in ('ringing','accepted');
alter table public.staff_panel_calls enable row level security;
revoke all on public.staff_panel_calls from public,anon,authenticated;
grant select,insert,update on public.staff_panel_calls to service_role;

create or replace function public.staff_panel_call_action(
  p_actor_id uuid,p_call_id uuid,p_action text,p_tab_id uuid,
  p_thread_id uuid default null,p_target_id uuid default null,p_sdp text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_call public.staff_panel_calls%rowtype;
  v_actor public.workers%rowtype;
  v_target public.workers%rowtype;
  v_thread public.chat_threads%rowtype;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_call_id is null or p_actor_id is null or p_tab_id is null then raise exception 'INVALID_CALL_ID'; end if;
  if p_action not in ('start','answer','reject','end','heartbeat') or p_action is null then raise exception 'INVALID_CALL_ACTION'; end if;
  select * into v_actor from public.workers where id=p_actor_id and is_active=true and role in ('admin','central','tarotista');
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_action in ('start','answer') and (p_sdp is null or length(p_sdp)>48000 or left(p_sdp,3)<>'v=0' or p_sdp !~ E'(^|\n)m=audio ' or p_sdp ~ E'(^|\n)m=video ') then raise exception 'INVALID_CALL_SDP'; end if;

  if p_action='start' then
    if p_actor_id=p_target_id or p_target_id is null then raise exception 'FORBIDDEN'; end if;
    select * into v_target from public.workers where id=p_target_id and is_active=true and role in ('admin','central','tarotista');
    if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
    select * into v_thread from public.chat_threads where id=p_thread_id;
    if not found then raise exception 'THREAD_NOT_FOUND'; end if;
    if p_target_id is distinct from v_thread.central_worker_id and p_target_id is distinct from v_thread.tarotist_worker_id then raise exception 'FORBIDDEN'; end if;
    if p_actor_id is distinct from v_thread.central_worker_id and p_actor_id is distinct from v_thread.tarotist_worker_id
      and not coalesce(public.tc_has_admin_access(coalesce(v_actor.user_id,v_actor.auth_user_id)),false) then raise exception 'FORBIDDEN'; end if;
    -- Lock both workers in deterministic order: crossed simultaneous invitations cannot overlap.
    for v_id in select t.id from unnest(array[p_actor_id,p_target_id]) as t(id) order by t.id loop
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-panel-call:'||v_id::text,0));
    end loop;
    select * into v_call from public.staff_panel_calls where id=p_call_id for update;
    if found then
      if v_call.caller_worker_id<>p_actor_id or v_call.callee_worker_id<>p_target_id or v_call.thread_id<>p_thread_id or v_call.caller_tab_id<>p_tab_id then raise exception 'CALL_ID_CONFLICT'; end if;
      return to_jsonb(v_call);
    end if;
    update public.staff_panel_calls set status='missed',ended_at=v_now,offer_sdp=null,answer_sdp=null
      where status in ('ringing','accepted') and expires_at<=v_now
      and (caller_worker_id in (p_actor_id,p_target_id) or callee_worker_id in (p_actor_id,p_target_id));
    if exists(select 1 from public.staff_panel_calls where status in ('ringing','accepted') and expires_at>v_now
      and (caller_worker_id in (p_actor_id,p_target_id) or callee_worker_id in (p_actor_id,p_target_id))) then raise exception 'CALL_BUSY'; end if;
    insert into public.staff_panel_calls(id,thread_id,caller_worker_id,callee_worker_id,caller_name,callee_name,caller_tab_id,offer_sdp,expires_at,created_at,caller_seen_at)
      values(p_call_id,p_thread_id,p_actor_id,p_target_id,coalesce(v_actor.display_name,'Equipo'),coalesce(v_target.display_name,'Equipo'),p_tab_id,p_sdp,v_now+interval '75 seconds',v_now,v_now)
      returning * into v_call;
    return to_jsonb(v_call);
  end if;

  select * into v_call from public.staff_panel_calls where id=p_call_id for update;
  if not found then raise exception 'CALL_NOT_FOUND'; end if;
  if p_actor_id<>v_call.caller_worker_id and p_actor_id<>v_call.callee_worker_id then raise exception 'FORBIDDEN'; end if;
  if v_call.status not in ('ringing','accepted') then return to_jsonb(v_call); end if;
  if v_call.expires_at<=v_now then
    update public.staff_panel_calls set status='missed',ended_at=v_now,offer_sdp=null,answer_sdp=null where id=p_call_id returning * into v_call;
    return to_jsonb(v_call);
  end if;

  if p_action='answer' then
    if p_actor_id<>v_call.callee_worker_id then raise exception 'FORBIDDEN'; end if;
    if v_call.callee_tab_id is not null and v_call.callee_tab_id<>p_tab_id then raise exception 'CALL_ALREADY_ANSWERED'; end if;
    if v_call.status='accepted' then return to_jsonb(v_call); end if;
    update public.staff_panel_calls set status='accepted',answer_sdp=p_sdp,callee_tab_id=p_tab_id,accepted_at=v_now,
      caller_seen_at=v_now,callee_seen_at=v_now,expires_at=v_now+interval '90 seconds' where id=p_call_id returning * into v_call;
  elsif p_action='reject' then
    if p_actor_id<>v_call.callee_worker_id or v_call.status<>'ringing' then raise exception 'FORBIDDEN'; end if;
    update public.staff_panel_calls set status='rejected',ended_at=v_now,expires_at=v_now,offer_sdp=null,answer_sdp=null where id=p_call_id returning * into v_call;
  else
    if (p_actor_id=v_call.caller_worker_id and p_tab_id<>v_call.caller_tab_id)
      or (p_actor_id=v_call.callee_worker_id and p_tab_id is distinct from v_call.callee_tab_id) then raise exception 'CALL_ALREADY_ANSWERED'; end if;
    if p_action='end' then
      update public.staff_panel_calls set status='ended',ended_at=v_now,expires_at=v_now,offer_sdp=null,answer_sdp=null where id=p_call_id returning * into v_call;
    elsif p_action='heartbeat' then
      if v_call.status<>'accepted' then return to_jsonb(v_call); end if;
      update public.staff_panel_calls set caller_seen_at=case when p_actor_id=caller_worker_id then v_now else caller_seen_at end,
        callee_seen_at=case when p_actor_id=callee_worker_id then v_now else callee_seen_at end,
        expires_at=least(case when p_actor_id=caller_worker_id then v_now else caller_seen_at end,
          case when p_actor_id=callee_worker_id then v_now else callee_seen_at end)+interval '90 seconds'
        where id=p_call_id returning * into v_call;
    end if;
  end if;
  return to_jsonb(v_call);
end;
$$;
revoke all on function public.staff_panel_call_action(uuid,uuid,text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_panel_call_action(uuid,uuid,text,uuid,uuid,uuid,text) to service_role;
comment on table public.staff_panel_calls is 'Private staff audio signaling. Only the two call participants can receive signaling through the server API. Audio is peer-to-peer and is never stored.';
