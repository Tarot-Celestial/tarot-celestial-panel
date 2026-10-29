-- Central reporting is read-only over the canonical CRM ledgers.
-- New schedule versions and corrections preserve their author and effective date.
create table if not exists public.central_statistics_activation (
 singleton boolean primary key default true check(singleton), activated_at timestamptz not null default clock_timestamp()
);
insert into public.central_statistics_activation(singleton) values(true) on conflict do nothing;
alter table public.central_statistics_activation enable row level security;
revoke all on public.central_statistics_activation from public,anon,authenticated;
grant select on public.central_statistics_activation to service_role;
create table if not exists public.central_work_config_versions (
 id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.workers(id),
 effective_from timestamptz not null default clock_timestamp(), timezone text not null default 'America/Guayaquil' check(timezone='America/Guayaquil'),
 monthly_salary_eur numeric(12,2) not null default 0 check(monthly_salary_eur>=0),
 overtime_hourly_rate_eur numeric(12,4) check(overtime_hourly_rate_eur>=0),
 weekday_start time, weekday_end time, weekend_start time not null default '09:00', weekend_end time not null default '15:00',
 created_by uuid references public.workers(id), reason text not null,
 check((weekday_start is null)=(weekday_end is null)), check(weekday_start is null or weekday_start<weekday_end), check(weekend_start<weekend_end)
);
create index if not exists central_work_config_worker_time on public.central_work_config_versions(worker_id,effective_from desc);
create table if not exists public.central_workday_overrides (
 id uuid primary key default gen_random_uuid(),worker_id uuid not null references public.workers(id),work_date date not null,
 is_working boolean not null,start_time time,end_time time,created_by uuid not null references public.workers(id),created_at timestamptz not null default clock_timestamp(),
 check(not is_working or (start_time is not null and end_time is not null and start_time<end_time))
);
create index if not exists central_workday_worker_date on public.central_workday_overrides(worker_id,work_date,created_at desc);
create table if not exists public.central_time_adjustments (
 id uuid primary key,worker_id uuid not null references public.workers(id),work_date date not null,minutes integer not null check(minutes<>0 and abs(minutes)<=1440),
 category text not null check(category in ('ordinary','outside_schedule')),reason text not null check(length(btrim(reason)) between 5 and 2000),
 created_by uuid not null references public.workers(id),created_at timestamptz not null default clock_timestamp(),hourly_rate_eur numeric(12,4)
);
create index if not exists central_time_adjustment_worker_date on public.central_time_adjustments(worker_id,work_date);
create table if not exists public.central_statistics_operations (
 id uuid primary key,worker_id uuid not null references public.workers(id),actor_id uuid not null references public.workers(id),action text not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.central_work_config_versions enable row level security;
alter table public.central_workday_overrides enable row level security;
alter table public.central_time_adjustments enable row level security;
alter table public.central_statistics_operations enable row level security;
revoke all on public.central_work_config_versions,public.central_workday_overrides,public.central_time_adjustments,public.central_statistics_operations from public,anon,authenticated;
grant select,insert on public.central_work_config_versions,public.central_workday_overrides,public.central_time_adjustments,public.central_statistics_operations to service_role;

-- Staff-specific contracts are configured privately during rollout or by an
-- authenticated administrator. Public migrations must contain no personal pay data.

create or replace function public.tc_central_statistics_update(p_actor uuid,p_worker uuid,p_action text,p_payload jsonb,p_operation uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior central_statistics_operations; result jsonb; cfg central_work_config_versions; at_time timestamptz:=clock_timestamp();
 today date:=(clock_timestamp() at time zone 'America/Guayaquil')::date; month_start date; day date; requested date[]; existing date[]; delta integer;
begin
 if not exists(select 1 from workers where id=p_actor and role='admin' and is_active=true) then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from workers where id=p_worker and role in ('central','admin') and is_active=true) then raise exception 'WORKER_NOT_FOUND'; end if;
 if p_operation is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD'; end if;
 perform pg_advisory_xact_lock(hashtextextended('central-statistics:'||p_worker::text,0));
 select * into prior from central_statistics_operations where id=p_operation;
 if found then
  if prior.worker_id<>p_worker or prior.actor_id<>p_actor or prior.action<>p_action or prior.payload<>p_payload then raise exception 'OPERATION_CONFLICT'; end if;
  return prior.result||jsonb_build_object('duplicate_prevented',true);
 end if;
 if p_action='settings' then
  if not (p_payload ?& array['monthly_salary_eur','overtime_hourly_rate_eur','weekday_start','weekday_end','weekend_start','weekend_end']) then raise exception 'INVALID_SETTINGS'; end if;
  if (p_payload->>'monthly_salary_eur')::numeric<0 or (p_payload->>'monthly_salary_eur')::numeric>100000
     or (p_payload->>'overtime_hourly_rate_eur')::numeric<0 or (p_payload->>'overtime_hourly_rate_eur')::numeric>10000 then raise exception 'INVALID_RATE'; end if;
  insert into central_work_config_versions(worker_id,effective_from,monthly_salary_eur,overtime_hourly_rate_eur,weekday_start,weekday_end,weekend_start,weekend_end,created_by,reason)
  values(p_worker,at_time,(p_payload->>'monthly_salary_eur')::numeric,(p_payload->>'overtime_hourly_rate_eur')::numeric,
   nullif(p_payload->>'weekday_start','')::time,nullif(p_payload->>'weekday_end','')::time,
   (p_payload->>'weekend_start')::time,(p_payload->>'weekend_end')::time,p_actor,'Cambio administrativo; válido desde este instante.') returning * into cfg;
  result:=jsonb_build_object('ok',true,'version_id',cfg.id,'effective_from',cfg.effective_from);
 elsif p_action='weekends' then
  if coalesce(p_payload->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_payload->'days')<>'array' or jsonb_array_length(p_payload->'days')>10 then raise exception 'INVALID_WEEKENDS'; end if;
  month_start:=((p_payload->>'month')||'-01')::date;
  if month_start<date_trunc('month',today)::date or month_start>today+interval '1 year' then raise exception 'INVALID_MONTH'; end if;
  select coalesce(array_agg(distinct value::date),'{}'::date[]) into requested from jsonb_array_elements_text(p_payload->'days');
  if exists(select 1 from unnest(requested) d where d<=today or date_trunc('month',d)::date<>month_start or extract(isodow from d) not in (6,7)) then raise exception 'ONLY_FUTURE_WEEKEND_DATES'; end if;
  select * into cfg from central_work_config_versions where worker_id=p_worker order by effective_from desc,id desc limit 1;
  if not found then raise exception 'CONFIG_REQUIRED'; end if;
  -- Consider adjacent months too; Saturday and Sunday can straddle a boundary.
  if exists(with latest as(select distinct on(work_date) work_date,is_working from central_workday_overrides where worker_id=p_worker order by work_date,created_at desc,id desc),
   chosen as(select unnest(requested) d union select work_date from latest where is_working and (date_trunc('month',work_date)::date<>month_start or work_date<=today) and extract(isodow from work_date) in (6,7))
   select 1 from chosen group by date_trunc('week',d) having count(*)>1) then raise exception 'ONE_WEEKEND_DAY_PER_WEEK'; end if;
  select coalesce(array_agg(work_date),'{}'::date[]) into existing from (select distinct on(work_date) work_date,is_working from central_workday_overrides where worker_id=p_worker and work_date>today and date_trunc('month',work_date)::date=month_start order by work_date,created_at desc,id desc) x where is_working;
  foreach day in array existing loop
   if not(day=any(requested)) then insert into central_workday_overrides(worker_id,work_date,is_working,created_by) values(p_worker,day,false,p_actor); end if;
  end loop;
  foreach day in array requested loop
   insert into central_workday_overrides(worker_id,work_date,is_working,start_time,end_time,created_by) values(p_worker,day,true,cfg.weekend_start,cfg.weekend_end,p_actor);
  end loop;
  result:=jsonb_build_object('ok',true,'days',to_jsonb(requested));
 elsif p_action='adjustment' then
  if coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_DATE'; end if;
  day:=(p_payload->>'date')::date;delta:=(p_payload->>'minutes')::integer;
  if day>today or day<(select (activated_at at time zone 'America/Guayaquil')::date from central_statistics_activation where singleton)
     then raise exception 'OUTSIDE_RECORDED_PERIOD'; end if;
  if delta=0 or abs(delta)>1440 or p_payload->>'category' not in ('ordinary','outside_schedule') or length(btrim(coalesce(p_payload->>'reason',''))) not between 5 and 2000 then raise exception 'INVALID_ADJUSTMENT'; end if;
  if coalesce((select sum(minutes) from central_time_adjustments where worker_id=p_worker and work_date=day and category=p_payload->>'category'),0)
     <>coalesce((p_payload->>'expected_category_adjustment')::integer,0) then raise exception 'ADJUSTMENT_CHANGED'; end if;
  if coalesce((select sum(minutes) from central_time_adjustments where worker_id=p_worker and work_date=day),0)
     <>coalesce((p_payload->>'expected_total_adjustment')::integer,0) then raise exception 'ADJUSTMENT_CHANGED'; end if;
  if coalesce((p_payload->>'category_recorded_minutes')::numeric,0)+delta<0 then raise exception 'NEGATIVE_RECORDED_HOURS'; end if;
  if coalesce((p_payload->>'total_recorded_minutes')::numeric,0)+delta>1440 then raise exception 'INVALID_DAILY_HOURS'; end if;
  select * into cfg from central_work_config_versions where worker_id=p_worker and effective_from<least(at_time,(day+1)::timestamp at time zone 'America/Guayaquil') order by effective_from desc,id desc limit 1;
  insert into central_time_adjustments(id,worker_id,work_date,minutes,category,reason,created_by,hourly_rate_eur)
   values(p_operation,p_worker,day,delta,p_payload->>'category',btrim(p_payload->>'reason'),p_actor,cfg.overtime_hourly_rate_eur);
  result:=jsonb_build_object('ok',true,'adjustment_id',p_operation);
 else raise exception 'UNKNOWN_ACTION'; end if;
 insert into central_statistics_operations(id,worker_id,actor_id,action,payload,result) values(p_operation,p_worker,p_actor,p_action,p_payload,result);
 return result;
end $$;
revoke all on function public.tc_central_statistics_update(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.tc_central_statistics_update(uuid,uuid,text,jsonb,uuid) to service_role;

create or replace function public.tc_central_statistics(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>interval '32 days' then raise exception 'INVALID_PERIOD'; end if;
 with staff as materialized(select id,user_id,display_name,role,is_active,salary_base from workers where role in ('central','admin')),
 payments as materialized(
  select p.id,p.cliente_id,p.importe,p.created_at,
   lower(coalesce(p.created_by_role,'')) ~ '(cliente|web)' as is_web,
   case when lower(coalesce(p.created_by_role,'')) ~ '(cliente|web)' then null else actor.id end worker_id
  from crm_cliente_pagos p
  left join lateral(select w.id from staff w where w.id=p.created_by_user_id or w.user_id=p.created_by_user_id order by (w.id=p.created_by_user_id) desc,w.id limit 1) actor on true
  where p.created_at>=p_from and p.created_at<p_to and p.importe>0 and upper(coalesce(p.moneda,'EUR'))='EUR'
   and lower(btrim(p.estado)) in ('completed','completado','completada','paid','pagado','pagada','confirmed','confirmado','confirmada')
 ), payment_agg as(
  select p.worker_id,count(*) payments_count,sum(p.importe) payments_amount,
   count(*) filter(where exists(select 1 from attendance_panel_sessions s where s.worker_id=p.worker_id and p.created_at>=s.started_at and p.created_at<least(coalesce(s.ended_at,s.expires_at),s.expires_at))) payments_during_session_count,
   coalesce(sum(p.importe) filter(where exists(select 1 from attendance_panel_sessions s where s.worker_id=p.worker_id and p.created_at>=s.started_at and p.created_at<least(coalesce(s.ended_at,s.expires_at),s.expires_at))),0) payments_during_session_amount
  from payments p where worker_id is not null group by p.worker_id
 ), xp as(select worker_id,coalesce(sum(xp_amount) filter(where created_at>=p_from),0) xp_earned,sum(xp_amount) xp_total from worker_xp_events where status='applied' and created_at<p_to group by worker_id),
 confirmations as materialized(select distinct on(client_id) client_id,new_responsible_worker_id,created_at from crm_client_capture_audit where action='capture_confirmed' order by client_id,created_at,id),
 captures as(select new_responsible_worker_id worker_id,count(*) n from confirmations where created_at>=p_from and created_at<p_to group by new_responsible_worker_id),
 recoveries as(select responsible_id worker_id,count(*) n from crm_client_recovery where status='recovered' and recovered_at>=p_from and recovered_at<p_to group by responsible_id),
 contacts as(select worker_id,count(*) attempts,count(*) filter(where counted) counted from crm_recovery_contact_events where contacted_at>=p_from and contacted_at<p_to group by worker_id),
 capture_actions as(select actor_worker_id worker_id,count(*) n from captacion_state_events where created_at>=p_from and created_at<p_to and source<>'capture_assignment' group by actor_worker_id),
 followups as(select worker_id,count(*) n from crm_client_followups where completed_at>=p_from and completed_at<p_to group by worker_id),
 calls as(select telefonista_worker_id,count(*) n,coalesce(sum(greatest(tiempo,0)),0) minutes from rendimiento_llamadas where fecha_hora>=p_from and fecha_hora<p_to group by telefonista_worker_id),
 notes as(select s.id worker_id,count(*) n from crm_client_notes n join staff s on s.user_id=n.author_user_id where n.created_at>=p_from and n.created_at<p_to and n.event_type is null group by s.id),
 clients as(
  select worker_id,client_id::text client from crm_recovery_contact_events where contacted_at>=p_from and contacted_at<p_to
  union select actor_worker_id,cliente_id::text from captacion_state_events where created_at>=p_from and created_at<p_to and source<>'capture_assignment'
  union select worker_id,client_id::text from crm_client_followups where completed_at>=p_from and completed_at<p_to
  union select s.id,r.cliente_id from rendimiento_llamadas r join staff s on s.id::text=r.telefonista_worker_id where r.fecha_hora>=p_from and r.fecha_hora<p_to
  union select s.id,n.cliente_id from crm_client_notes n join staff s on s.user_id=n.author_user_id where n.created_at>=p_from and n.created_at<p_to and n.event_type is null
 ), unique_clients as(select worker_id,count(distinct client) n from clients where client is not null and btrim(client)<>'' group by worker_id),
 rows as(select s.id,s.display_name,s.role,s.is_active,s.salary_base,
  coalesce(p.payments_count,0) payments_count,coalesce(p.payments_amount,0) payments_amount,
  coalesce(p.payments_during_session_count,0) payments_during_session_count,coalesce(p.payments_during_session_amount,0) payments_during_session_amount,
  case when p.payments_count>0 then round(p.payments_amount/p.payments_count,2) else 0 end average_payment,
  coalesce(c.n,0) captures_confirmed,coalesce(r.n,0) recoveries,coalesce(ct.attempts,0) recovery_attempts,coalesce(ct.counted,0) recovery_counted,
  coalesce(ca.n,0) capture_actions,coalesce(f.n,0) followups_completed,coalesce(cl.n,0) calls_registered,coalesce(cl.minutes,0) call_minutes,coalesce(nt.n,0) notes_written,
  coalesce(u.n,0) unique_clients,coalesce(x.xp_earned,0) xp_earned,coalesce(x.xp_total,0) xp_total,
  (select count(*) from captacion_leads l where l.assigned_worker_id=s.id and l.estado not in ('captado','cliente','no_interesado','numero_invalido','perdido')) leads_assigned,
  (select count(*) from crm_client_followups f2 where f2.worker_id=s.id and f2.completed_at is null and lower(btrim(coalesce(f2.status,''))) not in ('completed','completado','completada','cancelado','cancelada','cancelled','resuelto','resuelta','resolved')) pending_followups
  from staff s left join payment_agg p on p.worker_id=s.id left join xp x on x.worker_id=s.id left join captures c on c.worker_id=s.id
  left join recoveries r on r.worker_id=s.id left join contacts ct on ct.worker_id=s.id left join capture_actions ca on ca.worker_id=s.id
  left join followups f on f.worker_id=s.id left join calls cl on cl.telefonista_worker_id=s.id::text left join unique_clients u on u.worker_id=s.id left join notes nt on nt.worker_id=s.id
 ) select jsonb_build_object('workers',coalesce((select jsonb_agg(to_jsonb(r) order by r.role,r.display_name,r.id) from rows r),'[]'::jsonb),
 'totals',(select jsonb_build_object('payments_count',count(*),'payments_amount',coalesce(sum(importe),0),'web_payments_count',count(*) filter(where is_web),'web_payments_amount',coalesce(sum(importe) filter(where is_web),0),'unattributed_payments_count',count(*) filter(where not is_web and worker_id is null),'unattributed_payments_amount',coalesce(sum(importe) filter(where not is_web and worker_id is null),0)) from payments),
 'payment_days',coalesce((select jsonb_agg(to_jsonb(d)) from(select worker_id,(created_at at time zone 'America/Guayaquil')::date date,count(*) payments_count,sum(importe) payments_amount from payments where worker_id is not null group by worker_id,(created_at at time zone 'America/Guayaquil')::date) d),'[]'::jsonb),
 'coverage',jsonb_build_object('recovery_attempts',(select min(contacted_at) from crm_recovery_contact_events),'recovery_counted',(select min(contacted_at) from crm_recovery_contact_events),'capture_actions',(select min(created_at) from captacion_state_events),'captures_confirmed',(select min(created_at) from crm_client_capture_audit where action='capture_confirmed'),'xp_earned',(select min(created_at) from worker_xp_events),'notes_written',(select min(created_at) from crm_client_notes where event_type is null),'unique_clients',greatest((select min(contacted_at) from crm_recovery_contact_events),(select min(created_at) from captacion_state_events),(select min(created_at) from crm_client_notes where event_type is null)),'payments_during_session_count',(select activated_at from central_statistics_activation where singleton),'payments_during_session_amount',(select activated_at from central_statistics_activation where singleton))) into result;
 return result;
end $$;
revoke all on function public.tc_central_statistics(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.tc_central_statistics(timestamptz,timestamptz) to service_role;
