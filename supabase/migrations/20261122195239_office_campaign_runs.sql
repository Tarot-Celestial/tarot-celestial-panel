begin;

create table public.office_promotion_scopes (
  promotion_id uuid not null references public.tc_client_promotions(id) on delete cascade,
  market text not null check (length(trim(market)) between 1 and 120),
  currency text not null check (currency in ('EUR','USD')),
  channel text not null check (length(trim(channel)) between 1 and 80),
  enabled boolean not null, source_fingerprint text not null,
  approved_by uuid not null references public.workers(id), approved_at timestamptz not null default now(),
  primary key(promotion_id,market,currency,channel)
);
create table public.office_runs (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.office_tasks(id),
  task_revision integer not null, actor_id uuid not null references public.workers(id), actor_user_id uuid not null,
  request_id uuid not null, revision_id uuid references public.office_versions(id), unique(actor_id,request_id),
  status text not null default 'queued' check (status in ('queued','running','review','waiting_input','waiting_connection',
    'failed','cancelled','limit_reached','needs_reconciliation')),
  step integer not null default 0 check (step between 0 and 2),
  lease_token uuid, lease_until timestamptz, outputs jsonb not null default '{}',
  task_snapshot jsonb not null, source_snapshot jsonb, usage jsonb not null default '{}',
  result_version_id uuid references public.office_versions(id),last_error text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index office_runs_task_date on public.office_runs(task_id,created_at desc);
create index office_runs_queue on public.office_runs(created_at) where status='queued';
create unique index office_runs_single_active_task on public.office_runs(task_id)
  where status in ('queued','running','needs_reconciliation');
create table public.office_run_attempts (
  lease_token uuid primary key, run_id uuid not null references public.office_runs(id),
  step integer not null check(step between 0 and 2), claimed_at timestamptz not null default now(),
  finished_at timestamptz, outcome text, usage jsonb, receipt jsonb,
  unique(run_id,step)
);
create index office_run_attempts_claimed on public.office_run_attempts(claimed_at);

alter table public.office_promotion_scopes enable row level security;
alter table public.office_runs enable row level security;
alter table public.office_run_attempts enable row level security;
revoke all on public.office_promotion_scopes,public.office_runs,public.office_run_attempts from public,anon,authenticated,service_role;
grant select,insert on public.office_promotion_scopes,public.office_runs,public.office_run_attempts to service_role;
grant update(enabled,source_fingerprint,approved_at,approved_by) on public.office_promotion_scopes to service_role;
grant update(status,step,lease_token,lease_until,outputs,source_snapshot,usage,result_version_id,last_error,updated_at)
  on public.office_runs to service_role;
grant update(finished_at,outcome,usage,receipt) on public.office_run_attempts to service_role;

-- An approval covers this exact public offer and the active packs in the named currency.
-- Editing the catalog invalidates the approval without modifying promotions or checkouts.
create function public.office_promotion_fingerprint(p_promotion_id uuid,p_currency text) returns text
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select encode(sha256(convert_to(jsonb_build_array(
    p.id,p.name,p.subtitle,p.description,p.status,p.starts_at,p.ends_at,p.active_until_disabled,p.updated_at,
    p.promotion_kind,p.authorized_rank,p.max_uses_per_client,p.benefit_revision,
    k.packs)::text,'UTF8')),'hex')
  from public.tc_client_promotions p cross join lateral (
    select jsonb_agg(jsonb_build_array(k.id,k.name,k.description,k.price,k.regular_price,k.currency,k.paid_minutes,
      k.free_minutes,k.extra_benefit,k.is_active,k.updated_at) order by k.id) packs from public.tc_client_promotion_packages k
    where k.promotion_id=p.id and k.currency=upper(trim(p_currency)) and k.is_active
  ) k where p.id=p_promotion_id and p.promotion_kind='standard' and p.status in ('active','scheduled')
    and (p.starts_at is null or p.starts_at<=now())
    and (p.active_until_disabled or p.ends_at is null or p.ends_at>now()) and k.packs is not null
$$;

create function public.office_promotion_scope_set(p_actor uuid,p_promotion_id uuid,p_market text,p_currency text,p_channel text,p_enabled boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); signature text; audit_note text;
begin
  if p_enabled is null or p_market is null or p_channel is null or p_currency is null
    or length(trim(p_market)) not between 1 and 120 or length(trim(p_channel)) not between 1 and 80
    or upper(trim(p_currency)) not in ('EUR','USD') then raise exception 'OFFICE_INVALID'; end if;
  if not p_enabled then
    update public.office_promotion_scopes set enabled=false,approved_at=now(),approved_by=actor where promotion_id=p_promotion_id
      and market=lower(trim(p_market)) and channel=lower(trim(p_channel)) and currency=upper(trim(p_currency));
    if not found then return false; end if;
    audit_note:='Se retiró el alcance comercial de la promoción.';
  else
    signature:=public.office_promotion_fingerprint(p_promotion_id,p_currency);
    if signature is null then raise exception 'OFFICE_OFFER_UNAVAILABLE'; end if;
    insert into public.office_promotion_scopes(promotion_id,market,currency,channel,enabled,source_fingerprint,approved_by)
      values(p_promotion_id,lower(trim(p_market)),upper(trim(p_currency)),lower(trim(p_channel)),true,signature,actor)
      on conflict(promotion_id,market,currency,channel) do update set enabled=true,source_fingerprint=excluded.source_fingerprint,
        approved_at=now(),approved_by=excluded.approved_by;
    audit_note:='Se aprobó el alcance comercial de la promoción.';
  end if;
  insert into public.office_events(department_id,actor_id,kind,note,details)
    values('marketing',actor,'promotion_scope',audit_note,jsonb_build_object('promotion_id',p_promotion_id,'market',lower(trim(p_market)),
      'currency',upper(trim(p_currency)),'channel',lower(trim(p_channel)),'enabled',p_enabled,'source_fingerprint',signature));
  return p_enabled;
end $$;

create function public.office_promotion_scope_live(p_promotion_id uuid,p_market text,p_currency text,p_channel text)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.office_promotion_scopes s where s.promotion_id=p_promotion_id and s.enabled
    and s.market=lower(trim(p_market)) and s.currency=upper(trim(p_currency)) and s.channel=lower(trim(p_channel))
    and s.source_fingerprint=public.office_promotion_fingerprint(p_promotion_id,p_currency))
