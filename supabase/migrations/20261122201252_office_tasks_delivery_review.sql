begin;

create function public.office_sync_delivered_task(p_run_id uuid,p_follow_versions boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare
  job record;
  task record;
  current_version record;
begin
  select id,task_id,task_revision,result_version_id,actor_id into job
    from public.office_runs where id=p_run_id and status='review' and result_version_id is not null;
  if not found then return; end if;

  -- The editor, reviews and new versions all acquire this same task lock.
  -- Read the version decision only after any preceding human edit has committed.
  select id,department_id,status,revision into task from public.office_tasks where id=job.task_id for update;
  if not found or task.revision<>job.task_revision or task.status not in ('pendiente','en_curso') then return; end if;
  select latest.id,latest.version,latest.status into current_version
    from public.office_versions delivered
    join public.office_versions latest on latest.deliverable_id=delivered.deliverable_id and latest.task_id=delivered.task_id
    where delivered.id=job.result_version_id and delivered.task_id=task.id order by latest.version desc limit 1;
  if not found or current_version.status<>'pendiente'
    or (not p_follow_versions and current_version.id<>job.result_version_id) then return; end if;

  update public.office_tasks set status='en_revision',revision=revision+1,updated_at=now() where id=task.id;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values(task.department_id,task.id,job.actor_id,'task_review_requested',
      'La Oficina pasó el encargo a revisión tras la entrega de la versión '||current_version.version||'.',
      jsonb_build_object('run_id',job.id,'run_version_id',job.result_version_id,'version_id',current_version.id,
        'previous_status',task.status,'current_status','en_revision','previous_revision',task.revision,'current_revision',task.revision+1));
end $$;

create function public.office_task_to_review_on_delivery() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform public.office_sync_delivered_task(new.id,false);
  return new;
end $$;

revoke all on function public.office_sync_delivered_task(uuid,boolean),public.office_task_to_review_on_delivery()
  from public,anon,authenticated,service_role;
grant execute on function public.office_sync_delivered_task(uuid,boolean),public.office_task_to_review_on_delivery()
  to service_role;
create trigger office_task_to_review_after_delivery after update of status,result_version_id on public.office_runs
  for each row when (new.status='review' and new.result_version_id is not null
    and (old.status is distinct from new.status or old.result_version_id is distinct from new.result_version_id))
  execute function public.office_task_to_review_on_delivery();

-- A historical delivery can already have received an editorial revision. Only
-- the latest pending version of that same deliverable qualifies for this repair.
do $backfill$
declare candidate uuid;
begin
  for candidate in
    select r.id from public.office_runs r join public.office_tasks t on t.id=r.task_id
    where r.status='review' and r.result_version_id is not null and t.revision=r.task_revision
      and t.status in ('pendiente','en_curso') order by t.id,r.updated_at desc,r.id
  loop
    perform public.office_sync_delivered_task(candidate,true);
  end loop;
end $backfill$;

commit;
