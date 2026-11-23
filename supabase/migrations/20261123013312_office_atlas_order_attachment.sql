begin;

-- Only the run's digest travels with a claim. Original bytes are private and have no update grants.
create table public.office_instagram_order_files (
  run_id uuid primary key references public.office_runs(id),
  file_name text not null check (length(btrim(file_name)) between 1 and 180 and file_name !~ '[[:cntrl:]/\\:*?"<>|]'),
  file_type text not null check (file_type in ('image/png','image/jpeg','image/webp','video/mp4')),
  file_alt text not null,
  file_bytes bytea not null check (octet_length(file_bytes) between 1 and 2097152),
  sha256 text generated always as (encode(sha256(file_bytes),'hex')) stored,
  unique(run_id,sha256),
  check (case file_type when 'video/mp4' then file_alt='' else length(btrim(file_alt)) between 1 and 1000 end),
  check (case file_type
    when 'image/png' then lower(file_name) like '%.png' and substring(file_bytes from 1 for 8)=decode('89504e470d0a1a0a','hex')
    when 'image/jpeg' then lower(file_name) ~ '\.jpe?g$' and substring(file_bytes from 1 for 3)=decode('ffd8ff','hex')
    when 'image/webp' then lower(file_name) like '%.webp' and substring(file_bytes from 1 for 4)=decode('52494646','hex')
      and substring(file_bytes from 9 for 4)=decode('57454250','hex')
    when 'video/mp4' then lower(file_name) like '%.mp4' and octet_length(file_bytes)>=16
      and substring(file_bytes from 5 for 4)=decode('66747970','hex')
    else false end)
);
alter table public.office_instagram_order_files enable row level security;
revoke all on public.office_instagram_order_files from public,anon,authenticated,service_role;
grant select,insert on public.office_instagram_order_files to service_role;

alter table public.office_runs add column instagram_source_sha256 text,
  add foreign key (id,instagram_source_sha256) references public.office_instagram_order_files(run_id,sha256);
grant update(instagram_source_sha256) on public.office_runs to service_role;

create function public.office_create_instagram_order_with_file(p_user uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  result jsonb; rid uuid; bytes bytea; digest text:=p_input->>'file_sha256'; format text:=p_input->>'instagram_publication';
  mime text:=p_input->>'file_type'; filename text:=p_input->>'file_name'; alt text:=p_input->>'file_alt';
begin
  perform public.office_actor(p_user);
  if format is null or format not in ('photo','reel') or mime is null or digest is null or digest !~ '^[0-9a-f]{64}$'
    or alt is null or filename is null or nullif(p_input->>'file_base64','') is null or length(p_input->>'file_base64')>2796204
    or (format='reel' and mime<>'video/mp4') or (format='photo' and mime not in ('image/jpeg','image/png','image/webp')) then
    raise exception 'OFFICE_INVALID';
  end if;
  bytes:=decode(p_input->>'file_base64','base64');
  if encode(sha256(bytes),'hex')<>digest then raise exception 'OFFICE_INVALID'; end if;
  -- Canonical request identity includes the name, MIME, description and hash, without storing raw bytes in a JSON payload.
  result:=public.office_create_instagram_order(p_user,p_input-'file_base64');
  rid:=(result->>'run_id')::uuid;
  insert into public.office_instagram_order_files(run_id,file_name,file_type,file_alt,file_bytes)
    values(rid,filename,mime,alt,bytes) on conflict(run_id) do nothing;
  if not exists(select 1 from public.office_instagram_order_files f where f.run_id=rid and f.sha256=digest
    and f.file_name=filename and f.file_type=mime and f.file_alt=alt) then raise exception 'OFFICE_CONFLICT'; end if;
  update public.office_runs set instagram_source_sha256=digest where id=rid and instagram_source_sha256 is null;
  if found then
    insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    select 'marketing',r.task_id,r.actor_id,'atlas_publication_attachment','Administración adjuntó el archivo original de la publicación.',
      jsonb_build_object('run_id',rid,'file_name',filename,'file_type',mime,'sha256',digest)
      from public.office_runs r where r.id=rid;
  end if;
  return result;
end $$;

-- An Atlas approval uses the order UUID as its request ID. The approval function
-- catches this guard's error, rolls back the decision and hands the run to a human.
create function public.office_guard_instagram_order_file() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  attached public.office_instagram_order_files;
  job public.office_runs;
begin
  select * into job from public.office_runs where id=new.request_id;
  if not found then return new; end if;
  select * into attached from public.office_instagram_order_files where run_id=job.id;
  if not found and job.instagram_source_sha256 is null then return new; end if;
  if job.task_id is distinct from new.task_id or job.result_version_id is distinct from new.version_id
    or attached.sha256 is distinct from job.instagram_source_sha256
    or new.original_sha256 is distinct from attached.sha256 or new.alt_text is distinct from attached.file_alt
    or (attached.file_type='video/mp4' and new.media_sha256 is distinct from attached.sha256)
    or not exists(select 1 from public.office_versions v where v.id=new.version_id and v.task_id=new.task_id and v.version=1
      and v.file_type=attached.file_type and v.file_name=attached.file_name and encode(sha256(v.file_bytes),'hex')=attached.sha256) then
    raise exception 'OFFICE_IG_APPROVAL_INVALID';
  end if;
  return new;
end $$;
create trigger office_guard_instagram_order_file before insert on public.office_instagram_posts
for each row execute function public.office_guard_instagram_order_file();

revoke all on function public.office_create_instagram_order_with_file(uuid,jsonb), public.office_guard_instagram_order_file()
  from public,anon,authenticated;
grant execute on function public.office_create_instagram_order_with_file(uuid,jsonb) to service_role;

commit;
