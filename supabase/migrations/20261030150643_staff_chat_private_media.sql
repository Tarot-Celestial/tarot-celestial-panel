-- Private staff media. Objects are uploaded directly with a scoped, non-upsert token.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('staff-chat-private','staff-chat-private',false,15728640,
 array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg']);
-- Restrictive policies also protect the bucket if a broad permissive policy is added later.
create policy staff_chat_media_no_browser_select on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'staff-chat-private');
create policy staff_chat_media_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'staff-chat-private');
create policy staff_chat_media_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'staff-chat-private') with check(bucket_id<>'staff-chat-private');
create policy staff_chat_media_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'staff-chat-private');

create table public.staff_chat_attachments(
 id uuid primary key,
 thread_id uuid not null references public.chat_threads(id) on delete cascade,
 sender_worker_id uuid not null references public.workers(id),
 message_id uuid unique references public.chat_messages(id) on delete cascade,
 object_path text not null unique,
 kind text not null check(kind in ('image','audio')),
 mime_type text not null,
 file_name text not null check(length(file_name) between 1 and 120),
 size_bytes integer not null check(size_bytes>0),
 validated_at timestamptz,
 created_at timestamptz not null default now(),
 check((kind='image' and mime_type in ('image/jpeg','image/png','image/webp') and size_bytes<=10485760)
    or (kind='audio' and mime_type in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg') and size_bytes<=15728640)),
 check(message_id is null or validated_at is not null)
);
create index staff_chat_attachments_thread_idx on public.staff_chat_attachments(thread_id);
create index staff_chat_attachments_sender_idx on public.staff_chat_attachments(sender_worker_id);
alter table public.staff_chat_attachments enable row level security;
revoke all on public.staff_chat_attachments from public,anon,authenticated,service_role;
grant select,insert,update on public.staff_chat_attachments to service_role;

-- The service checks the file bytes before this RPC. Membership and ownership are
-- checked again here; attachment linkage and message delivery commit together.
create function public.staff_chat_send_media_message(
 p_worker_id uuid,p_thread_id uuid,p_client_message_id text,p_body text,p_attachment_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $function$
declare w public.workers%rowtype; t public.chat_threads%rowtype;
 a public.staff_chat_attachments%rowtype; m public.chat_messages%rowtype;
 saved_attachment uuid; duplicate boolean:=false;
begin
 select * into w from public.workers where id=p_worker_id and is_active is true and role in ('central','tarotista','admin');
 if w.id is null then raise exception 'FORBIDDEN'; end if;
 select * into t from public.chat_threads where id=p_thread_id;
 if t.id is null then raise exception 'THREAD_NOT_FOUND'; end if;
 if w.role<>'admin' and w.id is distinct from t.central_worker_id and w.id is distinct from t.tarotist_worker_id then raise exception 'FORBIDDEN'; end if;
 if p_attachment_id is null or length(btrim(coalesce(p_client_message_id,''))) not between 1 and 128
    or length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_worker_id::text||':'||p_client_message_id,0));
 select * into m from public.chat_messages where sender_worker_id=p_worker_id and client_message_id=p_client_message_id;
 if found then
  select id into saved_attachment from public.staff_chat_attachments where message_id=m.id;
  if m.thread_id<>p_thread_id or m.body<>p_body or saved_attachment is distinct from p_attachment_id then raise exception 'MESSAGE_ID_CONFLICT'; end if;
  duplicate:=true;
 else
  select * into a from public.staff_chat_attachments where id=p_attachment_id for update;
  if a.id is null then raise exception 'ATTACHMENT_NOT_FOUND'; end if;
  if a.sender_worker_id<>p_worker_id or a.thread_id<>p_thread_id then raise exception 'FORBIDDEN'; end if;
  if a.message_id is not null then raise exception 'ATTACHMENT_ALREADY_USED'; end if;
  if a.validated_at is null then raise exception 'ATTACHMENT_NOT_UPLOADED'; end if;
  insert into public.chat_messages(thread_id,sender_worker_id,sender_display_name,body,client_message_id)
   values(p_thread_id,p_worker_id,w.display_name,p_body,p_client_message_id) returning * into m;
  update public.staff_chat_attachments set message_id=m.id where id=a.id;
  update public.chat_threads set last_message_at=m.created_at,last_message_preview=left(m.body,180),status='open'
   where id=p_thread_id and (last_message_at is null or last_message_at<=m.created_at);
 end if;
 return jsonb_build_object('message',to_jsonb(m),'duplicate',duplicate);
end $function$;
revoke all on function public.staff_chat_send_media_message(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.staff_chat_send_media_message(uuid,uuid,text,text,uuid) to service_role;
