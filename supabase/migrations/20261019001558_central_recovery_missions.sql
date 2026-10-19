begin;

-- Mission schedules are independent of the global attendance schedules.
create table if not exists public.crm_recovery_mission_schedules (
 worker_id uuid primary key references public.workers(id),
 timezone text not null default 'America/Guayaquil' check(timezone='America/Guayaquil'),
 start_time time not null, end_time time not null, notice_time time not null,
 target integer not null default 30 check(target=30),
 recovery_target integer not null default 5 check(recovery_target=5),
 followup_days integer not null default 7 check(followup_days between 1 and 90),
 enabled boolean not null default true,
 check(start_time<end_time and notice_time>=start_time and notice_time<end_time)
);
-- Resolve the established staff by their verified, unique active central name;
-- no generated worker identifiers are copied between database installations.
do $$ begin
 if exists(select 1 from workers where role='central' and is_active is distinct from false and lower(trim(display_name)) in ('isa','maria')
  group by lower(trim(display_name)) having count(*)>1) then raise exception 'AMBIGUOUS_RECOVERY_MISSION_WORKER'; end if;
end $$;
insert into public.crm_recovery_mission_schedules(worker_id,start_time,end_time,notice_time)
select w.id,s.start_time,s.end_time,s.notice_time
from (values ('isa','07:00'::time,'15:00'::time,'10:00'::time),('maria','15:00'::time,'23:00'::time,'15:00'::time)) s(worker_name,start_time,end_time,notice_time)
join public.workers w on lower(trim(w.display_name))=s.worker_name and w.role='central' and w.is_active is distinct from false
on conflict(worker_id) do nothing;

create table if not exists public.crm_recovery_mission_assignments (
 mission_day date not null, worker_id uuid not null references public.workers(id),
 client_id uuid not null references public.crm_clientes(id), assigned_at timestamptz not null default now(),
 primary key(mission_day,client_id), unique(worker_id,mission_day,client_id)
);
create index if not exists recovery_mission_assignment_worker on public.crm_recovery_mission_assignments(worker_id,mission_day);
create index if not exists recovery_mission_assignment_client on public.crm_recovery_mission_assignments(client_id,mission_day desc);

create table if not exists public.crm_recovery_contact_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 worker_id uuid not null references public.workers(id), client_id uuid not null references public.crm_clientes(id),
 mission_day date not null, channel text not null check(channel in ('whatsapp','phone','email','other')),
 contacted_at timestamptz not null default now(), counted boolean not null,
 reason text not null check(reason in ('counted','outside_shift','not_assigned','already_counted')),
 note text, check(counted=(reason='counted'))
);
create unique index if not exists recovery_contact_once_daily on public.crm_recovery_contact_events(mission_day,client_id) where counted;
create index if not exists recovery_contact_worker_day on public.crm_recovery_contact_events(worker_id,mission_day) where counted;
create index if not exists recovery_contact_client on public.crm_recovery_contact_events(client_id,contacted_at desc);

create table if not exists public.crm_recovery_daily_results (
 client_id uuid primary key references public.crm_clientes(id),
 worker_id uuid not null references public.workers(id), mission_day date not null,
 payment_id uuid not null unique references public.crm_cliente_pagos(id), recovered_at timestamptz not null,
 contact_event_id uuid references public.crm_recovery_contact_events(id)
);
create index if not exists recovery_daily_result_worker on public.crm_recovery_daily_results(worker_id,mission_day);
create index if not exists recovery_daily_result_contact on public.crm_recovery_daily_results(contact_event_id);