$$;

create function public.office_run_enqueue(p_actor uuid,p_task_id uuid,p_request_id uuid,p_revision_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); task public.office_tasks; existing public.office_runs; version_row record; rid uuid;
begin
  if p_request_id is null then raise exception 'OFFICE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  select * into existing from public.office_runs where actor_id=actor and request_id=p_request_id;
  if found then
    if existing.task_id is distinct from p_task_id or existing.revision_id is distinct from p_revision_id then raise exception 'OFFICE_CONFLICT'; end if;
    return existing.id;
  end if;
  select * into task from public.office_tasks where id=p_task_id for update;
  if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
  if task.status='cancelado' then raise exception 'OFFICE_CONFLICT'; end if;
  if exists(select 1 from public.office_runs where task_id=task.id and status in ('queued','running','needs_reconciliation')) then
    raise exception 'OFFICE_RUN_ACTIVE'; end if;
  if p_revision_id is null then
    if exists(select 1 from public.office_runs where task_id=task.id and status='review') then raise exception 'OFFICE_RUN_ALREADY_DELIVERED'; end if;
  else
    select id,deliverable_id,version,status into version_row from public.office_versions where id=p_revision_id and task_id=task.id;
    if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
    if version_row.status<>'cambios' or exists(select 1 from public.office_versions v
      where v.deliverable_id=version_row.deliverable_id and v.version>version_row.version) then raise exception 'OFFICE_CONFLICT'; end if;
  end if;
  insert into public.office_runs(task_id,task_revision,actor_id,actor_user_id,request_id,revision_id,task_snapshot)
    values(task.id,task.revision,actor,p_actor,p_request_id,p_revision_id,
      jsonb_build_object('objective',task.objective,'expected_delivery',task.expected_delivery,'department_id',task.department_id,
        'time_zone',task.time_zone,'due_at',task.due_at)) returning id into rid;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values(task.department_id,task.id,actor,'campaign_enqueued','Se encargó el borrador de campaña a Atlas.',jsonb_build_object('run_id',rid,'revision_id',p_revision_id));
  return rid;
end $$;

