begin;

-- A human has checked the provider outcome. Closing only releases the task;
-- a fresh run still requires a separate explicit enqueue and request identifier.
create function public.office_run_resolve(p_actor uuid,p_run_id uuid,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare
  actor uuid := public.office_actor(p_actor);
  note_text text := trim(p_note);
  job public.office_runs;
  department text;
begin
  if note_text is null or length(note_text) not between 1 and 2000 then raise exception 'OFFICE_INVALID'; end if;
  select * into job from public.office_runs where id=p_run_id for update;
  if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
  if job.status='cancelled' and exists(select 1 from public.office_events e where e.task_id=job.task_id
    and e.kind='campaign_reconciled' and e.details->>'run_id'=job.id::text and e.actor_id=actor and e.note=note_text) then
    return true;
  end if;
  if job.status<>'needs_reconciliation' or job.lease_until>clock_timestamp() then raise exception 'OFFICE_CONFLICT'; end if;
  select department_id into strict department from public.office_tasks where id=job.task_id;
  -- Retain every provider receipt and all reported usage. Fence an expired attempt
  -- whose callback was lost, so a late or duplicate finish can never attach a draft.
  update public.office_run_attempts set finished_at=coalesce(finished_at,now()),outcome=coalesce(outcome,'cancelled'),
    receipt=coalesce(receipt,jsonb_build_object('id',job.id,'status','cancelled','step',job.step,'result_version_id',job.result_version_id))
    where run_id=job.id and lease_token=job.lease_token and finished_at is null;
  update public.office_runs set status='cancelled',lease_token=null,lease_until=null,
    last_error='Conciliación manual completada. La ejecución se cerró.',updated_at=now() where id=job.id;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values(department,job.task_id,actor,'campaign_reconciled',note_text,
      jsonb_build_object('run_id',job.id,'step',job.step,'previous_status',job.status,'previous_error',job.last_error));
  return true;
end $$;

revoke all on function public.office_run_resolve(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.office_run_resolve(uuid,uuid,text) to service_role;
commit;
