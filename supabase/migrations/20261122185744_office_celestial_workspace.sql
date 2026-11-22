-- Office data is available only through verified server requests.
begin;

create table public.office_departments (
  id text primary key,
  lead_worker_id uuid references public.workers(id),
  revision integer not null default 1
);
insert into public.office_departments(id) values
  ('comercial'), ('captacion-reservas'), ('marketing'), ('creacion-contenido'), ('finanzas'),
  ('servicios-seguimiento'), ('operaciones'), ('inteligencia'), ('clientes'), ('producto-id'),
  ('talento'), ('legal-documentacion'), ('compras-alianzas'), ('estrategia'), ('seguridad-accesos');

create table public.office_tasks (
  id uuid primary key default gen_random_uuid(),
  department_id text not null references public.office_departments(id),
  objective text not null check (length(btrim(objective)) between 1 and 4000),
  expected_delivery text not null check (length(btrim(expected_delivery)) between 1 and 4000),
  priority text not null check (priority in ('baja','media','alta')),
  status text not null check (status in ('pendiente','en_curso','en_revision','completado','cancelado')),
  due_at timestamptz,
  time_zone text not null,
  assignee_worker_id uuid references public.workers(id),
  assignee_role text check (assignee_role in ('atlas','departamento')),
  check (num_nonnulls(assignee_worker_id, assignee_role) <= 1),
  created_by uuid not null references public.workers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create index office_tasks_department_update on public.office_tasks(department_id,updated_at desc);

create table public.office_versions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.office_tasks(id),
  deliverable_id uuid not null,
  version integer not null check (version > 0),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 32000),
  file_name text check (length(file_name) between 1 and 180),
  file_type text check (file_type in ('application/pdf','image/png','image/jpeg','image/webp','text/plain')),
  file_size integer check (file_size between 1 and 2097152),
  file_bytes bytea,
  check (num_nonnulls(file_name,file_type,file_size,file_bytes) in (0,4)),
  check (file_size = octet_length(file_bytes)),
  check (length(btrim(body)) > 0 or file_bytes is not null),
  status text not null default 'pendiente' check (status in ('pendiente','aprobado','cambios','rechazado')),
  review_note text check (length(review_note) <= 4000),
  reviewed_by uuid references public.workers(id),
  reviewed_at timestamptz,
  created_by uuid not null references public.workers(id),
  created_at timestamptz not null default now(),
  unique (deliverable_id,version)
);
create index office_versions_task on public.office_versions(task_id,created_at desc);

create table public.office_events (
  id uuid primary key default gen_random_uuid(),
  department_id text not null references public.office_departments(id),
  previous_department_id text references public.office_departments(id),
  task_id uuid references public.office_tasks(id),
  actor_id uuid not null references public.workers(id),
  kind text not null, note text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index office_events_task on public.office_events(task_id,created_at desc);
create table public.office_requests (
  actor_id uuid not null references public.workers(id),
  request_id uuid not null, fingerprint bytea not null check (octet_length(fingerprint)=32), result_id text,
  primary key(actor_id,request_id)
);

alter table public.office_departments enable row level security;
alter table public.office_tasks enable row level security;
alter table public.office_versions enable row level security;
alter table public.office_events enable row level security;
alter table public.office_requests enable row level security;
-- Supabase may grant ALL to the service role when a public table is created.
revoke all on public.office_departments,public.office_tasks,public.office_versions,public.office_events,public.office_requests from public,anon,authenticated,service_role;
grant select,update on public.office_departments to service_role;
grant select,insert,update on public.office_tasks to service_role;
grant select,insert on public.office_versions,public.office_requests,public.office_events to service_role;
grant update(status,review_note,reviewed_by,reviewed_at) on public.office_versions to service_role;
grant update(result_id) on public.office_requests to service_role;

create function public.office_actor(p_user uuid) returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid;
begin
  select id into actor from public.workers where user_id = p_user and is_active is not false;
  if actor is null or public.tc_has_admin_access(p_user) is not true then
    raise exception 'OFFICE_FORBIDDEN';
  end if;
  return actor;
end $$;

create function public.office_snapshot(p_user uuid) returns jsonb
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
      select id,task_id,deliverable_id,version,title,body,file_name,file_type,file_size,status,review_note,reviewed_by,reviewed_at,created_by,created_at
      from public.office_versions) v),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,id) from (
      select id,department_id,previous_department_id,task_id,actor_id,kind,note,created_at from public.office_events) e),'[]')
  );
end $$;

