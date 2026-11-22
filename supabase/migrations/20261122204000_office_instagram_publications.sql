begin;

-- Existing private attachments keep their original 2 MiB size cap and access rules.
alter table public.office_versions drop constraint office_versions_file_type_check;
alter table public.office_versions add constraint office_versions_file_type_check check
  (file_type in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','video/mp4'));

create table public.office_ig_connection_owners (
  account_id text not null, connected_at timestamptz not null,
  actor_user_id uuid not null, bound_at timestamptz not null default now(),
  primary key(account_id,connected_at)
);
create table public.office_instagram_posts (
  id uuid primary key default gen_random_uuid(),task_id uuid not null references public.office_tasks(id),
  deliverable_id uuid not null,version_id uuid not null references public.office_versions(id),
  account_id text not null,persisted_account_id text not null,username text not null,connection_owner text not null,connected_at timestamptz not null,
  caption text not null check(length(caption) between 1 and 2200),alt_text text not null check(length(alt_text)<=1000),
  media_type text not null check(media_type in ('image/jpeg','video/mp4')),
  original_sha256 text not null check(original_sha256 ~ '^[0-9a-f]{64}$'),media_sha256 text not null check(media_sha256 ~ '^[0-9a-f]{64}$'),
  scheduled_at timestamptz not null,time_zone text not null,
  approved_by uuid not null references public.workers(id),actor_user_id uuid not null,approved_at timestamptz not null default now(),
  request_id uuid not null,fingerprint text not null,unique(approved_by,request_id),
  source_snapshot jsonb,
  status text not null default 'queued' check(status in ('queued','preparing','container_ready','dispatching','verifying','published','invalidated','failed','cancelled')),
  container_id text,external_post_id text,permalink text,metrics jsonb,metrics_updated_at timestamptz,
  lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz not null,
  preparation_attempts integer not null default 0,verification_attempts integer not null default 0,
  dispatch_token uuid,dispatch_started_at timestamptz,provider_rejected_at timestamptz,published_at timestamptz,last_error text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index office_ig_one_publication on public.office_instagram_posts(account_id,deliverable_id)
  where (dispatch_started_at is not null and provider_rejected_at is null) or status not in ('cancelled','invalidated','failed');
create unique index office_ig_one_connection_publication on public.office_instagram_posts(persisted_account_id,deliverable_id)
  where (dispatch_started_at is not null and provider_rejected_at is null) or status not in ('cancelled','invalidated','failed');
create unique index office_ig_external_post on public.office_instagram_posts(account_id,external_post_id) where external_post_id is not null;
create index office_ig_due on public.office_instagram_posts(next_attempt_at) where status in ('queued','preparing','container_ready','dispatching','verifying');
create table public.office_instagram_events (
  id uuid primary key default gen_random_uuid(),post_id uuid not null references public.office_instagram_posts(id),
  status text not null,actor_id uuid references public.workers(id),note text,created_at timestamptz not null default now()
);
create index office_ig_events_post on public.office_instagram_events(post_id,created_at);
alter table public.office_ig_connection_owners enable row level security;
alter table public.office_instagram_posts enable row level security;
alter table public.office_instagram_events enable row level security;
revoke all on public.office_ig_connection_owners,public.office_instagram_posts,public.office_instagram_events from public,anon,authenticated,service_role;
grant select,insert on public.office_ig_connection_owners,public.office_instagram_posts,public.office_instagram_events to service_role;
grant update(status,container_id,external_post_id,permalink,metrics,metrics_updated_at,lease_token,lease_until,next_attempt_at,
  preparation_attempts,verification_attempts,dispatch_token,dispatch_started_at,provider_rejected_at,published_at,last_error,updated_at)
  on public.office_instagram_posts to service_role;

-- Returns the precise reason a previously authorized payload is no longer eligible.
create function public.office_ig_invalid_reason(p_id uuid) returns text
language plpgsql stable security invoker set search_path='' as $$
declare post public.office_instagram_posts; offer jsonb;
begin
  select * into post from public.office_instagram_posts where id=p_id;
  if not found then return 'Publicación inexistente.'; end if;
  if public.tc_has_admin_access(post.actor_user_id) is not true then return 'La autorización de administración ya no está vigente.'; end if;
  if not exists(select 1 from public.tc_social_connections_v2 c
    left join public.office_ig_connection_owners o on o.account_id=c.account_id and o.connected_at=c.connected_at
    where c.provider='instagram' and c.account_id=post.persisted_account_id and c.connected_at=post.connected_at
      and coalesce(c.connected_by::text,o.actor_user_id::text)=post.connection_owner) then
    return 'Cambió la conexión o la cuenta de Instagram. Se requiere una nueva aprobación.'; end if;
  if not exists(select 1 from public.office_tasks t join public.office_versions v on v.task_id=t.id
    where t.id=post.task_id and t.department_id='marketing' and t.status<>'cancelado' and v.id=post.version_id and v.deliverable_id=post.deliverable_id
      and v.status='aprobado' and post.original_sha256=encode(sha256(v.file_bytes),'hex')
      and not exists(select 1 from public.office_versions newer where newer.deliverable_id=v.deliverable_id and newer.version>v.version)) then
    return 'Cambió el encargo o la versión aprobada del entregable.'; end if;
  offer:=post.source_snapshot;
  if offer->>'promotion_id' is null and post.caption ~* '([$€%]|\m(promoci[oó]n|descuento|oferta|precio|eur|usd|gratis)\M)' then
    return 'La pieza comercial requiere una oferta aprobada para su mercado y moneda.'; end if;
  if offer->>'promotion_id' is not null then
    if offer->>'channel' is distinct from 'instagram' or not public.office_promotion_scope_live((offer->>'promotion_id')::uuid,
      offer->>'market',offer->>'currency','instagram') or offer#>>'{offer,source_fingerprint}' is distinct from
      public.office_promotion_fingerprint((offer->>'promotion_id')::uuid,offer->>'currency') then
      return 'La oferta venció, cambió o perdió la aprobación para este mercado.'; end if;
    if (offer#>>'{offer,starts_at}')::timestamptz>post.scheduled_at or (offer#>>'{offer,ends_at}')::timestamptz<=post.scheduled_at then
      return 'La fecha seleccionada está fuera de la vigencia de la oferta.'; end if;
  end if;
  return null;
end $$;

create function public.office_ig_source(p_version_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select r.source_snapshot from public.office_versions target join public.office_versions base
    on base.task_id=target.task_id and base.deliverable_id=target.deliverable_id and base.version<=target.version
  join public.office_runs r on r.result_version_id=base.id and r.task_id=target.task_id
  where target.id=p_version_id and r.status='review' order by base.version desc,r.updated_at desc limit 1
$$;

create function public.office_ig_approve(p_actor uuid,p_version_id uuid,p_request_id uuid,p_account_id text,p_username text,
  p_connection_owner text,p_caption text,p_alt_text text,p_media_sha256 text,p_scheduled_at timestamptz,p_time_zone text,
  p_persisted_account_id text default null,p_connected_at timestamptz default null)
returns uuid language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare actor uuid:=public.office_actor(p_actor); version_row record; task public.office_tasks; conn record;
  owner_id text; payload_key text; existing record; source jsonb; pid uuid; reason text;
  persisted_id text:=coalesce(p_persisted_account_id,p_account_id);
begin
  if p_request_id is null or p_version_id is null or p_connected_at is null or nullif(trim(p_account_id),'') is null or nullif(trim(p_username),'') is null
    or nullif(trim(p_connection_owner),'') is null or nullif(trim(p_caption),'') is null or length(p_caption)>2200
    or p_alt_text is null or length(p_alt_text)>1000 or p_media_sha256 is null or p_media_sha256 !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone) then raise exception 'OFFICE_INVALID'; end if;
  payload_key:=encode(sha256(convert_to(jsonb_build_array(p_version_id,p_account_id,persisted_id,p_connected_at,p_username,p_connection_owner,
    p_caption,p_alt_text,p_media_sha256,p_scheduled_at,p_time_zone)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  select id,fingerprint into existing from public.office_instagram_posts where request_id=p_request_id and approved_by=actor;
  if found then
    if existing.fingerprint<>payload_key then raise exception 'OFFICE_CONFLICT'; end if;
    return existing.id;
  end if;
  if p_scheduled_at is not null and p_scheduled_at<=clock_timestamp() then raise exception 'OFFICE_IG_SCHEDULE_PAST'; end if;
  select t.* into task from public.office_tasks t join public.office_versions v on v.task_id=t.id where v.id=p_version_id for update of t;
  if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
  select id,deliverable_id,version,status,file_type,encode(sha256(file_bytes),'hex') as original_sha into strict version_row
    from public.office_versions where id=p_version_id;
  if task.department_id<>'marketing' or task.status='cancelado' or version_row.status not in ('pendiente','aprobado') or exists(select 1 from public.office_versions v
    where v.deliverable_id=version_row.deliverable_id and v.version>version_row.version) then raise exception 'OFFICE_CONFLICT'; end if;
  if version_row.original_sha is null or version_row.file_type not in ('image/jpeg','image/png','image/webp','video/mp4')
    or (version_row.file_type<>'video/mp4' and nullif(trim(p_alt_text),'') is null) then raise exception 'OFFICE_INVALID'; end if;
  if exists(select 1 from public.office_instagram_posts where (account_id=p_account_id or persisted_account_id=persisted_id) and deliverable_id=version_row.deliverable_id
    and ((dispatch_started_at is not null and provider_rejected_at is null) or status not in ('cancelled','invalidated','failed'))) then raise exception 'OFFICE_CONFLICT'; end if;
  select account_id,username,connected_by,connected_at into conn from public.tc_social_connections_v2 where provider='instagram';
  if not found or conn.account_id is distinct from persisted_id
    or conn.connected_at is distinct from p_connected_at then raise exception 'OFFICE_IG_CONNECTION_CHANGED'; end if;
  if conn.connected_by is null then
    -- Adoption records who binds this exact connection generation to Office. OAuth ownership remains unchanged.
    insert into public.office_ig_connection_owners(account_id,connected_at,actor_user_id)
      values(persisted_id,conn.connected_at,p_actor) on conflict do nothing;
    select actor_user_id::text into strict owner_id from public.office_ig_connection_owners
      where account_id=persisted_id and connected_at=conn.connected_at;
  else owner_id:=conn.connected_by::text; end if;
  if p_connection_owner is distinct from owner_id then raise exception 'OFFICE_IG_CONNECTION_CHANGED'; end if;
  source:=public.office_ig_source(p_version_id);
  if version_row.status='pendiente' then
    perform public.office_apply(p_actor,jsonb_build_object('request_id',gen_random_uuid(),'action','review_version','id',p_version_id,
      'decision','aprobado','note','Administración aprobó esta versión para la publicación seleccionada.'));
  end if;
  insert into public.office_instagram_posts(task_id,deliverable_id,version_id,account_id,persisted_account_id,username,connection_owner,connected_at,
    caption,alt_text,media_type,original_sha256,media_sha256,scheduled_at,time_zone,approved_by,actor_user_id,request_id,fingerprint,
    source_snapshot,next_attempt_at)
    values(task.id,version_row.deliverable_id,p_version_id,p_account_id,persisted_id,p_username,owner_id,conn.connected_at,p_caption,p_alt_text,
      case when version_row.file_type='video/mp4' then 'video/mp4' else 'image/jpeg' end,version_row.original_sha,p_media_sha256,
      coalesce(p_scheduled_at,now()),p_time_zone,actor,p_actor,p_request_id,payload_key,source,coalesce(p_scheduled_at,now())) returning id into pid;
  reason:=public.office_ig_invalid_reason(pid);
  if reason is not null then raise exception 'OFFICE_IG_APPROVAL_INVALID'; end if;
  insert into public.office_instagram_events(post_id,status,actor_id,note) values(pid,'queued',actor,'Publicación aprobada.');
  return pid;
end $$;

create function public.office_ig_claim(p_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare post public.office_instagram_posts; wanted text; reason text;
begin
  select * into post from public.office_instagram_posts
    where (p_id is null or id=p_id) and status in ('queued','preparing','container_ready','dispatching','verifying')
      and scheduled_at<=now() and next_attempt_at<=now() and (lease_until is null or lease_until<=clock_timestamp())
    order by next_attempt_at,approved_at,id for update skip locked limit 1;
  if not found then return null; end if;
  wanted:=case when post.dispatch_started_at is not null then 'verifying' when post.container_id is not null then 'container_ready' else 'preparing' end;
  if wanted<>'verifying' then
    reason:=public.office_ig_invalid_reason(post.id);
    if reason is not null then wanted:='invalidated';
    elsif wanted='preparing' and post.preparation_attempts>=3 then wanted:='failed'; reason:='No se pudo preparar un contenedor tras tres intentos.';
    end if;
  end if;
  if wanted in ('invalidated','failed') then
    update public.office_instagram_posts set status=wanted,last_error=reason,lease_token=null,lease_until=null,updated_at=now() where id=post.id;
    insert into public.office_instagram_events(post_id,status,note) values(post.id,wanted,reason);
    return null;
  end if;
  if wanted<>post.status then
    insert into public.office_instagram_events(post_id,status) values(post.id,wanted);
  end if;
  update public.office_instagram_posts set status=wanted,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',
    preparation_attempts=preparation_attempts+(wanted='preparing')::integer,verification_attempts=verification_attempts+(wanted='verifying')::integer,
    updated_at=now() where id=post.id returning * into post;
  return to_jsonb(post);
end $$;

create function public.office_ig_transition(p_id uuid,p_lease uuid,p_next text,p_container_id text default null,
  p_media_id text default null,p_permalink text default null,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare post public.office_instagram_posts; reason text; next_status text:=p_next; keep_lease boolean:=false;
  receipt_id text:=nullif(trim(p_media_id),''); link text:=nullif(trim(p_permalink),''); container text:=nullif(trim(p_container_id),'');
  defer_until timestamptz:=now(); late_receipt boolean; target_task uuid;
begin
  if p_lease is null then return false; end if;
  if length(receipt_id)>255 or length(container)>255 or (link is not null and
    (length(link)>2048 or link !~* '^https://(www\.)?instagram\.com/[^[:space:]]+$')) then raise exception 'OFFICE_INVALID'; end if;
  -- Editors and delivery review lock the task before touching the publication. At
  -- the final boundary take locks in that same order to serialize approval changes.
  if p_next='dispatching' then
    select task_id into target_task from public.office_instagram_posts where id=p_id;
    if not found then return false; end if;
    perform id from public.office_tasks where id=target_task for update;
  end if;
  select * into post from public.office_instagram_posts where id=p_id for update;
  if not found then return false; end if;
  if post.status='published' then
    return p_next in ('receipt','published') and p_lease=post.dispatch_token and receipt_id=post.external_post_id;
  end if;
  late_receipt:=post.status in ('dispatching','verifying') and p_lease is not distinct from post.dispatch_token
    and p_next in ('receipt','published') and receipt_id is not null;
  if not late_receipt and (post.lease_token is distinct from p_lease or post.lease_until is null or post.lease_until<=clock_timestamp()) then return false; end if;
  if post.external_post_id is not null and receipt_id is not null and post.external_post_id<>receipt_id then return false; end if;
  if post.container_id is not null and container is not null and post.container_id<>container then return false; end if;
  reason:=left(p_error,600);
  case p_next
    when 'container_ready' then
      if post.status not in ('preparing','container_ready') or coalesce(post.container_id,container) is null then return false; end if;
      keep_lease:=true;
    when 'defer' then
      if post.status<>'container_ready' or post.container_id is null then return false; end if;
      next_status:='container_ready'; defer_until:=now()+interval '1 minute';
    when 'dispatching' then
      if post.status<>'container_ready' or post.container_id is null or post.dispatch_started_at is not null then return false; end if;
      reason:=public.office_ig_invalid_reason(post.id);
      if reason is not null then next_status:='invalidated'; else keep_lease:=true; end if;
    when 'receipt' then
      if post.status not in ('dispatching','verifying') or receipt_id is null then return false; end if;
      -- A definitive response may arrive after the read-only verifier has taken over.
      update public.office_instagram_posts set external_post_id=receipt_id,updated_at=now() where id=post.id;
      if post.external_post_id is null then
        insert into public.office_instagram_events(post_id,status,note) values(post.id,'receipt','Meta devolvió el identificador de la publicación.');
      end if;
      return true;
    when 'verifying' then
      if post.status not in ('dispatching','verifying') then return false; end if;
      defer_until:=now()+least(60,1+post.verification_attempts*2)*interval '1 minute';
    when 'observed_published' then
      if post.status<>'container_ready' or post.container_id is null or post.dispatch_started_at is not null then return false; end if;
      next_status:='verifying'; reason:='Meta indica que el contenedor ya se publicó. Se está verificando el recibo.';
    when 'provider_rejected' then
      if post.status<>'dispatching' or post.external_post_id is not null or receipt_id is not null or nullif(trim(reason),'') is null then return false; end if;
      next_status:='failed';
    when 'published' then
      if post.status not in ('dispatching','verifying') or coalesce(receipt_id,post.external_post_id) is null then return false; end if;
    when 'failed' then
      if post.status not in ('preparing','container_ready','dispatching') or post.external_post_id is not null then return false; end if;
    when 'invalidated' then
      if post.dispatch_started_at is not null or post.status not in ('preparing','container_ready') then return false; end if;
    else return false;
  end case;
  -- A creation ID can only be introduced prior to dispatch, media receipts only after it.
  if container is not null and p_next<>'container_ready' and container is distinct from post.container_id then return false; end if;
  if receipt_id is not null and post.dispatch_started_at is null then return false; end if;
  if link is not null and next_status<>'published' then return false; end if;
  update public.office_instagram_posts set status=next_status,last_error=reason,
    container_id=coalesce(post.container_id,container),external_post_id=coalesce(post.external_post_id,receipt_id),
    permalink=coalesce(post.permalink,link),published_at=case when next_status='published' then now() else post.published_at end,
    lease_token=case when keep_lease then post.lease_token end,
    lease_until=case when keep_lease then clock_timestamp()+interval '120 seconds' end,next_attempt_at=defer_until,
    dispatch_started_at=case when next_status='dispatching' or p_next='observed_published' then now() else post.dispatch_started_at end,
    provider_rejected_at=case when p_next='provider_rejected' then now() else post.provider_rejected_at end,
    dispatch_token=case when next_status='dispatching' then p_lease else post.dispatch_token end,updated_at=now() where id=post.id;
  if next_status<>post.status or reason is distinct from post.last_error then
    insert into public.office_instagram_events(post_id,status,note) values(post.id,next_status,reason);
  end if;
  return p_next<>'dispatching' or next_status='dispatching';
end $$;

create function public.office_ig_cancel(p_actor uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); post public.office_instagram_posts;
begin
  select * into post from public.office_instagram_posts where id=p_id for update;
  if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
  if post.status='cancelled' then return true; end if;
  if post.dispatch_started_at is not null or post.status not in ('queued','preparing','container_ready') then raise exception 'OFFICE_CONFLICT'; end if;
  update public.office_instagram_posts set status='cancelled',lease_token=null,lease_until=null,updated_at=now() where id=post.id;
  insert into public.office_instagram_events(post_id,status,actor_id,note) values(post.id,'cancelled',actor,'Administración canceló la publicación.');
  return true;
end $$;

create function public.office_ig_metrics(p_id uuid,p_media_id text,p_metrics jsonb,p_permalink text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_metrics is not null and (jsonb_typeof(p_metrics)<>'object' or octet_length(p_metrics::text)>65536) then raise exception 'OFFICE_INVALID'; end if;
  if p_permalink is not null and (length(p_permalink)>2048 or p_permalink !~* '^https://(www\.)?instagram\.com/[^[:space:]]+$') then raise exception 'OFFICE_INVALID'; end if;
  update public.office_instagram_posts set metrics=coalesce(p_metrics,metrics),metrics_updated_at=case when p_metrics is not null then now() else metrics_updated_at end,
    permalink=coalesce(permalink,p_permalink),updated_at=now() where id=p_id and status='published' and external_post_id=p_media_id;
  return found;
end $$;

create function public.office_ig_invalidate_replaced_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  with invalidated as (
    update public.office_instagram_posts set status='invalidated',lease_token=null,lease_until=null,last_error='El entregable tiene una nueva versión.',updated_at=now()
    where deliverable_id=new.deliverable_id and version_id<>new.id and dispatch_started_at is null
      and status in ('queued','preparing','container_ready') returning id,last_error)
  insert into public.office_instagram_events(post_id,status,note) select id,'invalidated',last_error from invalidated;
  return new;
end $$;
create trigger office_ig_invalidate_on_version after insert on public.office_versions for each row execute function public.office_ig_invalidate_replaced_version();

revoke all on function public.office_ig_invalid_reason(uuid),public.office_ig_source(uuid),
  public.office_ig_approve(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,text,text,timestamptz),public.office_ig_claim(uuid),
  public.office_ig_transition(uuid,uuid,text,text,text,text,text),public.office_ig_cancel(uuid,uuid),
  public.office_ig_metrics(uuid,text,jsonb,text),public.office_ig_invalidate_replaced_version()
  from public,anon,authenticated,service_role;
grant execute on function public.office_ig_invalid_reason(uuid),public.office_ig_source(uuid),
  public.office_ig_approve(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,text,text,timestamptz),public.office_ig_claim(uuid),
  public.office_ig_transition(uuid,uuid,text,text,text,text,text),public.office_ig_cancel(uuid,uuid),
  public.office_ig_metrics(uuid,text,jsonb,text),public.office_ig_invalidate_replaced_version() to service_role;
commit;
