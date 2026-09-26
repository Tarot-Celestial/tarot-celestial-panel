-- Tarot Celestial · Sistema profesional de incidencias de jornada
-- Migración aplicada en Supabase. Fuente única: incidencias + recuperaciones + justificaciones + auditoría.

create extension if not exists pgcrypto;

create table if not exists public.attendance_incident_settings (
  id smallint primary key default 1 check (id = 1),
  allow_central_justify boolean not null default true,
  require_notes boolean not null default true,
  notify_worker boolean not null default true,
  show_in_invoice boolean not null default true,
  allow_partial_recovery boolean not null default true,
  reasons text[] not null default array[
    'Problema de internet','Problema eléctrico','Enfermedad','Emergencia personal',
    'No se presentó','Abandono anticipado del turno','Llegada tarde','Salida anticipada',
    'Incidencia técnica','Otro'
  ]::text[],
  updated_by uuid null references public.workers(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.attendance_incident_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.attendance_incidents (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  invoice_month text not null check (invoice_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  incident_date date not null,
  scheduled_start time null,
  scheduled_end time null,
  missed_start time not null,
  missed_end time not null,
  missed_minutes integer not null check (missed_minutes > 0 and missed_minutes <= 1440),
  reason_code text not null,
  reason_detail text null,
  notes text null,
  created_by uuid null references public.workers(id) on delete set null,
  closed_at timestamptz null,
  closed_by uuid null references public.workers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists attendance_incidents_worker_month_idx on public.attendance_incidents(worker_id, invoice_month, incident_date desc);
create index if not exists attendance_incidents_month_idx on public.attendance_incidents(invoice_month, incident_date desc);

create table if not exists public.attendance_incident_recoveries (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.attendance_incidents(id) on delete cascade,
  recovery_date date not null,
  start_time time not null,
  end_time time not null,
  recovered_minutes integer not null check (recovered_minutes > 0 and recovered_minutes <= 1440),
  notes text null,
  created_by uuid null references public.workers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_incident_recoveries_incident_idx on public.attendance_incident_recoveries(incident_id, recovery_date, created_at);

create table if not exists public.attendance_incident_justifications (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.attendance_incidents(id) on delete cascade,
  justified_minutes integer not null check (justified_minutes > 0 and justified_minutes <= 1440),
  reason text not null,
  created_by uuid null references public.workers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_incident_justifications_incident_idx on public.attendance_incident_justifications(incident_id, created_at);

create table if not exists public.attendance_incident_audit (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.attendance_incidents(id) on delete cascade,
  action text not null check (action in ('created','edited','recovery_added','hours_justified','closed','reopened')),
  actor_id uuid null references public.workers(id) on delete set null,
  actor_role text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attendance_incident_audit_incident_idx on public.attendance_incident_audit(incident_id, created_at desc);

create or replace function public.tc_attendance_minutes_between(p_start time, p_end time)
returns integer language sql immutable as $$
  select greatest(1, round(extract(epoch from (
    case when p_end > p_start then p_end - p_start
         else (p_end + interval '24 hours') - p_start end
  )) / 60.0)::integer);
$$;

create or replace view public.v_attendance_incidents as
select
  i.*,
  w.display_name as worker_name,
  w.role as worker_role,
  w.team as worker_team,
  coalesce(w.user_id, w.auth_user_id) as worker_user_id,
  creator.display_name as created_by_name,
  coalesce(r.recovered_minutes,0)::integer as recovered_minutes,
  coalesce(j.justified_minutes,0)::integer as justified_minutes,
  greatest(0,i.missed_minutes-coalesce(r.recovered_minutes,0)-coalesce(j.justified_minutes,0))::integer as pending_minutes,
  case
    when i.closed_at is not null then 'closed'
    when greatest(0,i.missed_minutes-coalesce(r.recovered_minutes,0)-coalesce(j.justified_minutes,0))=0
      and coalesce(j.justified_minutes,0)>=i.missed_minutes then 'justified'
    when greatest(0,i.missed_minutes-coalesce(r.recovered_minutes,0)-coalesce(j.justified_minutes,0))=0 then 'recovered'
    when coalesce(r.recovered_minutes,0)>0 or coalesce(j.justified_minutes,0)>0 then 'partial'
    else 'pending'
  end as status
from public.attendance_incidents i
join public.workers w on w.id=i.worker_id
left join public.workers creator on creator.id=i.created_by
left join lateral (
  select coalesce(sum(recovered_minutes),0) recovered_minutes
  from public.attendance_incident_recoveries rr where rr.incident_id=i.id
) r on true
left join lateral (
  select coalesce(sum(justified_minutes),0) justified_minutes
  from public.attendance_incident_justifications jj where jj.incident_id=i.id
) j on true;

create or replace function public.attendance_create_incident(
  p_worker_id uuid,p_incident_date date,p_missed_start time,p_missed_end time,
  p_reason_code text,p_reason_detail text,p_notes text,p_created_by uuid,
  p_scheduled_start time default null,p_scheduled_end time default null
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid; v_minutes integer; v_month text; v_actor_role text; v_user_id uuid; v_notify boolean;
begin
  if p_worker_id is null or p_incident_date is null or p_missed_start is null or p_missed_end is null then raise exception 'Datos de incidencia incompletos'; end if;
  if coalesce(trim(p_reason_code),'')='' then raise exception 'Motivo obligatorio'; end if;
  v_minutes:=public.tc_attendance_minutes_between(p_missed_start,p_missed_end);
  v_month:=to_char(p_incident_date,'YYYY-MM');
  select role into v_actor_role from public.workers where id=p_created_by;
  select coalesce(user_id,auth_user_id) into v_user_id from public.workers where id=p_worker_id;
  select notify_worker into v_notify from public.attendance_incident_settings where id=1;

  insert into public.attendance_incidents(
    worker_id,invoice_month,incident_date,scheduled_start,scheduled_end,
    missed_start,missed_end,missed_minutes,reason_code,reason_detail,notes,created_by
  ) values (
    p_worker_id,v_month,p_incident_date,p_scheduled_start,p_scheduled_end,
    p_missed_start,p_missed_end,v_minutes,trim(p_reason_code),
    nullif(trim(coalesce(p_reason_detail,'')),''),nullif(trim(coalesce(p_notes,'')),''),p_created_by
  ) returning id into v_id;

  insert into public.attendance_incident_audit(incident_id,action,actor_id,actor_role,after_data)
  values(v_id,'created',p_created_by,v_actor_role,jsonb_build_object('missed_minutes',v_minutes,'reason_code',p_reason_code,'incident_date',p_incident_date));

  if coalesce(v_notify,true) and v_user_id is not null then
    insert into public.notifications(user_id,title,message,type,meta)
    values(
      v_user_id,'Nueva incidencia de jornada',
      format('Se han registrado %s min pendientes correspondientes al %s. Horario: %s → %s. Motivo: %s.',
        v_minutes,to_char(p_incident_date,'DD/MM/YYYY'),p_missed_start::text,p_missed_end::text,p_reason_code),
      'attendance_incident',
      jsonb_build_object('incident_id',v_id,'invoice_month',v_month,'pending_minutes',v_minutes,'action_path','/panel-tarotista?tab=facturas')
    );
  end if;
  return v_id;
end $$;

create or replace function public.attendance_add_recovery(
  p_incident_id uuid,p_recovery_date date,p_start_time time,p_end_time time,p_notes text,p_created_by uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_inc public.v_attendance_incidents%rowtype; v_minutes integer; v_actor_role text;
  v_user_id uuid; v_notify boolean; v_pending integer;
begin
  select * into v_inc from public.v_attendance_incidents where id=p_incident_id;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if v_inc.closed_at is not null then raise exception 'La incidencia está cerrada'; end if;
  v_minutes:=public.tc_attendance_minutes_between(p_start_time,p_end_time);
  if v_minutes>v_inc.pending_minutes then raise exception 'Esta incidencia solo tiene % min pendientes',v_inc.pending_minutes; end if;

  insert into public.attendance_incident_recoveries(incident_id,recovery_date,start_time,end_time,recovered_minutes,notes,created_by)
  values(p_incident_id,p_recovery_date,p_start_time,p_end_time,v_minutes,nullif(trim(coalesce(p_notes,'')),''),p_created_by);
  update public.attendance_incidents set updated_at=now() where id=p_incident_id;

  select role into v_actor_role from public.workers where id=p_created_by;
  insert into public.attendance_incident_audit(incident_id,action,actor_id,actor_role,before_data,after_data)
  values(p_incident_id,'recovery_added',p_created_by,v_actor_role,
    jsonb_build_object('pending_minutes',v_inc.pending_minutes),
    jsonb_build_object('recovered_minutes_added',v_minutes,'recovery_date',p_recovery_date));

  v_pending:=greatest(0,v_inc.pending_minutes-v_minutes);
  select coalesce(user_id,auth_user_id) into v_user_id from public.workers where id=v_inc.worker_id;
  select notify_worker into v_notify from public.attendance_incident_settings where id=1;
  if coalesce(v_notify,true) and v_user_id is not null then
    insert into public.notifications(user_id,title,message,type,meta)
    values(v_user_id,
      case when v_pending=0 then 'Incidencia completada' else 'Recuperación registrada' end,
      case when v_pending=0 then format('Has recuperado completamente las horas pendientes del %s.',to_char(v_inc.incident_date,'DD/MM/YYYY'))
           else format('Se han registrado %s min recuperados. Te quedan %s min pendientes.',v_minutes,v_pending) end,
      'attendance_incident',
      jsonb_build_object('incident_id',p_incident_id,'invoice_month',v_inc.invoice_month,'pending_minutes',v_pending,'recovered_minutes_added',v_minutes,'action_path','/panel-tarotista?tab=facturas'));
  end if;
  return jsonb_build_object('ok',true,'recovered_minutes',v_minutes,'pending_minutes',v_pending);
end $$;

create or replace function public.attendance_add_justification(
  p_incident_id uuid,p_minutes integer,p_reason text,p_created_by uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_inc public.v_attendance_incidents%rowtype; v_actor_role text; v_user_id uuid; v_notify boolean; v_pending integer;
begin
  select * into v_inc from public.v_attendance_incidents where id=p_incident_id;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if v_inc.closed_at is not null then raise exception 'La incidencia está cerrada'; end if;
  if p_minutes is null or p_minutes<=0 or p_minutes>v_inc.pending_minutes then raise exception 'Solo puedes justificar entre 1 y % minutos',v_inc.pending_minutes; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Motivo de justificación obligatorio'; end if;

  insert into public.attendance_incident_justifications(incident_id,justified_minutes,reason,created_by)
  values(p_incident_id,p_minutes,trim(p_reason),p_created_by);
  update public.attendance_incidents set updated_at=now() where id=p_incident_id;

  select role into v_actor_role from public.workers where id=p_created_by;
  insert into public.attendance_incident_audit(incident_id,action,actor_id,actor_role,before_data,after_data)
  values(p_incident_id,'hours_justified',p_created_by,v_actor_role,
    jsonb_build_object('pending_minutes',v_inc.pending_minutes),
    jsonb_build_object('justified_minutes_added',p_minutes,'reason',p_reason));

  v_pending:=greatest(0,v_inc.pending_minutes-p_minutes);
  select coalesce(user_id,auth_user_id) into v_user_id from public.workers where id=v_inc.worker_id;
  select notify_worker into v_notify from public.attendance_incident_settings where id=1;
  if coalesce(v_notify,true) and v_user_id is not null then
    insert into public.notifications(user_id,title,message,type,meta)
    values(v_user_id,'Horas justificadas',
      format('Se han justificado %s min de la incidencia del %s. Pendientes: %s min.',p_minutes,to_char(v_inc.incident_date,'DD/MM/YYYY'),v_pending),
      'attendance_incident',
      jsonb_build_object('incident_id',p_incident_id,'invoice_month',v_inc.invoice_month,'pending_minutes',v_pending,'justified_minutes_added',p_minutes,'action_path','/panel-tarotista?tab=facturas'));
  end if;
  return jsonb_build_object('ok',true,'justified_minutes',p_minutes,'pending_minutes',v_pending);
end $$;

create or replace function public.attendance_close_incident(p_incident_id uuid,p_created_by uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inc public.v_attendance_incidents%rowtype; v_actor_role text;
begin
  select * into v_inc from public.v_attendance_incidents where id=p_incident_id;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if v_inc.pending_minutes>0 then raise exception 'Aún quedan % min pendientes',v_inc.pending_minutes; end if;
  if v_inc.closed_at is not null then return jsonb_build_object('ok',true,'already_closed',true); end if;
  update public.attendance_incidents set closed_at=now(),closed_by=p_created_by,updated_at=now() where id=p_incident_id;
  select role into v_actor_role from public.workers where id=p_created_by;
  insert into public.attendance_incident_audit(incident_id,action,actor_id,actor_role,before_data,after_data)
  values(p_incident_id,'closed',p_created_by,v_actor_role,jsonb_build_object('status',v_inc.status),jsonb_build_object('status','closed'));
  return jsonb_build_object('ok',true);
end $$;

alter table public.attendance_incident_settings enable row level security;
alter table public.attendance_incidents enable row level security;
alter table public.attendance_incident_recoveries enable row level security;
alter table public.attendance_incident_justifications enable row level security;
alter table public.attendance_incident_audit enable row level security;

revoke all on public.attendance_incident_settings from anon,authenticated;
revoke all on public.attendance_incidents from anon,authenticated;
revoke all on public.attendance_incident_recoveries from anon,authenticated;
revoke all on public.attendance_incident_justifications from anon,authenticated;
revoke all on public.attendance_incident_audit from anon,authenticated;
revoke all on public.v_attendance_incidents from anon,authenticated;

grant all on public.attendance_incident_settings to service_role;
grant all on public.attendance_incidents to service_role;
grant all on public.attendance_incident_recoveries to service_role;
grant all on public.attendance_incident_justifications to service_role;
grant all on public.attendance_incident_audit to service_role;
grant select on public.v_attendance_incidents to service_role;

revoke all on function public.attendance_create_incident(uuid,date,time,time,text,text,text,uuid,time,time) from public,anon,authenticated;
revoke all on function public.attendance_add_recovery(uuid,date,time,time,text,uuid) from public,anon,authenticated;
revoke all on function public.attendance_add_justification(uuid,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.attendance_close_incident(uuid,uuid) from public,anon,authenticated;

grant execute on function public.attendance_create_incident(uuid,date,time,time,text,text,text,uuid,time,time) to service_role;
grant execute on function public.attendance_add_recovery(uuid,date,time,time,text,uuid) to service_role;
grant execute on function public.attendance_add_justification(uuid,integer,text,uuid) to service_role;
grant execute on function public.attendance_close_incident(uuid,uuid) to service_role;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_incidents') then
      alter publication supabase_realtime add table public.attendance_incidents;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_incident_recoveries') then
      alter publication supabase_realtime add table public.attendance_incident_recoveries;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_incident_justifications') then
      alter publication supabase_realtime add table public.attendance_incident_justifications;
    end if;
  end if;
end $$;
