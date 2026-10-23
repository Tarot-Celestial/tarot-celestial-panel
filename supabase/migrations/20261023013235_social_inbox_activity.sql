-- Shared review state. Only metadata is exposed through Realtime.
create table if not exists public.tc_social_inbox_activity (
 id bigint generated always as identity primary key,
 provider text not null check(provider in ('instagram','facebook')),
 account_id text not null, kind text not null check(kind in ('message','comment')),
 remote_id text not null, thread_remote_id text not null,
 occurred_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 read_at timestamptz, read_by uuid, removed_at timestamptz,
 unique(provider,account_id,kind,remote_id)
);
create index if not exists tc_social_activity_pending on public.tc_social_inbox_activity(provider,account_id,thread_remote_id,received_at) where read_at is null and removed_at is null;
create index if not exists tc_social_activity_revision on public.tc_social_inbox_activity(provider,account_id,received_at desc);
create index if not exists tc_social_activity_read_revision on public.tc_social_inbox_activity(provider,account_id,read_at desc) where read_at is not null;
alter table public.tc_social_inbox_activity enable row level security;
revoke all on public.tc_social_inbox_activity from anon,authenticated;
grant select on public.tc_social_inbox_activity to authenticated;
grant all on public.tc_social_inbox_activity to service_role;
grant usage,select on sequence public.tc_social_inbox_activity_id_seq to service_role;
drop policy if exists social_inbox_staff_read on public.tc_social_inbox_activity;
create policy social_inbox_staff_read on public.tc_social_inbox_activity for select to authenticated
 using (exists(select 1 from public.workers w where w.user_id=(select auth.uid()) and w.is_active=true and w.role in ('admin','central')));
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tc_social_inbox_activity') then
  alter publication supabase_realtime add table public.tc_social_inbox_activity;
 end if;
end $$;

create table if not exists public.tc_social_inbox_sync (
 provider text not null check(provider in ('instagram','facebook')), account_id text not null,
 lease_token uuid, lease_until timestamptz, next_sync_at timestamptz,
 cursor jsonb not null default '{}'::jsonb, last_error text, updated_at timestamptz not null default now(),
 primary key(provider,account_id)
);
alter table public.tc_social_inbox_sync enable row level security;
revoke all on public.tc_social_inbox_sync from anon,authenticated;
grant all on public.tc_social_inbox_sync to service_role;

create or replace function public.tc_social_attention(p_provider text,p_account text) returns jsonb
language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('count',count(*) filter(where read_at is null and removed_at is null),
 'messages',count(*) filter(where read_at is null and removed_at is null and kind='message'),
 'comments',count(*) filter(where read_at is null and removed_at is null and kind='comment'),
 'revision',coalesce(greatest(max(received_at),max(read_at),max(removed_at))::text,'empty'))
 from public.tc_social_inbox_activity where provider=p_provider and account_id=p_account;
$$;
create or replace function public.tc_social_thread_unread(p_provider text,p_account text,p_threads text[])
returns table(thread_remote_id text,unread bigint) language sql stable security invoker set search_path=public as $$
 select thread_remote_id,count(*) from public.tc_social_inbox_activity
 where provider=p_provider and account_id=p_account and thread_remote_id=any(p_threads) and read_at is null and removed_at is null group by thread_remote_id;
$$;
create or replace function public.tc_social_mark_read(p_user uuid,p_provider text,p_account text,p_threads text[],p_through timestamptz)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare remaining bigint;
begin
 if not exists(select 1 from workers where user_id=p_user and is_active=true and role in ('admin','central')) then raise exception 'FORBIDDEN'; end if;
 if p_through is null or p_through>clock_timestamp()+interval '1 minute' or coalesce(cardinality(p_threads),0) not between 1 and 20 then raise exception 'INVALID_READ_BOUNDARY'; end if;
 update tc_social_inbox_activity set read_at=clock_timestamp(),read_by=p_user
 where provider=p_provider and account_id=p_account and thread_remote_id=any(p_threads) and received_at<=p_through and read_at is null and removed_at is null;
 select count(*) into remaining from tc_social_inbox_activity where provider=p_provider and account_id=p_account and thread_remote_id=any(p_threads) and read_at is null and removed_at is null;
 return jsonb_build_object('ok',true,'unread',remaining);