create table if not exists public.crm_recovery_mission_requests (
 request_id uuid primary key, worker_id uuid not null references public.workers(id),
 client_id uuid not null references public.crm_clientes(id), payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists recovery_mission_requests_worker on public.crm_recovery_mission_requests(worker_id,created_at desc);
create index if not exists recovery_mission_requests_client on public.crm_recovery_mission_requests(client_id);
create unique index if not exists worker_xp_recovery_mission_once on public.worker_xp_events(reference_id)
 where action_key in ('recovery_daily_management','recovery_daily_results');
insert into public.worker_xp_rules(action_key,name,description,xp_reward,frequency,enabled,integration_status)
values ('recovery_daily_management','Misión: 30 gestiones','30 clientes distintos gestionados en el turno entre semana.',10,'daily',true,'connected'),
 ('recovery_daily_results','Misión: 5 recuperaciones','5 clientes distintos recuperados en el turno entre semana.',200,'daily',true,'connected')
on conflict(action_key) do nothing;

alter table public.crm_recovery_mission_schedules enable row level security;
alter table public.crm_recovery_mission_assignments enable row level security;
alter table public.crm_recovery_contact_events enable row level security;
alter table public.crm_recovery_daily_results enable row level security;
alter table public.crm_recovery_mission_requests enable row level security;
revoke all on public.crm_recovery_mission_schedules,public.crm_recovery_mission_assignments,
 public.crm_recovery_contact_events,public.crm_recovery_daily_results,public.crm_recovery_mission_requests from public,anon,authenticated;
grant select,insert,update on public.crm_recovery_mission_schedules,public.crm_recovery_mission_assignments,
 public.crm_recovery_contact_events,public.crm_recovery_daily_results,public.crm_recovery_mission_requests to service_role;

-- Time is always supplied by the trusted calling function, never by an HTTP input.
create or replace function public.tc_recovery_mission_now()
returns timestamptz language sql stable security invoker set search_path=public,pg_temp as $$ select now() $$;

create or replace function public.tc_recovery_mission_context(p_worker uuid,p_at timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare s crm_recovery_mission_schedules; d date; workday boolean; starts timestamptz; ends timestamptz; notice timestamptz; elapsed numeric;
begin
 select * into s from crm_recovery_mission_schedules where worker_id=p_worker;
 d:=(p_at at time zone 'America/Guayaquil')::date;
 workday:=extract(isodow from d) between 1 and 5;
 if not found then return jsonb_build_object('worker_id',p_worker,'enabled',false,'timezone','America/Guayaquil','server_now',p_at,'day',d,'is_workday',workday,'active',false,'target',30,'recovery_target',5,'expected_managed',0); end if;
 starts:=(d+s.start_time) at time zone s.timezone;
 ends:=(d+s.end_time) at time zone s.timezone;
 notice:=(d+s.notice_time) at time zone s.timezone;
 elapsed:=greatest(0,least(s.target,extract(epoch from(p_at-notice))*s.target/extract(epoch from(ends-notice))));
 return jsonb_build_object('worker_id',p_worker,'enabled',s.enabled,'timezone',s.timezone,'server_now',p_at,'day',d,
 'is_workday',workday,'active',s.enabled and workday and p_at>=starts and p_at<ends,
 'starts_at',starts,'ends_at',ends,'notice_at',notice,'target',s.target,'recovery_target',s.recovery_target,
 'expected_managed',case when workday and s.enabled then floor(elapsed)::integer else 0 end,
 'next_checkpoint_at',case when workday and s.enabled and p_at<ends then least(ends,notice+(greatest(0,floor(extract(epoch from(p_at-notice))/2400))+1)*interval '40 minutes') else null end);
end $$;

create or replace function public.tc_recovery_mission_assign(p_worker uuid,p_at timestamptz)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare ctx jsonb; d date; needed integer; picked record; follow_days integer;
begin
 ctx:=tc_recovery_mission_context(p_worker,p_at);
 if not coalesce((ctx->>'active')::boolean,false) then return; end if;
 d:=(ctx->>'day')::date;
 -- This allocator lock is never taken by contact/recovery/award operations.
 perform pg_advisory_xact_lock(hashtextextended('recovery-assign:'||p_worker||':'||d,0));
 select greatest(0,30-count(*)::integer) into needed
 from crm_recovery_mission_assignments a join crm_client_recovery r on r.client_id=a.client_id
 join tc_recovery_candidates c on c.id=a.client_id
 where a.worker_id=p_worker and a.mission_day=d and (
  exists(select 1 from crm_recovery_contact_events e where e.worker_id=p_worker and e.mission_day=d and e.client_id=a.client_id and e.counted)
  or (r.responsible_id=p_worker and c.eligible and r.status in ('pending','contacted','no_response')));
 if needed=0 then return; end if;
 select followup_days into follow_days from crm_recovery_mission_schedules where worker_id=p_worker;
 for picked in
  select c.id from crm_clientes c join tc_recovery_candidates candidate on candidate.id=c.id
  left join crm_client_recovery r on r.client_id=c.id
  left join lateral (select max(h.created_at) last_at from crm_client_recovery_history h where h.client_id=c.id and h.status in ('contacted','no_response')) history on true
  where candidate.eligible and coalesce(r.status,'pending') in ('pending','contacted','no_response')
   and (r.responsible_id is null or r.responsible_id=p_worker)
   and not exists(select 1 from crm_recovery_mission_assignments a where a.mission_day=d and a.client_id=c.id)
   and (coalesce(history.last_at,r.contacted_at) is null or coalesce(history.last_at,r.contacted_at)<=p_at-make_interval(days=>follow_days))
  order by coalesce(history.last_at,r.contacted_at) nulls first,c.id
  limit needed for update of c skip locked
 loop
  insert into crm_client_recovery(client_id,responsible_id) values(picked.id,p_worker)
   on conflict(client_id) do update set responsible_id=excluded.responsible_id,version=crm_client_recovery.version+1
   where crm_client_recovery.responsible_id is null;
  -- Recheck after locking: legacy recovery actions can claim a recovery row independently.
  if exists(select 1 from crm_client_recovery where client_id=picked.id and responsible_id=p_worker and status in ('pending','contacted','no_response')) then
   insert into crm_recovery_mission_assignments(mission_day,worker_id,client_id,assigned_at)
    values(d,p_worker,picked.id,p_at) on conflict do nothing;
  end if;
 end loop;
end $$;

create or replace function public.tc_recovery_mission_awards(p_worker uuid,p_day date,p_at timestamptz)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare ctx jsonb; managed integer; recovered integer;
begin
 ctx:=tc_recovery_mission_context(p_worker,p_at);
 if not coalesce((ctx->>'active')::boolean,false) or (ctx->>'day')::date<>p_day then return; end if;
 -- Client rows are locked before this daily award lock in all mutation paths.
 perform pg_advisory_xact_lock(hashtextextended('recovery-award:'||p_worker||':'||p_day,0));
 select count(*) into managed from crm_recovery_contact_events where worker_id=p_worker and mission_day=p_day and counted;
 select count(*) into recovered from crm_recovery_daily_results where worker_id=p_worker and mission_day=p_day;
 if managed>=30 then
  insert into worker_xp_events(worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_by_worker_id)
  values(p_worker,'recovery_daily_management',10,'recovery_daily:'||p_worker||':'||p_day||':managed','30 gestiones · '||p_day,'client_recovery','applied',jsonb_build_object('mission_day',p_day,'managed',managed,'timezone','America/Guayaquil'),p_worker)
  on conflict do nothing;
 end if;
 if recovered>=5 then
  insert into worker_xp_events(worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_by_worker_id)
  values(p_worker,'recovery_daily_results',200,'recovery_daily:'||p_worker||':'||p_day||':recovered','5 recuperaciones · '||p_day,'client_recovery','applied',jsonb_build_object('mission_day',p_day,'recovered',recovered,'timezone','America/Guayaquil'),p_worker)
  on conflict do nothing;
 end if;
end $$;

create or replace function public.tc_recovery_mission_snapshot(p_worker uuid,p_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ctx jsonb; d date; managed integer; recovered integer; management_awarded boolean; recovery_awarded boolean; ids jsonb; earned integer;
begin
 ctx:=tc_recovery_mission_context(p_worker,p_at); d:=(ctx->>'day')::date;
 select count(*) into managed from crm_recovery_contact_events where worker_id=p_worker and mission_day=d and counted;
 select count(*) into recovered from crm_recovery_daily_results where worker_id=p_worker and mission_day=d;
 select coalesce(jsonb_agg(a.client_id order by a.assigned_at,a.client_id),'[]'::jsonb) into ids
 from crm_recovery_mission_assignments a join crm_client_recovery r on r.client_id=a.client_id join tc_recovery_candidates c on c.id=a.client_id
 where a.worker_id=p_worker and a.mission_day=d and (
  exists(select 1 from crm_recovery_contact_events e where e.worker_id=p_worker and e.mission_day=d and e.client_id=a.client_id and e.counted)
  or (r.responsible_id=p_worker and c.eligible and r.status in ('pending','contacted','no_response')));
 management_awarded:=exists(select 1 from worker_xp_events where reference_id='recovery_daily:'||p_worker||':'||d||':managed' and action_key='recovery_daily_management' and status='applied');
 recovery_awarded:=exists(select 1 from worker_xp_events where reference_id='recovery_daily:'||p_worker||':'||d||':recovered' and action_key='recovery_daily_results' and status='applied');
 select coalesce(sum(xp_amount),0)::integer into earned from worker_xp_events
 where worker_id=p_worker and status='applied' and action_key='client_recovery'
  and created_at>=(ctx->>'starts_at')::timestamptz and created_at<(ctx->>'ends_at')::timestamptz;
 return ctx||jsonb_build_object('managed',managed,'recovered',recovered,'management_bonus',10,'recovery_bonus',200,
 'management_bonus_awarded',management_awarded,'recovery_bonus_awarded',recovery_awarded,'assigned_client_ids',ids,
 'assigned_count',jsonb_array_length(ids),'shortage',greatest(0,30-jsonb_array_length(ids)),
 'awarded_xp',earned+(case when management_awarded then 10 else 0 end)+(case when recovery_awarded then 200 else 0 end));
end $$;

create or replace function public.tc_recovery_mission_state(p_user uuid,p_assign boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor workers; at_time timestamptz:=tc_recovery_mission_now();
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false
  order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if p_assign then perform tc_recovery_mission_assign(actor.id,at_time); end if;
 return tc_recovery_mission_snapshot(actor.id,at_time);
end $$;

create or replace function public.tc_recovery_mission_overview(p_user uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from workers where user_id=p_user and role='admin' and is_active is distinct from false) then raise exception 'FORBIDDEN'; end if;
 return jsonb_build_object('server_now',tc_recovery_mission_now(),'timezone','America/Guayaquil','missions',coalesce((select jsonb_agg(
  tc_recovery_mission_snapshot(w.id,tc_recovery_mission_now())||jsonb_build_object('worker_name',w.display_name) order by s.start_time)
  from crm_recovery_mission_schedules s join workers w on w.id=s.worker_id where s.enabled and w.is_active is distinct from false),'[]'::jsonb));
end $$;

create or replace function public.tc_recovery_mission_list(p_user uuid,p_bucket text default 'pending',p_status text default '',p_search text default '',p_tag text default '',p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor workers; d date; result jsonb;
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false
  order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 d:=(tc_recovery_mission_now() at time zone 'America/Guayaquil')::date;
 with base as (
  select c.*,coalesce(r.status,'pending') status,coalesce(r.version,0) version,r.responsible_id,w.display_name responsible_name,
   r.contacted_at,r.updated_at,r.recovered_at,r.payment_id,r.purchase_amount,coalesce(r.xp,0) xp,
   case when r.status in ('recycled','recovered') then r.status else 'pending' end bucket,
   exists(select 1 from crm_recovery_contact_events e where e.client_id=c.id and e.worker_id=actor.id and e.mission_day=d and e.counted) managed_today
  from crm_recovery_mission_assignments a join tc_recovery_candidates c on c.id=a.client_id
  left join crm_client_recovery r on r.client_id=c.id left join workers w on w.id=r.responsible_id
  where a.worker_id=actor.id and a.mission_day=d and (c.eligible or r.status in ('recycled','recovered'))
 ), filtered as (
  select * from base where bucket=p_bucket and (p_status='' or status=p_status)
   and (p_tag='' or (p_tag='__none__' and cardinality(tags)=0) or p_tag=any(tags))
   and (p_search='' or strpos(lower(nombre),lower(p_search))>0 or strpos(regexp_replace(telefono,'[^0-9]','','g'),regexp_replace(p_search,'[^0-9]','','g'))>0 and p_search ~ '[0-9]')
 ), page_rows as (
  select * from filtered order by managed_today,nombre,id limit 25 offset (greatest(1,p_page)-1)*25
 ) select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb),
  'total',(select count(*) from filtered),'counts',jsonb_build_object('pending',(select count(*) from base where bucket='pending'),'recycled',(select count(*) from base where bucket='recycled'),'recovered',(select count(*) from base where bucket='recovered')),
  'tags',coalesce((select jsonb_agg(tag order by tag) from (select distinct unnest(tags) tag from base) x),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function public.tc_recovery_mission_record_contact(p_worker uuid,p_client uuid,p_request uuid,p_channel text,p_note text,p_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ctx jsonb; d date; why text; event_id uuid;
begin
 ctx:=tc_recovery_mission_context(p_worker,p_at); d:=(ctx->>'day')::date;
 if not coalesce((ctx->>'active')::boolean,false) then why:='outside_shift';
 elsif not exists(select 1 from crm_recovery_mission_assignments a join crm_client_recovery r on r.client_id=a.client_id
  where a.worker_id=p_worker and a.mission_day=d and a.client_id=p_client and r.responsible_id=p_worker) then why:='not_assigned';
 elsif exists(select 1 from crm_recovery_contact_events where client_id=p_client and mission_day=d and counted) then why:='already_counted';
 else why:='counted'; end if;
 insert into crm_recovery_contact_events(request_id,worker_id,client_id,mission_day,channel,contacted_at,counted,reason,note)
 values(p_request,p_worker,p_client,d,p_channel,p_at,why='counted',why,nullif(left(trim(p_note),1000),'')) returning id into event_id;
 if why='counted' then perform tc_recovery_mission_awards(p_worker,d,p_at); end if;
 return jsonb_build_object('counted',why='counted','count_reason',why,'contact_event_id',event_id);
end $$;

create or replace function public.tc_recovery_act_v2(p_user uuid,p_client uuid,p_action text,p_version integer,
 p_payment uuid default null,p_note text default '',p_channel text default 'whatsapp',p_request_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor workers; request_key uuid:=coalesce(p_request_id,gen_random_uuid()); request_payload jsonb;
 previous crm_recovery_mission_requests; result jsonb; at_time timestamptz:=tc_recovery_mission_now();
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false
 order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if p_channel not in ('whatsapp','phone','email','other') or p_channel is null then raise exception 'INVALID_CHANNEL'; end if;
 request_payload:=jsonb_build_object('worker',actor.id,'client',p_client,'action',p_action,'version',p_version,'payment',p_payment,'note',left(coalesce(p_note,''),1000),'channel',p_channel);
 perform pg_advisory_xact_lock(hashtextextended('recovery-request:'||request_key,0));
 select * into previous from crm_recovery_mission_requests where request_id=request_key;
 if found then
  if previous.payload<>request_payload then raise exception 'OPERATION_CONFLICT'; end if;
  return previous.result||jsonb_build_object('duplicate_prevented',true,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
 end if;
 perform 1 from crm_clientes where id=p_client for update;
 result:=tc_recovery_act(p_user,p_client,p_action,p_version,p_payment,p_note);
 if p_action='contacted' and result->>'status'='contacted' then
  result:=result||tc_recovery_mission_record_contact(actor.id,p_client,request_key,p_channel,p_note,at_time);
 else result:=result||jsonb_build_object('counted',false); end if;
 result:=result||jsonb_build_object('duplicate_prevented',false,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
 insert into crm_recovery_mission_requests(request_id,worker_id,client_id,payload,result) values(request_key,actor.id,p_client,request_payload,result);
 return result;
end $$;

-- Existing 75 XP / confirmed payment semantics stay unchanged. Contact may have
-- happened on an earlier day; conversion and management are independent goals.
create or replace function public.tc_recovery_mission_capture_result()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare ctx jsonb; d date; contact_id uuid; at_time timestamptz:=tc_recovery_mission_now();
begin
 if new.status<>'recovered' or old.status='recovered' then return new; end if;
 ctx:=tc_recovery_mission_context(new.responsible_id,at_time); d:=(ctx->>'day')::date;
 if not coalesce((ctx->>'active')::boolean,false) then return new; end if;
 select id into contact_id from crm_recovery_contact_events where worker_id=new.responsible_id and client_id=new.client_id and mission_day=d and counted;
 insert into crm_recovery_daily_results(client_id,worker_id,mission_day,payment_id,recovered_at,contact_event_id)
 values(new.client_id,new.responsible_id,d,new.payment_id,at_time,contact_id) on conflict do nothing;
 perform tc_recovery_mission_awards(new.responsible_id,d,at_time);
 return new;
end $$;
drop trigger if exists tc_recovery_mission_result on public.crm_client_recovery;
create trigger tc_recovery_mission_result after update of status on public.crm_client_recovery
 for each row execute function public.tc_recovery_mission_capture_result();

-- One transaction owns the existing call/payment operation and its recovery.
-- The original registration/minute accounting functions are deliberately reused.
create or replace function public.tc_register_call_recovery(p_user uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor workers; op uuid; client_uuid uuid; at_time timestamptz:=tc_recovery_mission_now();
 request_payload jsonb; previous crm_recovery_mission_requests; recovery crm_client_recovery;
 result jsonb; receipt jsonb; payment_uuid uuid; event jsonb; converted boolean; daily_counted boolean;
 client_name text; eligible_before boolean; confirmed_payment crm_cliente_pagos;
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false
  order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null or nullif(p_payload->>'telefonista_worker_id','')::uuid is distinct from actor.id then raise exception 'FORBIDDEN'; end if;
 op:=nullif(p_payload->>'operation_id','')::uuid; client_uuid:=nullif(p_payload->>'cliente_id','')::uuid;
 if op is null or client_uuid is null then raise exception 'OPERATION_ID_INVALID'; end if;
 if not coalesce((p_payload->>'recuperado')::boolean,false) then raise exception 'INVALID_RECOVERY_CLASSIFICATION'; end if;
 if not coalesce((p_payload->>'cliente_compra_minutos')::boolean,false) or coalesce((p_payload->>'importe')::numeric,0)<=0 then raise exception 'PAYMENT_REQUIRED'; end if;
 -- Match registration's business inputs. Server-derived balances, benefits and
 -- notes can legitimately differ after a successful response was lost.
 select jsonb_object_agg(key,value) into request_payload from jsonb_each(p_payload)
 where key in ('cliente_id','telefonista_worker_id','existing_payment_id','cliente_compra_minutos','tipo_registro',
  'usa_7_free','usa_minutos','misma_compra','guarda_minutos','minutos_guardados_free','minutos_guardados_normales',
  'codigo_1','minutos_1','codigo_2','minutos_2','tarotista_worker_id','tarotista_manual_call','tarotista_nombre',
  'billing_collaborator_id','source_tag_id','importe','forma_pago','promo','recuperado','super_promo_ruleta');
 request_payload:=jsonb_build_object('kind','register_recovery','worker',actor.id,'client',client_uuid,'payload',request_payload);
 -- Same first lock as tc_register_call_minutes; then the shared request lock,
 -- client/recovery rows, and finally the daily award lock inside the trigger.
 perform pg_advisory_xact_lock(hashtextextended(op::text,0));
 perform pg_advisory_xact_lock(hashtextextended('recovery-request:'||op,0));
 select * into previous from crm_recovery_mission_requests where request_id=op;
 if found then
  if previous.payload<>request_payload then raise exception 'OPERATION_CONFLICT'; end if;
  receipt:=previous.result->'recovery';
  receipt:=receipt||jsonb_build_object('xp',0,'xp_event',null,'counted',false,'duplicate_prevented',true,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
  return previous.result||jsonb_build_object('duplicate_prevented',true,'recovery',receipt);
 end if;
 perform 1 from crm_clientes where id=client_uuid for update;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 select * into recovery from crm_client_recovery where client_id=client_uuid for update;
 if recovery.client_id is null or recovery.contacted_at is null or recovery.responsible_id is null then raise exception 'CONTACT_FIRST'; end if;
 converted:=recovery.status<>'recovered';
 if converted then
  select nombre,eligible into client_name,eligible_before from tc_recovery_candidates where id=client_uuid;
  if eligible_before is distinct from true then raise exception 'NOT_ELIGIBLE'; end if;
 end if;
 result:=tc_register_call_minutes(p_payload);
 if result#>>'{rendimiento,id}' is null or result->>'ok'='false' then raise exception 'CALL_REGISTER_FAILED'; end if;
 payment_uuid:=nullif(result#>>'{payment,id}','')::uuid;
 if payment_uuid is null then raise exception 'PAYMENT_REQUIRED'; end if;
 -- Even an already recovered client must have a real, matching purchase for
 -- this new classification; a previous purchase is never silently selected.
 select * into confirmed_payment from crm_cliente_pagos where id=payment_uuid and cliente_id=client_uuid and estado='completed' and importe>0 and created_at>=recovery.contacted_at and created_at<=now() for update;
 if not found then raise exception 'PAYMENT_REQUIRED'; end if;
 if converted then
  -- Registration can add a current/source tag. Eligibility was checked while
  -- the client/recovery rows were locked BEFORE that legitimate purchase.
  -- Preserve the original payment, attribution, unique reference and history
  -- semantics without weakening tc_recovery_act for unrelated callers.
  insert into worker_xp_events as e(worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_by_worker_id)
  values(recovery.responsible_id,'client_recovery',75,'client_recovery:'||client_uuid,'Cliente recuperado: '||client_name,'client_recovery','applied',
   jsonb_build_object('client_id',client_uuid,'payment_id',payment_uuid,'confirmed_by',actor.id,'rendimiento_id',result#>>'{rendimiento,id}','eligibility_validated_at',at_time),actor.id)
  returning to_jsonb(e) into event;
  update crm_client_recovery set status='recovered',updated_at=now(),version=version+1,recovered_at=now(),payment_id=payment_uuid,purchase_amount=confirmed_payment.importe,xp=75 where client_id=client_uuid;
  insert into crm_client_recovery_history(client_id,actor_id,status,note) values(client_uuid,actor.id,'recovered','Compra confirmada al registrar llamada');
 end if;
 daily_counted:=converted and exists(select 1 from crm_recovery_daily_results where client_id=client_uuid and worker_id=recovery.responsible_id and mission_day=(at_time at time zone 'America/Guayaquil')::date);
 receipt:=jsonb_build_object('status','recovered','worker_id',recovery.responsible_id,'xp',case when converted then 75 else 0 end,
  'xp_event',event,'counted',daily_counted,'duplicate_prevented',not converted,'payment_id',payment_uuid,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
 result:=result||jsonb_build_object('recovery',receipt);
 insert into crm_recovery_mission_requests(request_id,worker_id,client_id,payload,result) values(op,actor.id,client_uuid,request_payload,result);
 return result;
end $$;

revoke all on function public.tc_recovery_mission_now(),public.tc_recovery_mission_context(uuid,timestamptz),public.tc_recovery_mission_assign(uuid,timestamptz),
 public.tc_recovery_mission_awards(uuid,date,timestamptz),public.tc_recovery_mission_snapshot(uuid,timestamptz),
 public.tc_recovery_mission_state(uuid,boolean),public.tc_recovery_mission_overview(uuid),
 public.tc_recovery_mission_list(uuid,text,text,text,text,integer),
 public.tc_recovery_mission_record_contact(uuid,uuid,uuid,text,text,timestamptz),
 public.tc_recovery_act_v2(uuid,uuid,text,integer,uuid,text,text,uuid),public.tc_recovery_mission_capture_result(),public.tc_register_call_recovery(uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.tc_recovery_mission_now(),public.tc_recovery_mission_context(uuid,timestamptz),public.tc_recovery_mission_assign(uuid,timestamptz),
 public.tc_recovery_mission_awards(uuid,date,timestamptz),public.tc_recovery_mission_snapshot(uuid,timestamptz),
 public.tc_recovery_mission_state(uuid,boolean),public.tc_recovery_mission_overview(uuid),
 public.tc_recovery_mission_list(uuid,text,text,text,text,integer),
 public.tc_recovery_mission_record_contact(uuid,uuid,uuid,text,text,timestamptz),
 public.tc_recovery_act_v2(uuid,uuid,text,integer,uuid,text,text,uuid),public.tc_recovery_mission_capture_result(),public.tc_register_call_recovery(uuid,jsonb)
to service_role;
notify pgrst,'reload schema';
commit;
