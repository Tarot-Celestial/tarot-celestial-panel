-- Existing messages, receipts, RLS and Realtime publication are preserved.
-- Browser writes use authenticated API handlers, which enforce connection and
-- thread ownership. Keep SELECT for Realtime; direct Data API writes must not
-- bypass those handlers (TRUNCATE is not protected by row-level policies).
revoke insert,update,delete,truncate,references,trigger
  on public.chat_threads,public.chat_messages,public.chat_thread_reads from anon,authenticated;

-- Existing participant policies continue to scope each conversation. A former
-- worker with an unexpired JWT must not keep receiving Realtime messages after
-- being deactivated; active workers may still receive alerts while offline.
-- workers.user_id is already unique/indexed and readable by authenticated.
drop policy if exists chat_threads_active_worker_select on public.chat_threads;
create policy chat_threads_active_worker_select on public.chat_threads as restrictive
  for select to authenticated using (exists (
    select 1 from public.workers w where w.user_id=(select auth.uid()) and w.is_active
  ));
drop policy if exists chat_messages_active_worker_select on public.chat_messages;
create policy chat_messages_active_worker_select on public.chat_messages as restrictive
  for select to authenticated using (exists (
    select 1 from public.workers w where w.user_id=(select auth.uid()) and w.is_active
  ));
drop policy if exists chat_reads_active_worker_select on public.chat_thread_reads;
create policy chat_reads_active_worker_select on public.chat_thread_reads as restrictive
  for select to authenticated using (exists (
    select 1 from public.workers w where w.user_id=(select auth.uid()) and w.is_active
  ));

-- A fetch is not a read: only the visible client's explicit acknowledgement
-- advances its own watermark, bounded by the actual saved message timestamp.
create or replace function public.staff_chat_mark_read(
  p_worker_id uuid,p_thread_id uuid,p_through_message_id uuid
) returns timestamptz language plpgsql security invoker set search_path='' as $$
declare
  v_role text;
  v_message_at timestamptz;
  v_read_at timestamptz;
begin
  select w.role into v_role from public.workers w
    where w.id=p_worker_id and w.is_active and w.role in ('admin','central','tarotista') for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.chat_threads t where t.id=p_thread_id
    and (v_role='admin' or p_worker_id=t.central_worker_id or p_worker_id=t.tarotist_worker_id) for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  select m.created_at into v_message_at from public.chat_messages m
    where m.id=p_through_message_id and m.thread_id=p_thread_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if v_message_at>clock_timestamp() then raise exception 'INVALID_MESSAGE_TIMESTAMP'; end if;
  insert into public.chat_thread_reads as r(thread_id,worker_id,last_read_at,updated_at)
    values(p_thread_id,p_worker_id,v_message_at,clock_timestamp())
    on conflict on constraint chat_thread_reads_pkey do update
      set last_read_at=greatest(r.last_read_at,excluded.last_read_at),
        updated_at=case when excluded.last_read_at>r.last_read_at then excluded.updated_at else r.updated_at end
    returning last_read_at into v_read_at;
  return v_read_at;
end;
$$;
revoke all on function public.staff_chat_mark_read(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_chat_mark_read(uuid,uuid,uuid) to service_role;

-- One batch lookup for notification fallback; no per-thread network requests.
-- The caller supplies its authenticated worker; repeat participant checks here
-- so even an overbroad input list cannot return another worker's conversations.
create or replace function public.staff_chat_latest_incoming(p_worker_id uuid,p_thread_ids uuid[])
returns table(id uuid,thread_id uuid,sender_worker_id uuid,sender_display_name text,text text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select distinct on (m.thread_id) m.id,m.thread_id,m.sender_worker_id,
    coalesce(m.sender_display_name,''),m.body,m.created_at
  from public.chat_messages m
  join public.chat_threads t on t.id=m.thread_id
  join public.workers w on w.id=p_worker_id and w.is_active
    and w.role in ('admin','central','tarotista')
  where m.thread_id=any(p_thread_ids) and m.sender_worker_id<>p_worker_id
    and (w.role='admin' or w.id=t.central_worker_id or w.id=t.tarotist_worker_id)
  order by m.thread_id,m.created_at desc,m.id desc;
$$;
revoke all on function public.staff_chat_latest_incoming(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.staff_chat_latest_incoming(uuid,uuid[]) to service_role;
