begin;

-- Only the transaction creating an explicit new publication order sets these
-- columns. Ordinary runs, historical reviews and pilot variants have no order.
alter table public.office_runs
  add column instagram_publication text check (instagram_publication in ('photo','reel')),
  add column atlas_account_id text,
  add column atlas_connected_at timestamptz,
  add column atlas_review_status text check (atlas_review_status in ('pending','human','approved')),
  add column atlas_review_note text,
  add column atlas_review_after timestamptz,
  add column atlas_post_id uuid unique references public.office_instagram_posts(id),
  add check ((instagram_publication is null) = (atlas_review_status is null)),
  add check ((atlas_review_status is not distinct from 'approved') = (atlas_post_id is not null));
grant update(instagram_publication,atlas_account_id,atlas_connected_at,atlas_review_status,atlas_review_note,atlas_review_after,atlas_post_id)
  on public.office_runs to service_role;
create index office_atlas_review_due on public.office_runs(atlas_review_after,id)
  where atlas_review_status='pending' and status='review' and result_version_id is not null;
alter table public.office_instagram_posts add column approval_agent text check (approval_agent='atlas');
grant update(approval_agent) on public.office_instagram_posts to service_role;
alter table public.office_versions add column reviewed_by_agent text check (reviewed_by_agent is null or (reviewed_by_agent='atlas' and status='aprobado'));
grant update(reviewed_by_agent) on public.office_versions to service_role;