end $$;
create or replace function public.tc_social_claim_sync(p_provider text,p_account text,p_cooldown integer default 60,p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare state tc_social_inbox_sync; token uuid:=gen_random_uuid();
begin
 insert into tc_social_inbox_sync(provider,account_id) values(p_provider,p_account) on conflict do nothing;
 select * into state from tc_social_inbox_sync where provider=p_provider and account_id=p_account for update;
 if state.lease_until>clock_timestamp() or (not p_force and state.next_sync_at>clock_timestamp()) then return null; end if;
 update tc_social_inbox_sync set lease_token=token,lease_until=clock_timestamp()+interval '55 seconds',next_sync_at=clock_timestamp()+make_interval(secs=>greatest(30,least(300,p_cooldown))) where provider=p_provider and account_id=p_account;
 return jsonb_build_object('token',token,'cursor',state.cursor);
end $$;
create or replace function public.tc_social_finish_sync(p_provider text,p_account text,p_token uuid,p_cursor jsonb,p_error text default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
 update tc_social_inbox_sync set lease_token=null,lease_until=null,cursor=coalesce(p_cursor,'{}'::jsonb),last_error=left(p_error,80),updated_at=clock_timestamp()
 where provider=p_provider and account_id=p_account and lease_token=p_token;
end $$;

-- Keep existing thread UUIDs and send receipts while joining webhook peers to conversations.
alter table public.tc_instagram_threads add column if not exists conversation_id text;
alter table public.tc_instagram_threads add column if not exists merged_into uuid references public.tc_instagram_threads(id);
update public.tc_instagram_threads set conversation_id=remote_id where kind='message' and conversation_id is null and remote_id not like 'peer:%';
create index if not exists tc_instagram_thread_peer on public.tc_instagram_threads(account_id,recipient_id) where kind='message';
create or replace function public.tc_instagram_upsert_thread(p_account text,p_row jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare existing tc_instagram_threads; saved tc_instagram_threads; other tc_instagram_threads; incoming timestamptz; peer text; is_newer boolean;
begin
 if p_row->>'kind' not in ('message','comment') or coalesce(p_row->>'remote_id','')='' then raise exception 'INVALID_THREAD'; end if;
 peer:=nullif(p_row->>'recipient_id',''); incoming:=(p_row->>'remote_updated_at')::timestamptz;
 perform pg_advisory_xact_lock(hashtextextended('instagram:'||p_account,0));
 select * into existing from tc_instagram_threads where account_id=p_account and kind=p_row->>'kind' and merged_into is null
 and (remote_id=p_row->>'remote_id' or (kind='message' and peer is not null and recipient_id=peer))
 order by (remote_id=p_row->>'remote_id') desc limit 1 for update;
 if existing.id is not null and p_row->>'kind'='message' and peer is not null then
  for other in select * from tc_instagram_threads where account_id=p_account and kind='message' and merged_into is null and id<>existing.id
   and (remote_id=p_row->>'remote_id' or recipient_id=peer) for update loop
   -- Never erase uncertain sends or change a pending operation's receipt.
   if (select count(*) from tc_instagram_sends where thread_id in (existing.id,other.id) and status in ('sending','uncertain'))>1 then raise exception 'THREAD_MERGE_PENDING'; end if;
   update tc_instagram_sends set thread_id=existing.id where thread_id=other.id;
   update tc_instagram_threads set merged_into=existing.id where id=other.id;
   update tc_instagram_threads set merged_into=existing.id where merged_into=other.id;
   update tc_instagram_threads set last_reply_at=greatest(last_reply_at,other.last_reply_at),private_reply_sent=private_reply_sent or other.private_reply_sent,
    preview=case when other.remote_updated_at>remote_updated_at then other.preview else preview end,
    remote_updated_at=greatest(remote_updated_at,other.remote_updated_at)
   where id=existing.id returning * into existing;
  end loop;
 end if;
 if existing.id is null then
  insert into tc_instagram_threads(account_id,kind,remote_id,conversation_id,recipient_id,name,username,preview,remote_created_at,remote_updated_at,permalink,synced_at)
  values(p_account,p_row->>'kind',p_row->>'remote_id',p_row->>'conversation_id',peer,coalesce(p_row->>'name','Instagram'),p_row->>'username',coalesce(p_row->>'preview',''),(p_row->>'remote_created_at')::timestamptz,coalesce(incoming,clock_timestamp()),p_row->>'permalink',clock_timestamp()) returning * into saved;
 else
  is_newer:=incoming is not null and incoming>=existing.remote_updated_at;
  update tc_instagram_threads set conversation_id=coalesce(p_row->>'conversation_id',conversation_id),recipient_id=coalesce(peer,recipient_id),
   name=case when is_newer and nullif(p_row->>'name','') is not null then p_row->>'name' else name end,
   username=coalesce(nullif(p_row->>'username',''),username),
   preview=case when is_newer and p_row ? 'preview' then p_row->>'preview' else preview end,
   remote_created_at=coalesce(remote_created_at,(p_row->>'remote_created_at')::timestamptz),
   remote_updated_at=case when is_newer then incoming else remote_updated_at end,
   permalink=coalesce(p_row->>'permalink',permalink),synced_at=clock_timestamp()
  where id=existing.id returning * into saved;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.tc_social_attention(text,text),public.tc_social_thread_unread(text,text,text[]),public.tc_social_mark_read(uuid,text,text,text[],timestamptz),public.tc_social_claim_sync(text,text,integer,boolean),public.tc_social_finish_sync(text,text,uuid,jsonb,text),public.tc_instagram_upsert_thread(text,jsonb) from public,anon,authenticated;
grant execute on function public.tc_social_attention(text,text),public.tc_social_thread_unread(text,text,text[]),public.tc_social_mark_read(uuid,text,text,text[],timestamptz),public.tc_social_claim_sync(text,text,integer,boolean),public.tc_social_finish_sync(text,text,uuid,jsonb,text),public.tc_instagram_upsert_thread(text,jsonb) to service_role;

create or replace function public.tc_social_remove_activity(p_provider text,p_account text,p_kind text,p_ids text[]) returns void language plpgsql security invoker set search_path=public as $$
begin
 insert into tc_social_inbox_activity(provider,account_id,kind,remote_id,thread_remote_id,occurred_at,removed_at)
 select p_provider,p_account,p_kind,x,x,clock_timestamp(),clock_timestamp() from unnest(p_ids) x
 on conflict(provider,account_id,kind,remote_id) do update set removed_at=coalesce(tc_social_inbox_activity.removed_at,excluded.removed_at);
end $$;
revoke all on function public.tc_social_remove_activity(text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.tc_social_remove_activity(text,text,text,text[]) to service_role;

-- A request that loaded an old UUID before a merge must refresh before sending.
create or replace function public.tc_instagram_reject_merged_send() returns trigger
language plpgsql security invoker set search_path=public as $$
declare target tc_instagram_threads;
begin
 select * into target from tc_instagram_threads where id=new.thread_id for update;
 if target.merged_into is not null then raise exception 'STALE_THREAD'; end if;
 return new;
end $$;
drop trigger if exists tc_instagram_send_canonical on public.tc_instagram_sends;
create trigger tc_instagram_send_canonical before insert on public.tc_instagram_sends for each row execute function public.tc_instagram_reject_merged_send();
revoke all on function public.tc_instagram_reject_merged_send() from public,anon,authenticated;
grant execute on function public.tc_instagram_reject_merged_send() to service_role;

create or replace function public.tc_instagram_upsert_threads(p_account text,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare item jsonb; result jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'INVALID_BATCH'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  result:=result||jsonb_build_array(tc_instagram_upsert_thread(p_account,item));
 end loop;
 return result;
end $$;
revoke all on function public.tc_instagram_upsert_threads(text,jsonb) from public,anon,authenticated;
grant execute on function public.tc_instagram_upsert_threads(text,jsonb) to service_role;
