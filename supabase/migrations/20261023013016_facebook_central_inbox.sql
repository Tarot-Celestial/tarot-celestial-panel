create table if not exists public.tc_facebook_threads (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  kind text not null check(kind in ('message','comment')),
  remote_id text not null,
  recipient_id text,
  conversation_id text,
  post_id text,
  is_deleted boolean not null default false,
  name text not null default 'Facebook',
  username text,
  preview text not null default '',
  permalink text,
  remote_created_at timestamptz,
  remote_updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  last_reply_at timestamptz,
  private_reply_sent boolean not null default false,
  unique(account_id,kind,remote_id)
);
create table if not exists public.tc_facebook_sends (
  request_id uuid primary key,
  thread_id uuid not null references public.tc_facebook_threads(id),
  actor_user_id uuid not null,
  worker_id uuid not null references public.workers(id),
  body text not null check(length(body) between 1 and 1000),
  reply_mode text not null check(reply_mode in ('public','private')),
  status text not null check(status in ('sending','sent','failed','uncertain','confirmed_sent','confirmed_not_sent')),
  remote_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz
);
create index if not exists tc_facebook_sends_thread_idx on public.tc_facebook_sends(thread_id,created_at desc);
create index if not exists tc_facebook_sends_worker_idx on public.tc_facebook_sends(worker_id);
create unique index if not exists tc_facebook_one_pending on public.tc_facebook_sends(thread_id) where status in ('sending','uncertain');
create table if not exists public.tc_facebook_webhook_events (
  event_key text primary key,
  account_id text not null,
  kind text not null,
  remote_id text not null,
  received_at timestamptz not null default now()
);
alter table public.tc_facebook_threads enable row level security;
alter table public.tc_facebook_sends enable row level security;
alter table public.tc_facebook_webhook_events enable row level security;
revoke all on public.tc_facebook_threads,public.tc_facebook_sends,public.tc_facebook_webhook_events from public,anon,authenticated;
grant select,insert,update,delete on public.tc_facebook_threads,public.tc_facebook_sends,public.tc_facebook_webhook_events to service_role;