create function public.office_file(p_user uuid,p_version uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.office_actor(p_user);
  return (select jsonb_build_object('name',file_name,'type',file_type,'base64',encode(file_bytes,'base64'))
    from public.office_versions where id=p_version and file_bytes is not null);
end $$;

create function public.office_apply(p_user uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := public.office_actor(p_user);
  req uuid := (p_input->>'request_id')::uuid;
  action_name text := p_input->>'action';
  fingerprint_value bytea := sha256(convert_to(p_input::text,'UTF8'));
  receipt public.office_requests;
  old_task public.office_tasks;
  task public.office_tasks;
  dept public.office_departments;
  version_row record;
  task_id_value uuid;
  department text := p_input->>'department_id';
  role_worker uuid; group_id uuid; version_number integer;
  result text; event_note text; details jsonb := '{}'; attachment bytea;
  previous_department text; changed_fields text; lead_name text;
begin
  -- The insert waits for a concurrent retry. Changes, audit and receipt commit together.
  insert into public.office_requests(actor_id,request_id,fingerprint) values (actor,req,fingerprint_value)
    on conflict(actor_id,request_id) do nothing;
  select * into strict receipt from public.office_requests where actor_id=actor and request_id=req for update;
  if receipt.fingerprint <> fingerprint_value then raise exception 'OFFICE_CONFLICT'; end if;
  if receipt.result_id is not null then return jsonb_build_object('id',receipt.result_id); end if;

  if action_name in ('create_task','update_task') then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_input->>'time_zone') then
      raise exception 'OFFICE_INVALID';
    end if;
    if action_name='update_task' then
      select * into old_task from public.office_tasks where id=(p_input->>'id')::uuid for update;
      if old_task.id is null then raise exception 'OFFICE_NOT_FOUND'; end if;
      if old_task.revision is distinct from (p_input->>'revision')::integer then raise exception 'OFFICE_CONFLICT'; end if;
    end if;
    role_worker := (p_input->>'assignee_worker_id')::uuid;
    if role_worker is not null and role_worker is distinct from old_task.assignee_worker_id and not exists
      (select 1 from public.workers where id=role_worker and is_active is not false) then raise exception 'OFFICE_INVALID'; end if;
    if action_name='create_task' then
      insert into public.office_tasks(department_id,objective,expected_delivery,priority,status,due_at,time_zone,assignee_worker_id,assignee_role,created_by)
      values(department,btrim(p_input->>'objective'),btrim(p_input->>'expected_delivery'),p_input->>'priority',p_input->>'status',
        (p_input->>'due_at')::timestamptz,p_input->>'time_zone',role_worker,p_input->>'assignee_role',actor) returning * into task;
      event_note := 'Se creó el encargo «' || left(task.objective,100) || '».';
    else
      update public.office_tasks set department_id=department,objective=btrim(p_input->>'objective'),
        expected_delivery=btrim(p_input->>'expected_delivery'),priority=p_input->>'priority',status=p_input->>'status',
        due_at=(p_input->>'due_at')::timestamptz,time_zone=p_input->>'time_zone',assignee_worker_id=role_worker,
        assignee_role=p_input->>'assignee_role',revision=revision+1,updated_at=now() where id=old_task.id returning * into task;
      -- Keep one audit event visible in both department histories after a move.
      if old_task.department_id <> task.department_id then previous_department := old_task.department_id; end if;
      changed_fields := concat_ws(', ',
        case when previous_department is not null then 'departamento (' || previous_department || ' → ' || task.department_id || ')' end,
        case when old_task.objective <> task.objective then 'objetivo' end,
        case when old_task.expected_delivery <> task.expected_delivery then 'entrega esperada' end,
        case when old_task.priority <> task.priority then 'prioridad (' || task.priority || ')' end,
        case when old_task.status <> task.status then 'estado (' || replace(task.status,'_',' ') || ')' end,
        case when old_task.due_at is distinct from task.due_at or old_task.time_zone <> task.time_zone then 'plazo' end,
        case when (old_task.assignee_worker_id,old_task.assignee_role) is distinct from (task.assignee_worker_id,task.assignee_role) then 'responsable' end);
      event_note := '«' || left(task.objective,100) || '» · ' || coalesce(nullif(changed_fields,''),'guardado sin cambios de contenido') || '.';
    end if;
    task_id_value := task.id; result := task.id::text;
    details := jsonb_build_object('previous',to_jsonb(old_task),'current',to_jsonb(task));
  elsif action_name='set_lead' then
    select * into dept from public.office_departments where id=department for update;
    if dept.id is null then raise exception 'OFFICE_NOT_FOUND'; end if;
    if dept.revision is distinct from (p_input->>'revision')::integer then raise exception 'OFFICE_CONFLICT'; end if;
    role_worker := (p_input->>'lead_worker_id')::uuid;
    if role_worker is not null and not exists (select 1 from public.workers where id=role_worker and is_active is not false) then
      raise exception 'OFFICE_INVALID'; end if;
    update public.office_departments set lead_worker_id=role_worker,revision=revision+1 where id=department;
    select coalesce(nullif(btrim(display_name),''),'personal del equipo') into lead_name from public.workers where id=role_worker;
    event_note := case when role_worker is null then 'El departamento quedó sin responsable.' else 'Se asignó la responsabilidad a ' || lead_name || '.' end;
    result := department;
    details := jsonb_build_object('previous',dept.lead_worker_id,'current',role_worker);
  elsif action_name in ('add_note','add_version','review_version') then
    if action_name='review_version' then
      select task_id into task_id_value from public.office_versions where id=(p_input->>'id')::uuid;
    else
      task_id_value := (p_input->>'task_id')::uuid;
    end if;
    select * into task from public.office_tasks where id=task_id_value for update;
    if task.id is null then raise exception 'OFFICE_NOT_FOUND'; end if;
    department := task.department_id;
    if action_name='add_note' then
      event_note := btrim(p_input->>'note');
      if event_note is null or length(event_note) not between 1 and 4000 then raise exception 'OFFICE_INVALID'; end if;
      result := task.id::text;
    elsif action_name='add_version' then
      group_id := (p_input->>'deliverable_id')::uuid;
      if group_id is null then
        group_id := gen_random_uuid(); version_number := 0;
      else
        select max(v.version) into version_number from public.office_versions v where v.task_id=task.id and v.deliverable_id=group_id;
        if version_number is null then raise exception 'OFFICE_NOT_FOUND'; end if;
      end if;
      if version_number is distinct from (p_input->>'base_version')::integer then raise exception 'OFFICE_CONFLICT'; end if;
      attachment := decode(p_input->>'file_base64','base64');
      insert into public.office_versions(task_id,deliverable_id,version,title,body,file_name,file_type,file_size,file_bytes,created_by)
      values(task.id,group_id,version_number+1,btrim(p_input->>'title'),coalesce(p_input->>'body',''),
        p_input->>'file_name',p_input->>'file_type',octet_length(attachment),attachment,actor) returning id,title,version into version_row;
      result := version_row.id::text; event_note := 'Se registró «' || version_row.title || '» (v' || version_row.version || ').';
      details := jsonb_build_object('version_id',result,'deliverable_id',group_id,'version',version_row.version);
    else
      select id,title,version,deliverable_id,status into strict version_row from public.office_versions where id=(p_input->>'id')::uuid;
      if version_row.status <> 'pendiente' or exists (select 1 from public.office_versions v
        where v.deliverable_id=version_row.deliverable_id and v.version>version_row.version) then raise exception 'OFFICE_CONFLICT'; end if;
      if p_input->>'decision' is null or p_input->>'decision' not in ('aprobado','cambios','rechazado') then raise exception 'OFFICE_INVALID'; end if;
      update public.office_versions set status=p_input->>'decision', review_note=btrim(coalesce(p_input->>'note','')),
        reviewed_by=actor,reviewed_at=now() where id=version_row.id;
      result := version_row.id::text; event_note := '«' || version_row.title || '» (v' || version_row.version || ') · ' ||
        case p_input->>'decision' when 'aprobado' then 'aprobado' when 'cambios' then 'cambios solicitados' else 'rechazado' end || '.';
      details := jsonb_build_object('version_id',result,'decision',p_input->>'decision','note',p_input->>'note');
    end if;
  else raise exception 'OFFICE_INVALID';
  end if;
  insert into public.office_events(department_id,previous_department_id,task_id,actor_id,kind,note,details)
    values (department,previous_department,task_id_value,actor,action_name,event_note,details);
  update public.office_requests set result_id=result where actor_id=actor and request_id=req;
  return jsonb_build_object('id',result);
end $$;

revoke all on function public.office_actor(uuid),public.office_snapshot(uuid),public.office_file(uuid,uuid),public.office_apply(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.office_actor(uuid),public.office_snapshot(uuid),public.office_file(uuid,uuid),public.office_apply(uuid,jsonb) to service_role;
commit;
