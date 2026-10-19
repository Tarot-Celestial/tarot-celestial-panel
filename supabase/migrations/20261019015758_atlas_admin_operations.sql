begin;

-- Atlas uses the existing verified staff identity. These operational records are
-- server-only; private conversations belonging to central pets are never copied.
create table if not exists public.atlas_admin_messages (
 id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.workers(id),
 request_id uuid, role text not null check(role in ('user','assistant')),
 content text not null check(length(content)<=20000), result jsonb not null default '{}',
 created_at timestamptz not null default now(), unique(worker_id,request_id,role)
);
create index if not exists atlas_messages_worker_date on public.atlas_admin_messages(worker_id,created_at desc,id);
create table if not exists public.atlas_admin_memories (
 id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.workers(id),
 content text not null check(length(content) between 1 and 4000), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists atlas_memories_worker on public.atlas_admin_memories(worker_id,created_at desc) where active;
create table if not exists public.atlas_admin_proposals (
 id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.workers(id),
 kind text not null, title text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','executing','completed','failed','cancelled')),
 result jsonb, error text, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes',
 executed_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists atlas_proposals_worker_date on public.atlas_admin_proposals(worker_id,created_at desc);
create table if not exists public.atlas_admin_settings (
 singleton boolean primary key default true check(singleton),
 timezone text not null default 'America/Guayaquil' check(timezone='America/Guayaquil'),
 daily_revenue_goal numeric(12,2) not null default 300 check(daily_revenue_goal>0),
 monthly_capture_goal integer not null default 10 check(monthly_capture_goal>0),
 updated_by_worker_id uuid references public.workers(id), updated_at timestamptz not null default now()
);
insert into public.atlas_admin_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.atlas_admin_jobs (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null,
 created_by_worker_id uuid not null references public.workers(id), worker_id uuid not null references public.workers(id),
 kind text not null check(kind in ('capture','recovery','task')), title text not null check(length(title) between 1 and 200),
 description text not null default '' check(length(description)<=4000),
 client_ids uuid[] not null default '{}', lead_ids uuid[] not null default '{}', payload jsonb not null default '{}',
 status text not null default 'pending' check(status in ('pending','in_progress','completed','blocked','cancelled')),
 result text check(length(result)<=4000), due_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 unique(operation_id,worker_id)
);
create index if not exists atlas_jobs_worker_status on public.atlas_admin_jobs(worker_id,status,due_at);
create index if not exists atlas_jobs_creator on public.atlas_admin_jobs(created_by_worker_id,created_at desc);
create index if not exists atlas_jobs_open_clients on public.atlas_admin_jobs using gin(client_ids) where status in ('pending','in_progress','blocked');
create table if not exists public.atlas_admin_audit (
 id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.workers(id), operation_id uuid,
 action text not null, entity_type text, entity_id text, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists atlas_audit_worker_date on public.atlas_admin_audit(worker_id,created_at desc);
create index if not exists atlas_audit_operation on public.atlas_admin_audit(operation_id);
create table if not exists public.atlas_admin_dispatches (
 operation_id uuid primary key, worker_id uuid not null references public.workers(id),
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create index if not exists atlas_dispatches_worker on public.atlas_admin_dispatches(worker_id,created_at desc);
create table if not exists public.atlas_admin_job_outcomes (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 job_id uuid not null references public.atlas_admin_jobs(id), worker_id uuid not null references public.workers(id),
 client_id uuid not null references public.crm_clientes(id),
 channel text not null check(channel in ('whatsapp','phone','email','other')),
 outcome text not null check(outcome in ('responded','interested','no_answer','followup')),
 note text not null default '' check(length(note)<=2000), next_contact_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists atlas_outcomes_job on public.atlas_admin_job_outcomes(job_id,created_at);
create index if not exists atlas_outcomes_worker on public.atlas_admin_job_outcomes(worker_id,created_at);
create index if not exists atlas_outcomes_client on public.atlas_admin_job_outcomes(client_id,created_at desc);

do $$ declare t text; begin
 foreach t in array array['atlas_admin_messages','atlas_admin_memories','atlas_admin_proposals','atlas_admin_settings','atlas_admin_jobs','atlas_admin_audit','atlas_admin_dispatches','atlas_admin_job_outcomes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
 end loop;
end $$;

create or replace function public.tc_atlas_now() returns timestamptz language sql stable security invoker set search_path=public,pg_temp as $$ select now() $$;

create or replace function public.tc_atlas_admin(p_user uuid) returns uuid
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid; begin
 select id into actor from workers where user_id=p_user and role='admin' and is_active is distinct from false order by id limit 1;
 if actor is null then raise exception 'FORBIDDEN'; end if;
 return actor;
end $$;

create or replace function public.tc_atlas_claim(p_user uuid,p_proposal uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=tc_atlas_admin(p_user); proposal atlas_admin_proposals; begin
 select * into proposal from atlas_admin_proposals where id=p_proposal and worker_id=actor for update;
 if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;
 if proposal.status<>'pending' then return jsonb_build_object('claimed',false,'proposal',to_jsonb(proposal)); end if;
 if proposal.expires_at<=tc_atlas_now() then raise exception 'PROPOSAL_EXPIRED'; end if;
 update atlas_admin_proposals set status='executing',updated_at=tc_atlas_now() where id=p_proposal returning * into proposal;
 insert into atlas_admin_audit(worker_id,operation_id,action,entity_type,entity_id) values(actor,p_proposal,'claim','proposal',p_proposal::text);
 return jsonb_build_object('claimed',true,'proposal',to_jsonb(proposal));
end $$;

create or replace function public.tc_atlas_finish(p_user uuid,p_proposal uuid,p_result jsonb,p_error text default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=tc_atlas_admin(p_user); proposal atlas_admin_proposals; begin
 select * into proposal from atlas_admin_proposals where id=p_proposal and worker_id=actor for update;
 if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;
 if proposal.status in ('completed','failed') then return to_jsonb(proposal); end if;
 if proposal.status<>'executing' then raise exception 'PROPOSAL_NOT_CLAIMED'; end if;
 update atlas_admin_proposals set status=case when p_error is null then 'completed' else 'failed' end,
  result=p_result,error=left(p_error,1000),executed_at=tc_atlas_now(),updated_at=tc_atlas_now() where id=p_proposal returning * into proposal;
 insert into atlas_admin_audit(worker_id,operation_id,action,entity_type,entity_id,detail)
  values(actor,p_proposal,proposal.status,'proposal',p_proposal::text,jsonb_build_object('result',p_result,'error',left(p_error,1000)));
 return to_jsonb(proposal);
end $$;

-- One eligibility source is used for previews and locked execution. A ranking
-- is an operational priority, never a predicted likelihood of purchasing.
create or replace function public.tc_atlas_candidate_rows(p_kind text,p_worker uuid default null)
returns table(id uuid,client_id uuid,lead_id uuid,name text,worker_id uuid,reasons jsonb,priority integer,last_contact_at timestamptz,next_contact_at timestamptz)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if p_kind='capture' then
  return query
  select distinct on (l.cliente_id) l.id,l.cliente_id,l.id,trim(concat_ws(' ',c.nombre,c.apellido)),l.assigned_worker_id,
   jsonb_build_array(case when l.next_contact_at is not null then 'Seguimiento que ya corresponde' else 'Contacto pendiente sin fecha futura' end,
    case when l.estado in ('pend_cap','hizo_free','recontacto') then 'Tiene una consulta gratuita registrada' else 'No consta una primera compra confirmada' end),
   case when l.estado in ('pend_cap','hizo_free','recontacto') then 0 when l.next_contact_at is not null then 1 else 2 end,
   coalesce(l.last_contact_at,l.contacted_at),l.next_contact_at
  from captacion_leads l join crm_clientes c on c.id=l.cliente_id
  where l.closed_at is null and coalesce(l.estado,'nuevo') not in ('cliente','captado','no_interesado','numero_invalido','perdido','cerrado','finalizado')
   and (l.next_contact_at is null or l.next_contact_at<=tc_atlas_now())
   and coalesce(l.intento_actual,0)<=coalesce(l.max_intentos,3)
   and coalesce(c.origen,'') not ilike '%orion%' and length(regexp_replace(coalesce(c.telefono,''),'[^0-9]','','g'))>=6
   and coalesce(c.estado,'') not in ('baja','deleted','eliminado','archivado')
   and coalesce(to_jsonb(c)->>'do_not_contact','false')<>'true' and coalesce(to_jsonb(c)->>'marketing_opt_out','false')<>'true'
   and (p_worker is null or l.assigned_worker_id is null or l.assigned_worker_id=p_worker)
   and (l.assigned_worker_id is null or exists(select 1 from workers w where w.id=l.assigned_worker_id and w.role='central' and w.is_active is distinct from false))
   and not exists(select 1 from crm_client_capture_assignments a where a.client_id=c.id and a.status='confirmed')
   and not exists(select 1 from crm_cliente_pagos p where p.cliente_id=c.id and p.estado='completed' and p.importe>0)
   and not exists(select 1 from rendimiento_llamadas r where r.cliente_id=c.id::text and r.cliente_compra_minutos and r.importe>0)
   and not exists(select 1 from atlas_admin_jobs j where j.kind='capture' and j.status in ('pending','in_progress','blocked') and j.client_ids @> array[c.id])
  order by l.cliente_id,l.next_contact_at nulls last,l.created_at,l.id;
 elsif p_kind='recovery' then
  if extract(isodow from tc_atlas_now() at time zone 'America/Guayaquil') not between 1 and 5 then return; end if;
  return query
  select c.id,c.id,null::uuid,c.nombre,r.responsible_id,
   jsonb_build_array(case when a.client_id is not null then 'Ya pertenece a la misión de hoy' when h.last_at is not null then 'Seguimiento de recuperación que ya corresponde' else 'Pendiente de primera gestión de recuperación' end,'Cumple la elegibilidad de Recuperar clientes'),
   case when a.client_id is not null then 0 when h.last_at is not null then 1 else 2 end,h.last_at,null::timestamptz
  from tc_recovery_candidates c join crm_clientes cl on cl.id=c.id
  left join crm_client_recovery r on r.client_id=c.id
  left join crm_recovery_mission_schedules s on s.worker_id=coalesce(p_worker,r.responsible_id)
  left join crm_recovery_mission_assignments a on a.client_id=c.id and a.mission_day=(tc_atlas_now() at time zone 'America/Guayaquil')::date
  left join lateral(select max(hh.created_at) last_at from crm_client_recovery_history hh where hh.client_id=c.id and hh.status in ('contacted','no_response')) h on true
  where c.eligible and coalesce(r.status,'pending') in ('pending','contacted','no_response')
   and coalesce(cl.estado,'') not in ('baja','deleted','eliminado','archivado')
   and coalesce(to_jsonb(cl)->>'do_not_contact','false')<>'true' and coalesce(to_jsonb(cl)->>'marketing_opt_out','false')<>'true'
   and (p_worker is null or r.responsible_id is null or r.responsible_id=p_worker)
   and (p_worker is null or exists(select 1 from crm_recovery_mission_schedules ss where ss.worker_id=p_worker and ss.enabled))
   and exists(select 1 from crm_recovery_mission_schedules ss join workers ww on ww.id=ss.worker_id
    where ss.enabled and ww.role='central' and ww.is_active is distinct from false
     and (coalesce(p_worker,r.responsible_id) is null or ss.worker_id=coalesce(p_worker,r.responsible_id))
     and (((tc_atlas_now() at time zone 'America/Guayaquil')::date+ss.end_time) at time zone 'America/Guayaquil')>tc_atlas_now())
   and (r.responsible_id is null or exists(select 1 from workers w join crm_recovery_mission_schedules ss on ss.worker_id=w.id and ss.enabled where w.id=r.responsible_id and w.role='central' and w.is_active is distinct from false))
   and (a.client_id is null or a.worker_id=coalesce(p_worker,r.responsible_id))
   and not exists(select 1 from crm_recovery_contact_events e where e.client_id=c.id and e.mission_day=(tc_atlas_now() at time zone 'America/Guayaquil')::date and e.counted)
   and (coalesce(h.last_at,r.contacted_at) is null or coalesce(h.last_at,r.contacted_at)<=tc_atlas_now()-make_interval(days=>coalesce(s.followup_days,7)))
   and not exists(select 1 from atlas_admin_jobs j where j.kind='recovery' and j.status in ('pending','in_progress','blocked') and j.client_ids @> array[c.id]);
 else raise exception 'INVALID_KIND'; end if;
end $$;

create or replace function public.tc_atlas_candidates(p_user uuid,p_kind text,p_count integer default 10,p_worker uuid default null) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 perform tc_atlas_admin(p_user);
 if p_count not between 1 and 100 then raise exception 'INVALID_COUNT'; end if;
 if p_worker is not null and not exists(select 1 from workers where id=p_worker and role='central' and is_active is distinct from false) then raise exception 'INVALID_WORKER'; end if;
 return jsonb_build_object('kind',p_kind,'requested',p_count,'updatedAt',tc_atlas_now(),'timezone','America/Guayaquil',
  'criterion','Prioridad por seguimiento vencido, estado y asignación; no predice compras.',
  'candidates',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from tc_atlas_candidate_rows(p_kind,p_worker) order by priority,next_contact_at nulls last,last_contact_at nulls first,id limit p_count)x),'[]'::jsonb));
end $$;

create or replace function public.tc_atlas_dispatch(p_user uuid,p_payload jsonb,p_operation uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=tc_atlas_admin(p_user); previous atlas_admin_dispatches; item jsonb; target uuid; client uuid; lead uuid; k text:=p_payload->>'kind';
 day date:=(tc_atlas_now() at time zone 'America/Guayaquil')::date; workers_list uuid[]; client_list uuid[]; lead_list uuid[]; output jsonb; jobs jsonb:='[]'; job atlas_admin_jobs; due timestamptz; count_assigned integer:=0;
begin
 if p_operation is null then raise exception 'OPERATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('atlas-dispatch:'||p_operation,0));
 select * into previous from atlas_admin_dispatches where operation_id=p_operation;
 if found then
  if previous.worker_id<>actor or previous.payload<>p_payload then raise exception 'OPERATION_CONFLICT'; end if;
  return previous.result||jsonb_build_object('duplicate_prevented',true);
 end if;
 if k not in ('capture','recovery','task') or nullif(trim(p_payload->>'title'),'') is null or length(p_payload->>'title')>200 or length(coalesce(p_payload->>'description',''))>4000 then raise exception 'INVALID_DISPATCH'; end if;
 due:=nullif(p_payload->>'due_at','')::timestamptz;
 if due is not null and (due<=tc_atlas_now() or due>tc_atlas_now()+interval '90 days') then raise exception 'INVALID_DUE_DATE'; end if;
 if k='task' then
  select array_agg(distinct value::uuid order by value::uuid) into workers_list from jsonb_array_elements_text(p_payload->'worker_ids');
 else
  if jsonb_typeof(p_payload->'items')<>'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'INVALID_DISPATCH'; end if;
  if (select count(distinct i->>'client_id') from jsonb_array_elements(p_payload->'items')i)<>jsonb_array_length(p_payload->'items') then raise exception 'DUPLICATE_CLIENT'; end if;
  select array_agg(distinct (i->>'worker_id')::uuid order by (i->>'worker_id')::uuid) into workers_list from jsonb_array_elements(p_payload->'items')i;
 end if;
 if coalesce(cardinality(workers_list),0) not between 1 and 20 or exists(select 1 from unnest(workers_list) w where not exists(select 1 from workers where id=w and role='central' and is_active is distinct from false)) then raise exception 'INVALID_WORKER'; end if;
 if k='recovery' then
  if extract(isodow from day) not between 1 and 5 then raise exception 'RECOVERY_WEEKDAYS_ONLY'; end if;
  foreach target in array workers_list loop
   perform pg_advisory_xact_lock(hashtextextended('recovery-assign:'||target||':'||day,0));
  end loop;
 end if;
 -- Sorted client locks also serialize concurrent capture/recovery dispatches.
 if k<>'task' then
  perform 1 from crm_clientes where id in(select (i->>'client_id')::uuid from jsonb_array_elements(p_payload->'items')i) order by id for update;
  if k='capture' then perform 1 from captacion_leads where id in(select (i->>'lead_id')::uuid from jsonb_array_elements(p_payload->'items')i) order by id for update; end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
   target:=(item->>'worker_id')::uuid; client:=(item->>'client_id')::uuid; lead:=nullif(item->>'lead_id','')::uuid;
   if not exists(select 1 from tc_atlas_candidate_rows(k,target) c where c.client_id=client and (k='recovery' or c.lead_id=lead)) then raise exception 'CANDIDATE_CHANGED'; end if;
   if k='capture' then
    update captacion_leads set assigned_worker_id=target,assigned_role='central',updated_at=tc_atlas_now() where id=lead;
   else
    if not exists(select 1 from crm_recovery_mission_assignments where client_id=client and mission_day=day) then
     if (select count(*) from crm_recovery_mission_assignments a join crm_client_recovery r on r.client_id=a.client_id join tc_recovery_candidates c on c.id=a.client_id
       where a.worker_id=target and a.mission_day=day and (exists(select 1 from crm_recovery_contact_events e where e.worker_id=target and e.mission_day=day and e.client_id=a.client_id and e.counted)
        or (r.responsible_id=target and c.eligible and r.status in ('pending','contacted','no_response'))))>=30 then raise exception 'MISSION_FULL'; end if;
     insert into crm_client_recovery(client_id,responsible_id) values(client,target)
      on conflict(client_id) do update set responsible_id=excluded.responsible_id,version=crm_client_recovery.version+1 where crm_client_recovery.responsible_id is null;
     if not exists(select 1 from crm_client_recovery where client_id=client and responsible_id=target and status in ('pending','contacted','no_response')) then raise exception 'CANDIDATE_CHANGED'; end if;
     insert into crm_recovery_mission_assignments(mission_day,worker_id,client_id) values(day,target,client);
    end if;
   end if;
   count_assigned:=count_assigned+1;
  end loop;
 end if;
 foreach target in array workers_list loop
  due:=coalesce(nullif(p_payload->'due_by_worker'->>target::text,'')::timestamptz,nullif(p_payload->>'due_at','')::timestamptz);
  if due is not null and (due<=tc_atlas_now() or due>tc_atlas_now()+interval '90 days') then raise exception 'INVALID_DUE_DATE'; end if;
  select coalesce(array_agg((i->>'client_id')::uuid),'{}'::uuid[]),coalesce(array_agg((i->>'lead_id')::uuid) filter(where i->>'lead_id' is not null),'{}'::uuid[])
   into client_list,lead_list from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))i where (i->>'worker_id')::uuid=target;
  insert into atlas_admin_jobs(operation_id,created_by_worker_id,worker_id,kind,title,description,client_ids,lead_ids,payload,due_at)
   values(p_operation,actor,target,k,p_payload->>'title',coalesce(p_payload->>'description',''),client_list,lead_list,jsonb_build_object('source','atlas','mission_day',day),due) returning * into job;
  jobs:=jobs||jsonb_build_array(to_jsonb(job));
 end loop;
 output:=jsonb_build_object('ok',true,'jobs',jobs,'assigned',count_assigned,'duplicate_prevented',false);
 insert into atlas_admin_dispatches(operation_id,worker_id,payload,result) values(p_operation,actor,p_payload,output);
 insert into atlas_admin_audit(worker_id,operation_id,action,entity_type,entity_id,detail) values(actor,p_operation,'dispatch','jobs',p_operation::text,jsonb_build_object('kind',k,'assigned',count_assigned,'workers',workers_list));
 return output;
end $$;

create or replace function public.tc_atlas_update_job(p_user uuid,p_job uuid,p_status text,p_result text default '') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare job atlas_admin_jobs; actor uuid; begin
 select * into job from atlas_admin_jobs where id=p_job for update;
 if not found then raise exception 'JOB_NOT_FOUND'; end if;
 select id into actor from workers where user_id=p_user and id=job.worker_id and role='central' and is_active is distinct from false;
 if actor is null then raise exception 'FORBIDDEN'; end if;
 if p_status not in ('in_progress','completed','blocked') or length(coalesce(p_result,''))>4000 then raise exception 'INVALID_JOB_STATUS'; end if;
 if p_status in ('completed','blocked') and nullif(trim(p_result),'') is null then raise exception 'RESULT_REQUIRED'; end if;
 if job.status=p_status and coalesce(job.result,'')=coalesce(p_result,'') then return to_jsonb(job)||jsonb_build_object('duplicate_prevented',true); end if;
 if job.status in ('completed','cancelled') then raise exception 'JOB_CLOSED'; end if;
 update atlas_admin_jobs set status=p_status,result=p_result,updated_at=tc_atlas_now(),completed_at=case when p_status='completed' then tc_atlas_now() else null end where id=p_job returning * into job;
 insert into atlas_admin_audit(worker_id,operation_id,action,entity_type,entity_id,detail)
  values(actor,job.operation_id,'job_status','job',p_job::text,jsonb_build_object('status',p_status,'result',p_result));
 return to_jsonb(job)||jsonb_build_object('duplicate_prevented',false);
end $$;

create or replace function public.tc_atlas_record_outcome(p_user uuid,p_job uuid,p_client uuid,p_channel text,p_outcome text,p_note text,p_next_contact_at timestamptz,p_request uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare job atlas_admin_jobs; actor uuid; event atlas_admin_job_outcomes; begin
 select * into job from atlas_admin_jobs where id=p_job for update;
 if not found then raise exception 'JOB_NOT_FOUND'; end if;
 select id into actor from workers where user_id=p_user and id=job.worker_id and role='central' and is_active is distinct from false;
 if actor is null then raise exception 'FORBIDDEN'; end if;
 if p_request is null then raise exception 'OPERATION_REQUIRED'; end if;
 select * into event from atlas_admin_job_outcomes where request_id=p_request;
 if found then
  if event.job_id<>p_job or event.worker_id<>actor or event.client_id<>p_client or event.channel<>p_channel or event.outcome<>p_outcome or event.note<>coalesce(p_note,'') or event.next_contact_at is distinct from p_next_contact_at then raise exception 'OPERATION_CONFLICT'; end if;
  return to_jsonb(event)||jsonb_build_object('duplicate_prevented',true);
 end if;
 if job.status in ('completed','cancelled') then raise exception 'JOB_CLOSED'; end if;
 if not p_client=any(job.client_ids) then raise exception 'CLIENT_NOT_ASSIGNED'; end if;
 if p_channel not in ('whatsapp','phone','email','other') or p_outcome not in ('responded','interested','no_answer','followup') or length(coalesce(p_note,''))>2000 then raise exception 'INVALID_OUTCOME'; end if;
 if p_outcome='followup' and (p_next_contact_at is null or p_next_contact_at<=tc_atlas_now()) then raise exception 'FOLLOWUP_DATE_REQUIRED'; end if;
 insert into atlas_admin_job_outcomes(request_id,job_id,worker_id,client_id,channel,outcome,note,next_contact_at)
  values(p_request,p_job,actor,p_client,p_channel,p_outcome,coalesce(p_note,''),p_next_contact_at) returning * into event;
 insert into atlas_admin_audit(worker_id,operation_id,action,entity_type,entity_id,detail)
  values(actor,p_request,'contact_outcome','job',p_job::text,jsonb_build_object('client_id',p_client,'channel',p_channel,'outcome',p_outcome));
 return to_jsonb(event)||jsonb_build_object('duplicate_prevented',false);
end $$;

do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
  ('tc_atlas_now','tc_atlas_admin','tc_atlas_claim','tc_atlas_finish','tc_atlas_candidate_rows','tc_atlas_candidates','tc_atlas_dispatch','tc_atlas_update_job','tc_atlas_record_outcome') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