create or replace function public.tc_facebook_claim_send(p_user uuid,p_thread uuid,p_request uuid,p_body text,p_mode text,p_expected_reply timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_worker uuid; v_thread public.tc_facebook_threads; v_send public.tc_facebook_sends;
begin
  select id into v_worker from public.workers where user_id=p_user and role in ('admin','central') and is_active is true order by id limit 1;
  if v_worker is null then raise exception 'FORBIDDEN'; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 1000 or p_mode not in ('public','private') then raise exception 'INVALID_MESSAGE'; end if;
  select * into v_thread from public.tc_facebook_threads where id=p_thread for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_send from public.tc_facebook_sends where request_id=p_request;
  if found then
    if v_send.thread_id<>p_thread or v_send.actor_user_id<>p_user or v_send.body<>p_body or v_send.reply_mode<>p_mode then raise exception 'OPERATION_CONFLICT'; end if;
    if v_send.status in ('sent','confirmed_sent') then return jsonb_build_object('duplicate',true,'remote_message_id',v_send.remote_message_id); end if;
    raise exception 'SEND_PENDING';
  end if;
  if v_thread.last_reply_at is distinct from p_expected_reply then raise exception 'STALE_REPLY'; end if;
  if v_thread.kind='comment' and p_mode='private' and (v_thread.private_reply_sent or v_thread.remote_created_at is null or v_thread.remote_created_at < now()-interval '7 days') then raise exception 'PRIVATE_REPLY_CLOSED'; end if;
  if exists(select 1 from public.tc_facebook_sends where thread_id=p_thread and status in ('sending','uncertain')) then raise exception 'SEND_PENDING'; end if;
  insert into public.tc_facebook_sends(request_id,thread_id,actor_user_id,worker_id,body,reply_mode,status) values(p_request,p_thread,p_user,v_worker,p_body,p_mode,'sending');
  return jsonb_build_object('duplicate',false);
end $$;

create or replace function public.tc_facebook_finish_send(p_request uuid,p_status text,p_remote_id text,p_error text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_send public.tc_facebook_sends;
begin
  if p_status not in ('sent','failed','uncertain') then raise exception 'INVALID_STATUS'; end if;
  select * into v_send from public.tc_facebook_sends where request_id=p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_send.status in ('sent','confirmed_sent','confirmed_not_sent') then return; end if;
  if p_status='sent' and nullif(p_remote_id,'') is null then raise exception 'RECEIPT_REQUIRED'; end if;
  update public.tc_facebook_sends set status=p_status,remote_message_id=p_remote_id,error_code=p_error,completed_at=clock_timestamp() where request_id=p_request;
  if p_status='sent' then
    update public.tc_facebook_threads set last_reply_at=clock_timestamp(),
      private_reply_sent=private_reply_sent or (kind='comment' and v_send.reply_mode='private') where id=v_send.thread_id;
  end if;
end $$;
revoke all on function public.tc_facebook_claim_send(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.tc_facebook_finish_send(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.tc_facebook_claim_send(uuid,uuid,uuid,text,text,timestamptz),public.tc_facebook_finish_send(uuid,text,text,text) to service_role;

-- An operator must inspect the native conversation before settling an ambiguous
-- delivery. This records their decision; it never sends or retries a message.
create or replace function public.tc_facebook_resolve_send(p_user uuid,p_thread uuid,p_request uuid,p_outcome text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_send public.tc_facebook_sends;
begin
  if not exists(select 1 from public.workers where user_id=p_user and role in ('central','admin') and is_active is true) then raise exception 'FORBIDDEN'; end if;
  if p_outcome not in ('sent','not_sent') then raise exception 'INVALID_OUTCOME'; end if;
  perform 1 from public.tc_facebook_threads where id=p_thread for update;
  select * into v_send from public.tc_facebook_sends where request_id=p_request and thread_id=p_thread for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_send.status not in ('sending','uncertain') then return; end if;
  if v_send.created_at > now()-interval '60 seconds' then raise exception 'SEND_IN_PROGRESS'; end if;
  update public.tc_facebook_sends set status=case when p_outcome='sent' then 'confirmed_sent' else 'confirmed_not_sent' end,
    resolved_by=p_user,resolved_at=clock_timestamp() where request_id=p_request;
  if p_outcome='sent' then
    update public.tc_facebook_threads set last_reply_at=clock_timestamp(),private_reply_sent=private_reply_sent or (kind='comment' and v_send.reply_mode='private') where id=p_thread;
  end if;
end $$;
revoke all on function public.tc_facebook_resolve_send(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tc_facebook_resolve_send(uuid,uuid,uuid,text) to service_role;

-- Webhook deliveries may arrive out of order. Keep the latest preview and
-- preserve operator receipts/read state across reconciliation.
create or replace function public.tc_facebook_ingest_threads(p_rows jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'INVALID_BATCH'; end if;
  insert into public.tc_facebook_threads(account_id,kind,remote_id,recipient_id,conversation_id,post_id,name,preview,permalink,remote_created_at,remote_updated_at,is_deleted)
  select account_id,kind,remote_id,recipient_id,conversation_id,post_id,coalesce(name,'Facebook'),coalesce(preview,''),permalink,remote_created_at,remote_updated_at,coalesce(is_deleted,false)
  from jsonb_to_recordset(p_rows) as x(account_id text,kind text,remote_id text,recipient_id text,conversation_id text,post_id text,name text,preview text,permalink text,remote_created_at timestamptz,remote_updated_at timestamptz,is_deleted boolean)
  on conflict(account_id,kind,remote_id) do update set
    recipient_id=coalesce(excluded.recipient_id,tc_facebook_threads.recipient_id),
    conversation_id=coalesce(excluded.conversation_id,tc_facebook_threads.conversation_id),
    post_id=coalesce(excluded.post_id,tc_facebook_threads.post_id),
    name=case when excluded.remote_updated_at>=tc_facebook_threads.remote_updated_at then excluded.name else tc_facebook_threads.name end,
    preview=case when excluded.remote_updated_at>=tc_facebook_threads.remote_updated_at then excluded.preview else tc_facebook_threads.preview end,
    permalink=coalesce(excluded.permalink,tc_facebook_threads.permalink),
    remote_created_at=coalesce(tc_facebook_threads.remote_created_at,excluded.remote_created_at),
    remote_updated_at=greatest(excluded.remote_updated_at,tc_facebook_threads.remote_updated_at),
    is_deleted=tc_facebook_threads.is_deleted or excluded.is_deleted,
    synced_at=clock_timestamp();
end $$;
revoke all on function public.tc_facebook_ingest_threads(jsonb) from public,anon,authenticated;
grant execute on function public.tc_facebook_ingest_threads(jsonb) to service_role;
create index if not exists tc_facebook_threads_inbox_idx on public.tc_facebook_threads(account_id,kind,remote_updated_at desc,id desc) where not is_deleted;
