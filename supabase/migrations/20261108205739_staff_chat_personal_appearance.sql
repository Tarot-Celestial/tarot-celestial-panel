-- Staff-only profile media and personal per-conversation wallpapers.
-- Browser roles cannot enumerate or read the bucket; authorized routes issue
-- short-lived URLs only after checking the actor and thread membership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('staff-chat-appearance','staff-chat-appearance',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists staff_chat_appearance_no_browser_select on storage.objects;
drop policy if exists staff_chat_appearance_no_browser_insert on storage.objects;
drop policy if exists staff_chat_appearance_no_browser_update on storage.objects;
drop policy if exists staff_chat_appearance_no_browser_delete on storage.objects;
create policy staff_chat_appearance_no_browser_select on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'staff-chat-appearance');
create policy staff_chat_appearance_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'staff-chat-appearance');
create policy staff_chat_appearance_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'staff-chat-appearance') with check(bucket_id<>'staff-chat-appearance');
create policy staff_chat_appearance_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'staff-chat-appearance');

create table if not exists public.staff_chat_profiles (
  worker_id uuid primary key references public.workers(id) on delete cascade,
  avatar_kind text not null default 'initials' check(avatar_kind in ('initials','character','photo')),
  character text check(character in ('moon','star','owl','cat','butterfly','flower')),
  photo_path text,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  check((avatar_kind='initials' and character is null and photo_path is null)
    or (avatar_kind='character' and character is not null and photo_path is null)
    or (avatar_kind='photo' and character is null and photo_path is not null)),
  check(photo_path is null or photo_path like worker_id::text||'/profile/%')
);
create table if not exists public.staff_chat_preferences (
  worker_id uuid not null references public.workers(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  wallpaper text not null default 'aurora' check(wallpaper in ('aurora','midnight','forest','sand','custom')),
  background_path text,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  primary key(worker_id,thread_id),
  check((wallpaper='custom')=(background_path is not null)),
  check(background_path is null or background_path like worker_id::text||'/background/%')
);
create index if not exists staff_chat_preferences_thread_idx on public.staff_chat_preferences(thread_id);
alter table public.staff_chat_profiles enable row level security;
alter table public.staff_chat_preferences enable row level security;
revoke all on public.staff_chat_profiles,public.staff_chat_preferences from public,anon,authenticated,service_role;
grant select,insert,update on public.staff_chat_profiles,public.staff_chat_preferences to service_role;