create function public.office_create_instagram_order(p_user uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  receipt jsonb; run_id uuid; task_id uuid;
  actor uuid:=public.office_actor(p_user);
  format text:=p_input->>'instagram_publication';
  connection record; prior boolean;
begin
  if (p_input->>'action') is distinct from 'create_task' or (p_input->>'department_id') is distinct from 'marketing'
    or format is null or format not in ('photo','reel') or p_input->>'status' is null
    or p_input->>'status' not in ('pendiente','en_curso') then raise exception 'OFFICE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||(p_input->>'request_id'),0));
  select exists(select from public.office_requests where actor_id=actor and request_id=(p_input->>'request_id')::uuid) into prior;
  receipt:=public.office_apply(p_user,p_input);
  task_id:=(receipt->>'id')::uuid;
  if prior and not exists(select from public.office_runs r where r.actor_id=actor and r.request_id=(p_input->>'request_id')::uuid
    and r.task_id=(receipt->>'id')::uuid and r.instagram_publication=format) then raise exception 'OFFICE_CONFLICT'; end if;
  run_id:=public.office_run_enqueue(p_user,task_id,(p_input->>'request_id')::uuid,null);
  if exists(select 1 from public.office_runs r where r.id=run_id and r.instagram_publication is not null) then
    return receipt || jsonb_build_object('run_id',run_id);
  end if;
  select account_id,connected_at into connection from public.tc_social_connections_v2
    where provider='instagram' and lower(username)='tarotcelestialof';
  update public.office_runs set instagram_publication=format,atlas_review_status='pending',atlas_review_after=now(),
    atlas_account_id=connection.account_id,atlas_connected_at=connection.connected_at where id=run_id;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values('marketing',task_id,actor,'atlas_publication_order',
      'Administración encargó a Atlas revisar y publicar '||case when format='reel' then 'un reel' else 'una foto' end||' en @tarotcelestialof.',
      jsonb_build_object('run_id',run_id,'media',format,'username','tarotcelestialof','delegated_by',p_user));
  return receipt || jsonb_build_object('run_id',run_id);
end $$;

-- Review a single immutable result. Moving the retry time is a short lease
-- for the read-only provider checks. The decision below is locked separately.
create function public.office_atlas_review_candidate(p_run_id uuid default null) returns jsonb
language sql volatile security invoker set search_path='' as $$
  with picked as (
    select r.id from public.office_runs r where r.atlas_review_status='pending' and r.status='review'
      and r.result_version_id is not null and r.atlas_review_after<=clock_timestamp() and (p_run_id is null or r.id=p_run_id)
    order by r.atlas_review_after,r.id limit 1 for update of r skip locked
  )
  update public.office_runs r set atlas_review_after=clock_timestamp()+interval '2 minutes' from picked
    where r.id=picked.id returning jsonb_build_object('id',r.id,'version_id',r.result_version_id,'format',r.instagram_publication)
$$;

-- A failed editorial check hands this exact run to human review. Transient
-- database and provider failures leave the review pending for the next round.
create function public.office_atlas_decide_publication(p_run_id uuid,p_version_id uuid,p_review jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare
  job public.office_runs; task public.office_tasks; v public.office_versions; policy text;
  pid uuid; reason text; owner_id text;
begin
  select * into job from public.office_runs where id=p_run_id for update;
  if not found or job.instagram_publication is null or job.status<>'review' or
    job.result_version_id is distinct from p_version_id or p_version_id is null then return null; end if;
  if job.atlas_review_status='approved' then return job.atlas_post_id; end if;
  if job.atlas_review_status<>'pending' then return null; end if;
  select * into strict task from public.office_tasks where id=job.task_id for update;
  select * into strict v from public.office_versions where id=p_version_id and task_id=task.id;
  if job.revision_id is not null or task.department_id<>'marketing' or task.status<>'en_revision'
    or task.revision<>job.task_revision+1 or v.status<>'pendiente' or v.version<>1
    or exists(select 1 from public.office_versions newer where newer.deliverable_id=v.deliverable_id and newer.version>v.version) then
    reason:='La versión o el encargo cambió. La decisión queda en manos de Administración.';
  elsif public.tc_has_admin_access(job.actor_user_id) is not true then reason:='La autorización administrativa del encargo ha caducado.';
  elsif not exists(select 1 from public.tc_social_connections_v2 c where c.provider='instagram' and lower(c.username)='tarotcelestialof'
    and c.account_id=job.atlas_account_id and c.connected_at=job.atlas_connected_at) then
    reason:='La conexión de @tarotcelestialof cambió desde el encargo.';
  elsif v.file_type is null or (job.instagram_publication='reel' and v.file_type<>'video/mp4')
    or (job.instagram_publication='photo' and v.file_type not in ('image/jpeg','image/png','image/webp')) then
    reason:='La entrega no coincide con el formato encargado.';
  elsif nullif(trim(p_review->>'retry'),'') is not null then
    update public.office_runs set atlas_review_note=left(p_review->>'retry',500),atlas_review_after=now()+interval '10 minutes'
      where id=job.id;
    return null;
  elsif nullif(trim(p_review->>'reason'),'') is not null then reason:=left(p_review->>'reason',500);
  elsif nullif(btrim(job.outputs#>>'{1,caption}'),'') is null or normalize(job.outputs#>>'{1,caption}') is distinct from p_review->>'caption'
    or v.title is distinct from job.outputs#>>'{1,headline}' then
    reason:='El texto final debe coincidir con la pieza de Marketing que revisa Atlas.';
  else
    policy:=public.office_autonomy_check('instagram_publish','instagram',job.atlas_account_id,null,false);
    if policy='handoff' then reason:='La regla de publicación requiere revisión humana.';
    elsif policy is distinct from 'allow' then
      update public.office_runs set atlas_review_note='Atlas espera a que la política, el horario o el límite de publicación permitan aprobar.',
        atlas_review_after=now()+interval '5 minutes' where id=job.id;
      return null;
    end if;
    if reason is null then
      if (p_review->>'username') is distinct from 'tarotcelestialof' or (p_review->>'persisted_account_id') is distinct from job.atlas_account_id
        or (p_review->>'connected_at')::timestamptz is distinct from job.atlas_connected_at
        or (p_review->>'media_type') is distinct from (case job.instagram_publication when 'photo' then 'image/jpeg' else 'video/mp4' end) then
        reason:='El destino o el archivo verificado ya no coincide con el encargo.';
      else
        select coalesce(c.connected_by::text,b.actor_user_id::text,job.actor_user_id::text) into owner_id from public.tc_social_connections_v2 c
          left join public.office_ig_connection_owners b on b.account_id=c.account_id and b.connected_at=c.connected_at
          where c.provider='instagram' and c.account_id=job.atlas_account_id and c.connected_at=job.atlas_connected_at;
        begin
          perform public.office_apply(job.actor_user_id,jsonb_build_object('request_id',gen_random_uuid(),'action','review_version',
            'id',v.id,'decision','aprobado','note','Atlas aprobó esta versión por delegación para @tarotcelestialof.'));
          pid:=public.office_ig_approve(job.actor_user_id,v.id,job.id,p_review->>'account_id','tarotcelestialof',owner_id,
            p_review->>'caption',p_review->>'alt_text',p_review->>'media_sha256',null,task.time_zone,job.atlas_account_id,job.atlas_connected_at);
          update public.office_instagram_posts set approval_agent='atlas' where id=pid;
          update public.office_versions set reviewed_by_agent='atlas' where id=v.id;
        exception when raise_exception then
          if sqlerrm not in ('OFFICE_IG_APPROVAL_INVALID','OFFICE_CONFLICT','OFFICE_FORBIDDEN','OFFICE_IG_CONNECTION_CHANGED','OFFICE_INVALID') then raise; end if;
          reason:='La cuenta, el contenido o la oferta requieren revisión antes de publicar.';
        end;
      end if;
    end if;
  end if;
  update public.office_runs set atlas_review_status=case when pid is null then 'human' else 'approved' end,
    atlas_review_note=coalesce(reason,'Atlas aprobó la versión y la envió a la cola de publicación.'),atlas_post_id=pid,
    atlas_review_after=null,updated_at=now() where id=job.id;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values('marketing',task.id,job.actor_id,case when pid is null then 'atlas_publication_review' else 'atlas_publication_approved' end,
      coalesce(reason,'Atlas aprobó la versión para publicar en @tarotcelestialof.'),
      jsonb_build_object('reviewer','atlas','delegated_by',job.actor_user_id,'run_id',job.id,'version_id',v.id,'post_id',pid));
  return pid;
end $$;

-- An edit or withdrawal before dispatch supersedes the mandate even when the
-- attached version itself did not change.
create function public.office_atlas_invalidate_edited_order() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  with changed as (
    update public.office_instagram_posts p set status='invalidated',lease_token=null,lease_until=null,updated_at=now(),
      last_error='Administración modificó el encargo después de la aprobación de Atlas.'
    from public.office_runs r where r.task_id=new.id and p.id=r.atlas_post_id and r.atlas_review_status='approved'
      and (new.status<>'en_revision' or new.revision<>r.task_revision+1)
      and p.status in ('queued','preparing','container_ready') and p.dispatch_started_at is null
    returning p.id,p.last_error
  )
  insert into public.office_instagram_events(post_id,status,note) select id,'invalidated',last_error from changed;
  return new;
end $$;
create trigger office_atlas_invalidate_edited_order after update of status,revision on public.office_tasks
for each row when (new.status is distinct from old.status or new.revision is distinct from old.revision)
execute function public.office_atlas_invalidate_edited_order();

revoke all on function public.office_create_instagram_order(uuid,jsonb),public.office_atlas_review_candidate(uuid),
  public.office_atlas_decide_publication(uuid,uuid,jsonb),public.office_atlas_invalidate_edited_order() from public,anon,authenticated;
grant execute on function public.office_create_instagram_order(uuid,jsonb),public.office_atlas_review_candidate(uuid),
  public.office_atlas_decide_publication(uuid,uuid,jsonb) to service_role;

create or replace function public.office_snapshot(p_user uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid := public.office_actor(p_user);
begin
  return jsonb_build_object(
    'actorId',actor,
    'departments',(select jsonb_agg(to_jsonb(d) order by id) from public.office_departments d),
    'workers',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',coalesce(nullif(trim(w.display_name),''),'Personal del equipo')) order by w.display_name,w.id)
      from public.workers w where w.is_active is not false),'[]'),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by updated_at desc,id) from public.office_tasks t),'[]'),
    'versions',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id) from (
      select id,task_id,deliverable_id,version,title,body,file_name,file_type,file_size,status,review_note,reviewed_by,reviewed_by_agent,reviewed_at,created_by,created_at
      from public.office_versions) v),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,id) from (
      select id,department_id,previous_department_id,task_id,actor_id,kind,note,created_at from public.office_events) e),'[]')
  );
end $$;

commit;