create function public.office_run_claim(p_run_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.office_runs; token uuid; claims integer; day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  -- Serialize the short budget reservation; remote provider calls happen outside this transaction.
  perform pg_advisory_xact_lock(hashtextextended('office-campaign-claims',0));
  update public.office_runs set status='needs_reconciliation',last_error='El intento anterior perdió su confirmación. Requiere revisión antes de repetir.',
    updated_at=now() where status='running' and lease_until<=clock_timestamp();
  if (select count(*) from public.office_runs where lease_token is not null and lease_until>clock_timestamp())>=2 then return null; end if;
  select * into job from public.office_runs where status='queued' and (p_run_id is null or id=p_run_id)
    order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  if public.tc_has_admin_access(job.actor_user_id) is not true then
    update public.office_runs set status='failed',last_error='El acceso de administración ha caducado.',updated_at=now() where id=job.id;
    return null;
  end if;
  if not exists(select 1 from public.office_tasks where id=job.task_id and revision=job.task_revision and status<>'cancelado') then
    update public.office_runs set status='waiting_input',last_error='El encargo cambió. Revisa los datos y vuelve a iniciarlo.',updated_at=now() where id=job.id;
    return null;
  end if;
  claims:=coalesce((job.usage->>'claims')::integer,0);
  if claims>=3 or now()-job.created_at>interval '30 minutes'
    or (job.step<2 and (select coalesce(sum(greatest(0.10,coalesce((usage->>'cost_usd')::numeric,0),
      coalesce((usage->>'estimated_cost_usd')::numeric,0))),0) from public.office_run_attempts where step<2 and claimed_at>=day_start)+0.10>2.40) then
    update public.office_runs set status='limit_reached',last_error='Se alcanzó un límite de ejecución o de presupuesto de la Oficina.',updated_at=now() where id=job.id;
    return null;
  end if;
  token:=gen_random_uuid();
  insert into public.office_run_attempts(lease_token,run_id,step) values(token,job.id,job.step);
  update public.office_runs set status='running',lease_token=token,lease_until=clock_timestamp()+interval '150 seconds',
    usage=usage||jsonb_build_object('claims',claims+1,'reserved_usd',least(claims+1,2)*0.10),updated_at=now() where id=job.id returning * into job;
  return to_jsonb(job);
end $$;

create function public.office_run_finish_step(p_run_id uuid,p_lease_token uuid,p_status text,p_output jsonb,
  p_usage jsonb,p_error text,p_delivery jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.office_runs; attempt public.office_run_attempts; task public.office_tasks;
  result_status text:=p_status; result_error text:=left(p_error,600); result_version uuid; previous record;
  combined jsonb; field text; amount numeric; snapshot jsonb; payload jsonb; response_json jsonb; next_step integer;
  highest_cost numeric; event_note text; stored_outputs jsonb;
begin
  if p_status is null or p_status not in ('ok','waiting_input','waiting_connection','failed','limit_reached','needs_reconciliation') then
    raise exception 'OFFICE_INVALID'; end if;
  if coalesce(jsonb_typeof(p_usage),'object') not in ('object','null') or octet_length(coalesce(p_usage::text,''))>8192 then raise exception 'OFFICE_INVALID'; end if;
  select * into job from public.office_runs where id=p_run_id for update;
  if not found then return null; end if;
  select * into attempt from public.office_run_attempts where lease_token=p_lease_token and run_id=job.id for update;
  if not found then return null; end if;
  if attempt.finished_at is not null then return attempt.receipt; end if;
  if job.lease_token is distinct from p_lease_token or job.step<>attempt.step then return null; end if;

  combined:=job.usage;
  foreach field in array array['input_tokens','output_tokens','cost_usd','estimated_cost_usd'] loop
    if jsonb_typeof(p_usage->field)='number' then
      amount:=(p_usage->>field)::numeric;
      if amount<0 or (field in ('input_tokens','output_tokens') and amount<>trunc(amount)) then raise exception 'OFFICE_INVALID'; end if;
      combined:=combined||jsonb_build_object(field,coalesce((combined->>field)::numeric,0)+amount);
    end if;
  end loop;
  next_step:=job.step; snapshot:=job.source_snapshot; stored_outputs:=job.outputs;
  select * into task from public.office_tasks where id=job.task_id for update;
  -- Cancellation while an HTTP request is in flight accepts its real usage but discards its output.
  if job.status='cancelled' then result_status:='cancelled'; result_error:='Ejecución cancelada.';
  elsif job.status='needs_reconciliation' or job.lease_until<=clock_timestamp() then
    result_status:='needs_reconciliation'; result_error:='El intento perdió su confirmación. Revisa el consumo antes de repetir.';
  elsif job.status<>'running' then return null;
  elsif public.tc_has_admin_access(job.actor_user_id) is not true then result_status:='failed'; result_error:='El acceso de administración ha caducado.';
  elsif task.revision<>job.task_revision or task.status='cancelado' then
    result_status:='waiting_input'; result_error:='El encargo cambió durante la ejecución. Revisa los datos antes de volver a iniciarlo.';
  end if;
  if result_status='ok' then
    highest_cost:=greatest(coalesce((p_usage->>'cost_usd')::numeric,0),coalesce((p_usage->>'estimated_cost_usd')::numeric,0));
    if highest_cost>0.10 then
      result_status:='limit_reached'; result_error:='Se alcanzó el presupuesto asignado a este paso.';
    elsif p_output is null or jsonb_typeof(p_output)<>'object' or octet_length(p_output::text)>131072 then
      result_status:='failed'; result_error:='El resultado del agente no cumple el formato de la Oficina.';
    elsif job.step=0 then
      if jsonb_typeof(p_output->'source_snapshot') is distinct from 'object' then
        result_status:='waiting_input'; result_error:='Faltan las fuentes del briefing.';
      else snapshot:=p_output->'source_snapshot'; end if;
    end if;
  end if;
  if result_status='ok' and snapshot->>'promotion_id' is not null and (
    not public.office_promotion_scope_live((snapshot->>'promotion_id')::uuid,snapshot->>'market',snapshot->>'currency',snapshot->>'channel')
    or snapshot#>>'{offer,source_fingerprint}' is distinct from public.office_promotion_fingerprint((snapshot->>'promotion_id')::uuid,snapshot->>'currency')) then
    result_status:='waiting_input'; result_error:='La oferta cambió o requiere aprobación para este mercado, moneda y canal.';
  end if;
  if result_status='ok' and job.step=2 then
    if p_delivery is null or jsonb_typeof(p_delivery)<>'object' or octet_length(p_delivery::text)>3145728
      or nullif(trim(p_delivery->>'title'),'') is null then
      result_status:='failed'; result_error:='Falta una entrega válida para revisión.';
    else
      -- Only the revision requested by the administrator can receive the new version.
      if job.revision_id is not null then
        select deliverable_id,version,status into strict previous from public.office_versions where id=job.revision_id;
        if previous.status<>'cambios' or exists(select 1 from public.office_versions v
          where v.deliverable_id=previous.deliverable_id and v.version>previous.version) then
          result_status:='waiting_input'; result_error:='La versión pendiente de corrección ha cambiado.';
        end if;
        payload:=jsonb_build_object('deliverable_id',previous.deliverable_id,'base_version',previous.version);
      else payload:=jsonb_build_object('deliverable_id',null,'base_version',0);
      end if;
      if result_status='ok' then
        payload:=p_delivery || payload || jsonb_build_object('action','add_version','request_id',job.id,'task_id',job.task_id);
        begin
          result_version:=(public.office_apply(job.actor_user_id,payload)->>'id')::uuid;
          result_status:='review';
        exception when check_violation or not_null_violation or data_exception then
          result_status:='failed'; result_error:='El archivo o el texto generado no cumple los límites de Oficina.';
        end;
      end if;
    end if;
  elsif result_status='ok' then next_step:=next_step+1; result_status:='queued';
  end if;
  if result_status in ('queued','review') then stored_outputs:=stored_outputs||jsonb_build_object(job.step::text,p_output); end if;
  update public.office_runs set status=result_status,step=next_step,outputs=stored_outputs,source_snapshot=snapshot,
    usage=combined,last_error=result_error,result_version_id=result_version,lease_token=null,lease_until=null,updated_at=now()
    where id=job.id;
  response_json:=jsonb_build_object('id',job.id,'status',result_status,'step',next_step,'result_version_id',result_version);
  update public.office_run_attempts set finished_at=now(),outcome=result_status,usage=coalesce(p_usage,'{}'),receipt=response_json
    where lease_token=p_lease_token;
  event_note:=case when result_status='review' then 'Contenido entregó una nueva versión para revisión.'
    when result_status='queued' and job.step=0 then 'Atlas entregó el briefing a Marketing.'
    when result_status='queued' then 'Marketing entregó el texto a Creación de contenido.'
    else coalesce(result_error,'La ejecución requiere revisión.') end;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values(task.department_id,task.id,job.actor_id,'campaign_step',event_note,jsonb_build_object('run_id',job.id,
      'step',job.step,'status',result_status,'version_id',result_version));
  return response_json;
end $$;

create function public.office_run_cancel(p_actor uuid,p_run_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor);job public.office_runs;department text;
begin
  select * into job from public.office_runs where id=p_run_id for update;
  if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
  if job.status='cancelled' then return true; end if;
  if job.status not in ('queued','running','waiting_input','waiting_connection') then raise exception 'OFFICE_CONFLICT'; end if;
  update public.office_runs set status='cancelled',last_error='Ejecución cancelada por administración.',updated_at=now() where id=job.id;
  select department_id into department from public.office_tasks where id=job.task_id;
  insert into public.office_events(department_id,task_id,actor_id,kind,note,details)
    values(department,job.task_id,actor,'campaign_cancelled','Administración canceló la ejecución.',jsonb_build_object('run_id',job.id));
  return true;
end $$;

revoke all on function public.office_promotion_fingerprint(uuid,text),public.office_promotion_scope_live(uuid,text,text,text),
  public.office_promotion_scope_set(uuid,uuid,text,text,text,boolean),public.office_run_enqueue(uuid,uuid,uuid,uuid),
  public.office_run_claim(uuid),public.office_run_finish_step(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.office_run_cancel(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.office_promotion_fingerprint(uuid,text),public.office_promotion_scope_live(uuid,text,text,text),
  public.office_promotion_scope_set(uuid,uuid,text,text,text,boolean),public.office_run_enqueue(uuid,uuid,uuid,uuid),
  public.office_run_claim(uuid),public.office_run_finish_step(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.office_run_cancel(uuid,uuid)
  to service_role;
commit;
