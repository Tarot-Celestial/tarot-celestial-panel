begin;

-- An empty scope applies everywhere. Matching rules accumulate: a narrow rule
-- can restrict a broader one but cannot grant permission to a provider.
create table public.office_autonomy_rules (
  department text not null default '', action text not null default '', channel text not null default '', account text not null default '',
  mode text not null check (mode in ('automatic','paused','human')), held boolean not null default false,
  window_start time, window_end time,
  daily_actions int check (daily_actions between 0 and 100000),
  daily_usd numeric(10,2) check (daily_usd between 0 and 100000),
  revision integer not null default 1, updated_at timestamptz not null default now(),
  updated_by uuid not null references public.workers(id),
  primary key(department,action,channel,account),
  check ((window_start is null)=(window_end is null) and window_start is distinct from window_end or window_start is null and window_end is null),
  check (account='' or channel<>'')
);
create table public.office_autonomy_usage (
  action text not null, operation text not null, departments text[] not null, channel text not null, account text not null,
  started_at timestamptz not null default clock_timestamp(), budget_usd numeric(10,2) not null default 0,
  primary key (action,operation)
);
create index office_autonomy_usage_day on public.office_autonomy_usage(started_at);
alter table public.office_autonomy_rules enable row level security;
alter table public.office_autonomy_usage enable row level security;
revoke all on public.office_autonomy_rules,public.office_autonomy_usage from public,anon,authenticated,service_role;
grant select,insert,update on public.office_autonomy_rules to service_role;
grant select,insert on public.office_autonomy_usage to service_role;

create function public.office_autonomy_departments(p_action text) returns text[]
language sql immutable security invoker set search_path='' as $$
 select case p_action
   when 'capture_discovery' then array['captacion-reservas']
   when 'capture_reply' then array['captacion-reservas','marketing']
   when 'creative_brief' then array['marketing']
   when 'creative_copy' then array['marketing','creacion-contenido']
   when 'creative_art' then array['marketing','creacion-contenido']
   when 'instagram_publish' then array['marketing']
   when 'booking_review' then array['clientes','captacion-reservas']
   when 'monthly_report' then array['finanzas','inteligencia','estrategia']
 end
$$;

-- Today's existing Office attempts still count when a policy is first installed.
-- Only identifiers, time and the conservative reservation are copied.
insert into public.office_autonomy_usage(action,operation,departments,channel,account,started_at,budget_usd)
 select s.action,s.operation,public.office_autonomy_departments(s.action),s.channel,s.account,s.started_at,s.budget_usd from (
   select (array['creative_brief','creative_copy','creative_art'])[step+1] action,lease_token::text operation,
     case when step<2 then 'openai' else 'internal' end channel,'' account,claimed_at started_at,case when step<2 then 0.10 else 0 end budget_usd
     from public.office_run_attempts where claimed_at>=date_trunc('day',now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
   union all select 'capture_reply',t.request_id::text,o.channel,o.account_id,t.created_at,0 from public.office_capture_attempts t
     join public.office_capture_opportunities o on o.id=t.opportunity_id
     where t.created_at>=date_trunc('day',now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
   union all select 'instagram_publish',p.id::text,'instagram',p.persisted_account_id,p.dispatch_started_at,0 from public.office_instagram_posts p
     where p.dispatch_started_at>=date_trunc('day',now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
 ) s;

create function public.office_autonomy_check(p_action text,p_channel text,p_account text,p_operation text,p_reserve boolean default false)
returns text language plpgsql volatile security invoker set search_path='' as $$
declare
  departments_ text[]:=public.office_autonomy_departments(p_action);
  r public.office_autonomy_rules;
  current_time_ timestamptz;
  local_time_ time;
  start_day timestamptz;
  existing public.office_autonomy_usage; already boolean;
  n bigint; spent numeric; cost numeric:=case when p_action in ('creative_brief','creative_copy') then 0.10 else 0 end;
  decision text:='allow';
begin
  if departments_ is null or nullif(p_channel,'') is null or p_account is null or
     (p_reserve and (nullif(p_operation,'') is null or length(p_operation)>240)) then raise exception 'OFFICE_INVALID'; end if;
  -- Independent departments can work concurrently. Only matching capped rules
  -- serialize reservations, under a deterministic lock order. Edits take the
  -- corresponding exclusive advisory lock. No network I/O holds a lock.
  if p_reserve then
    perform pg_advisory_xact_lock_shared(279404,7);
    perform 1 from public.office_autonomy_rules x
      where (x.daily_actions is not null or x.daily_usd is not null) and (x.department='' or x.department=any(departments_))
        and (x.action='' or x.action=p_action)
        and (x.channel='' or x.channel=p_channel or p_action='capture_reply' and p_channel='meta_form' and x.channel='whatsapp' and x.account='')
        and (x.account='' or x.account=p_account) order by x.department,x.action,x.channel,x.account for update;
  end if;
  current_time_:=clock_timestamp();
  local_time_:=(current_time_ at time zone 'Europe/Madrid')::time;
  start_day:=date_trunc('day',current_time_ at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  select * into existing from public.office_autonomy_usage u where u.action=p_action and u.operation=p_operation;
  already:=found;
  if already and (existing.channel,existing.account) is distinct from (p_channel,p_account) then raise exception 'OFFICE_CONFLICT'; end if;
  for r in select * from public.office_autonomy_rules x
   where (x.department='' or x.department=any(departments_)) and (x.action='' or x.action=p_action)
     and (x.channel='' or x.channel=p_channel or p_action='capture_reply' and p_channel='meta_form' and x.channel='whatsapp' and x.account='')
     and (x.account='' or x.account=p_account)
  loop
    if r.held or r.mode='paused' then return 'paused'; end if;
    if r.mode='human' then decision:='handoff'; end if;
    if r.window_start is not null and not (case when r.window_start<r.window_end
      then local_time_>=r.window_start and local_time_<r.window_end
      else local_time_>=r.window_start or local_time_<r.window_end end) and decision='allow' then decision:='schedule'; end if;
    -- The official template has a variable country/provider tariff. A monetary
    -- ceiling cannot authorize that cost until a firm upper bound is available.
    if p_action='capture_reply' and p_channel='meta_form' and r.daily_usd is not null and decision='allow' then decision:='limit'; end if;
    if r.daily_actions is not null or (cost>0 and r.daily_usd is not null) then
      select count(*),coalesce(sum(u.budget_usd),0) into n,spent from public.office_autonomy_usage u where u.started_at>=start_day
        and (r.department='' or r.department=any(u.departments)) and (r.action='' or r.action=u.action)
        and (r.channel='' or r.channel=u.channel or u.action='capture_reply' and u.channel='meta_form' and r.channel='whatsapp' and r.account='')
        and (r.account='' or r.account=u.account);
      -- Do not count this operation twice. Limits tightened since its reservation
      -- can still block its transport, including a new cap of zero.
      if already and existing.started_at>=start_day then n:=n-1; spent:=spent-existing.budget_usd; end if;
      if (n>=r.daily_actions or cost>0 and spent+cost>r.daily_usd) and decision='allow' then decision:='limit'; end if;
    end if;
  end loop;
  if decision='allow' and p_reserve and not already then
    insert into public.office_autonomy_usage(action,operation,departments,channel,account,budget_usd)
     values(p_action,p_operation,departments_,p_channel,p_account,cost) on conflict(action,operation) do nothing;
  end if;
  return decision;
end $$;

create function public.office_autonomy_set(p_actor uuid,p_rule jsonb,p_revision int) returns integer
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); d text:=p_rule->>'department'; a text:=p_rule->>'action';
  ch text:=p_rule->>'channel'; acct text:=p_rule->>'account'; old_revision int; updated integer;
begin
 if p_revision is null or p_revision<0 or d is null or a is null or ch is null or acct is null
   or (d<>'' and not exists(select 1 from public.office_departments z where z.id=d))
   or (a<>'' and public.office_autonomy_departments(a) is null)
   or (a<>'' and d<>'' and not (d=any(public.office_autonomy_departments(a))))
   or ch not in ('','instagram','facebook','meta_form','whatsapp','openai','internal')
   or length(acct)>160 or acct ~ '[[:cntrl:]]' or (acct<>'' and ch='')
   or (p_rule->>'mode') is null or (p_rule->>'mode') not in ('automatic','paused','human') then raise exception 'OFFICE_INVALID'; end if;
 perform pg_advisory_xact_lock(279404,7);
 select revision into old_revision from public.office_autonomy_rules where (department,action,channel,account)=(d,a,ch,acct);
 if coalesce(old_revision,0)<>p_revision then raise exception 'OFFICE_CONFLICT'; end if;
 insert into public.office_autonomy_rules(department,action,channel,account,mode,window_start,window_end,daily_actions,daily_usd,updated_by)
 values(d,a,ch,acct,p_rule->>'mode',(p_rule->>'window_start')::time,(p_rule->>'window_end')::time,
   (p_rule->>'daily_actions')::integer,(p_rule->>'daily_usd')::numeric,actor)
 on conflict(department,action,channel,account) do update set mode=excluded.mode,window_start=excluded.window_start,
   window_end=excluded.window_end,daily_actions=excluded.daily_actions,daily_usd=excluded.daily_usd,
   updated_by=actor,updated_at=clock_timestamp(),revision=public.office_autonomy_rules.revision+1 returning revision into updated;
 insert into public.office_events(department_id,actor_id,kind,note,details)
 values(coalesce(nullif(d,''),'seguridad-accesos'),actor,'autonomy_changed','Administración actualizó la autonomía.',
 jsonb_build_object('scope',jsonb_build_array(d,a,ch,acct),'mode',p_rule->>'mode','revision',updated,
   'window_start',p_rule->>'window_start','window_end',p_rule->>'window_end','daily_actions',p_rule->'daily_actions','daily_usd',p_rule->'daily_usd'));
 return updated;
end $$;
-- Emergency holds are independent of the underlying mode, windows and quotas.
create function public.office_autonomy_hold(p_actor uuid,p_department text,p_held boolean,p_revision int) returns integer
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=public.office_actor(p_actor); oldrev int; updated int;
begin
 if p_department is null or (p_department<>'' and not exists(select 1 from public.office_departments where id=p_department))
   or p_held is null or p_revision is null then raise exception 'OFFICE_INVALID'; end if;
 perform pg_advisory_xact_lock(279404,7);
 select revision into oldrev from public.office_autonomy_rules where (department,action,channel,account)=(p_department,'','','');
 if coalesce(oldrev,0)<>p_revision then raise exception 'OFFICE_CONFLICT'; end if;
 insert into public.office_autonomy_rules(department,mode,held,updated_by) values(p_department,'automatic',p_held,actor)
 on conflict(department,action,channel,account) do update set held=excluded.held,revision=office_autonomy_rules.revision+1,
 updated_at=clock_timestamp(),updated_by=actor returning revision into updated;
 insert into public.office_events(department_id,actor_id,kind,note,details) values(coalesce(nullif(p_department,''),'seguridad-accesos'),
 actor,'autonomy_hold',case when p_held then 'Administración puso el trabajo automático en pausa.' else 'Administración retiró la pausa.' end,
 jsonb_build_object('department',p_department,'held',p_held,'revision',updated));
 return updated;
end $$;

create or replace function public.office_capture_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; worker uuid; o public.office_capture_opportunities; reason text; attempts int:=0;
begin
 select s.actor_user_id,w.id into actor,worker from public.office_capture_settings s
 join public.workers w on w.user_id=s.actor_user_id and w.is_active is true
 where s.id and s.enabled and public.tc_has_admin_access(s.actor_user_id) is true;
 if actor is null then return null; end if;
 if public.office_autonomy_check('capture_reply','*','',null,false) in ('paused','schedule','limit') then return null; end if;
 loop
  select * into o from public.office_capture_opportunities where status='pending' and public.office_autonomy_check('capture_reply',channel,account_id,request_id::text,false) in ('allow','handoff')
    order by latest_inbound_at,id for update skip locked limit 1;
  if not found or attempts>=20 then return null; end if;
  reason:=public.office_capture_guard(o.id);
  if reason is null and public.office_autonomy_check('capture_reply',o.channel,o.account_id,o.request_id::text,false)='handoff' then
    reason:='autonomy_handoff';
  end if;
  if reason is null then
    update public.office_capture_opportunities set status='claimed',claimed_by=actor,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes',
      updated_at=now() where id=o.id returning * into o;
    return to_jsonb(o)||jsonb_build_object('actor_user_id',actor,'actor_worker_id',worker,
      'submission_key',case when o.kind='form' then 'meta:'||o.source_id end);
  end if;
  update public.office_capture_opportunities set status=case when reason in ('purchased','expired','opted_out') then reason else 'handoff' end,
    last_error=reason,updated_at=now() where id=o.id;
  attempts:=attempts+1;
 end loop;
end $$;

create or replace function public.office_capture_begin(p_id uuid,p_lease_token uuid,p_body text,p_route text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; worker uuid; o public.office_capture_opportunities; reason text;
begin
 if nullif(trim(p_body),'') is null or length(p_body)>2000 or nullif(trim(p_route),'') is null or length(p_route)>160 then raise exception 'OFFICE_CAPTURE_INVALID'; end if;
 select * into o from public.office_capture_opportunities where id=p_id for update;
 if not found or o.status<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_until<=clock_timestamp() then return null; end if;
 select s.actor_user_id,w.id into actor,worker from public.office_capture_settings s join public.workers w on w.user_id=s.actor_user_id and w.is_active is true
 where s.id and s.enabled and public.tc_has_admin_access(s.actor_user_id) is true for share of s;
 if actor is null or actor is distinct from o.claimed_by then
   update public.office_capture_opportunities set status='pending',lease_token=null,lease_until=null,updated_at=now() where id=o.id;
   return null;
 end if;
 reason:=public.office_capture_guard(o.id);
 if reason is not null then
   update public.office_capture_opportunities set status=case when reason in ('purchased','expired','opted_out') then reason else 'handoff' end,
     last_error=reason,lease_token=null,lease_until=null,updated_at=now() where id=o.id;
   return null;
 end if;
 reason:=public.office_autonomy_check('capture_reply',o.channel,o.account_id,o.request_id::text,true);
 if reason<>'allow' then
   update public.office_capture_opportunities set status=case when reason='handoff' then 'handoff' else 'pending' end,
     last_error='autonomy_'||reason,lease_token=null,lease_until=null,updated_at=now() where id=o.id;
   return null;
 end if;
 insert into public.office_capture_attempts(request_id,opportunity_id,source_id,actor_user_id,body,route)
   values(o.request_id,o.id,o.source_id,actor,p_body,p_route);
 update public.office_capture_opportunities set status='dispatching',last_error=null,lease_until=clock_timestamp()+interval '3 minutes',updated_at=now() where id=o.id returning * into o;
 return to_jsonb(o)||jsonb_build_object('actor_user_id',actor,'actor_worker_id',worker,'submission_key',case when o.kind='form' then 'meta:'||o.source_id end);
end $$;

create or replace function public.office_run_claim(p_run_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.office_runs; token uuid; claims integer; day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  -- Serialize the short budget reservation; remote provider calls happen outside this transaction.
  perform pg_advisory_xact_lock(hashtextextended('office-campaign-claims',0));
  update public.office_runs set status='needs_reconciliation',last_error='El intento anterior perdió su confirmación. Requiere revisión antes de repetir.',
    updated_at=now() where status='running' and lease_until<=clock_timestamp();
  if (select count(*) from public.office_runs where lease_token is not null and lease_until>clock_timestamp())>=2 then return null; end if;
  select * into job from public.office_runs where status='queued' and (p_run_id is null or id=p_run_id) and
    public.office_autonomy_check((array['creative_brief','creative_copy','creative_art'])[step+1],
      case when step<2 then 'openai' else 'internal' end,'',null,false) in ('allow','handoff')
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
  if public.office_autonomy_check((array['creative_brief','creative_copy','creative_art'])[job.step+1],
      case when job.step<2 then 'openai' else 'internal' end,'',null,false)='handoff' then
    update public.office_runs set status='waiting_input',last_error='La política de autonomía requiere revisión humana.',updated_at=now() where id=job.id;
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

create or replace function public.office_ig_claim(p_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare post public.office_instagram_posts; wanted text; reason text;
begin
  select * into post from public.office_instagram_posts
    where (p_id is null or id=p_id) and status in ('queued','preparing','container_ready','dispatching','verifying')
      and scheduled_at<=now() and next_attempt_at<=now() and (lease_until is null or lease_until<=clock_timestamp())
      and (dispatch_started_at is not null or status='verifying' or public.office_autonomy_check('instagram_publish','instagram',persisted_account_id,id::text,false) in ('allow','handoff'))
    order by next_attempt_at,approved_at,id for update skip locked limit 1;
  if not found then return null; end if;
  wanted:=case when post.dispatch_started_at is not null or post.status='verifying' then 'verifying' when post.container_id is not null then 'container_ready' else 'preparing' end;
  if wanted<>'verifying' then
    reason:=public.office_ig_invalid_reason(post.id);
    if reason is null and public.office_autonomy_check('instagram_publish','instagram',post.persisted_account_id,post.id::text,false)='handoff' then
      reason:='La política de autonomía requiere una revisión humana de la publicación.';
    end if;
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

create or replace function public.office_ig_transition(p_id uuid,p_lease uuid,p_next text,p_container_id text default null,
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
      if reason is not null then next_status:='invalidated'; else
        reason:=public.office_autonomy_check('instagram_publish','instagram',post.persisted_account_id,post.id::text,true);
        if reason='handoff' then next_status:='invalidated'; reason:='La política de autonomía requiere revisión humana.';
        elsif reason<>'allow' then next_status:='container_ready'; defer_until:=now()+interval '5 minutes'; reason:='Autonomía · '||reason;
        else keep_lease:=true; reason:=null; end if;
      end if;
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

create or replace function public.office_agent_round() returns jsonb
language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare
  cutoff timestamptz := statement_timestamp();
  current_month date := date_trunc('month', cutoff at time zone 'Europe/Madrid')::date;
  period date;
  result jsonb;
  payload jsonb;
  intake timestamptz;
  analysed timestamptz;
  delivered timestamptz;
  changed integer;
  reviewed integer := 0;
  reports_changed integer := 0;
begin
  if not pg_try_advisory_xact_lock(279404, 5) then
    return jsonb_build_object('busy',true);
  end if;
  -- Re-evaluate previously reviewed reservations as well: a later first purchase or
  -- a change of date / reader / verified CRM identity is a new internal handoff.
  if public.office_autonomy_check('booking_review','internal','',gen_random_uuid()::text,true)='allow' then
  with firsts as (
    select client_id,min(at) first_purchase from public.office_crm_purchase_evidence
    where at<=cutoff and recorded_at<=cutoff group by client_id
  ), verified as (
    select b.*, f.first_purchase is not null as captured,
      md5(jsonb_build_array(b.client_id,b.booked_at,b.state,b.assignee,f.first_purchase)::text) signature
    from public.office_agent_linked_bookings b left join firsts f on f.client_id=b.client_id
  ), pending as (
    select v.* from verified v left join public.office_agent_booking_reviews old
      on old.source=v.source and old.booking_id=v.id
    where old.signature is distinct from v.signature
    order by (v.booked_at>=cutoff) desc nulls last,
      abs(extract(epoch from (v.booked_at-cutoff))) nulls last,v.source,v.id limit 60
  )
  insert into public.office_agent_booking_reviews(source,booking_id,client_id,signature,captured,reviewed_at)
    select source,id,client_id,signature,captured,clock_timestamp() from pending
    on conflict (source,booking_id) do update set client_id=excluded.client_id,signature=excluded.signature,
      captured=excluded.captured,reviewed_at=excluded.reviewed_at;
  get diagnostics reviewed = row_count;
  end if;

  foreach period in array array[(current_month - interval '1 month')::date,current_month] loop
    continue when public.office_autonomy_check('monthly_report','internal','',gen_random_uuid()::text,true)<>'allow';
    result := public.office_crm_cohort_report(period,cutoff);
    intake := clock_timestamp();
    if jsonb_typeof(result->'captured_clients') is distinct from 'number' or
       jsonb_typeof(result->'origins') is distinct from 'array' or
       jsonb_typeof(result->'totals') is distinct from 'array' then
      raise exception 'OFFICE_INCOMPLETE_COHORT';
    end if;
    if (select coalesce(sum((origin->>'captured_clients')::bigint),0) from jsonb_array_elements(result->'origins') origin)
       <> (result->>'captured_clients')::bigint then raise exception 'OFFICE_COHORT_MISMATCH'; end if;
    analysed := clock_timestamp();
    -- All currency groups and unknown amounts are kept as reported by the CRM.
    payload := result - 'as_of';
    delivered := clock_timestamp();
    insert into public.office_agent_monthly_reports(month,revision,report,intake_at,analysis_at,delivered_at,checked_at)
      values(period,1,payload,intake,analysed,delivered,cutoff)
      on conflict(month) do update set revision=office_agent_monthly_reports.revision+1,
        report=excluded.report,intake_at=excluded.intake_at,analysis_at=excluded.analysis_at,
        delivered_at=excluded.delivered_at,checked_at=excluded.checked_at
      where office_agent_monthly_reports.report is distinct from excluded.report;
    get diagnostics changed = row_count;
    reports_changed := reports_changed+changed;
    if changed=0 then update public.office_agent_monthly_reports set checked_at=cutoff where month=period; end if;
  end loop;
  return jsonb_build_object('busy',false,'bookings_reviewed',reviewed,'reports_delivered',reports_changed);
end $$;


-- Verify the live lease just before spending with OpenAI or rendering a delivery.
create function public.office_autonomy_creative(p_run_id uuid,p_lease uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare job public.office_runs;
begin
 select * into job from public.office_runs where id=p_run_id and status='running' and lease_token=p_lease
   and lease_until>clock_timestamp() for update;
 if not found then return 'stale'; end if;
 return public.office_autonomy_check((array['creative_brief','creative_copy','creative_art'])[job.step+1],
    case when job.step<2 then 'openai' else 'internal' end,'',p_lease::text,true);
end $$;

-- The container can be prepared only under the same approved account and lease.
-- The later dispatch transition rechecks and consumes the quota exactly once.
create function public.office_autonomy_ig_prepare(p_id uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare post public.office_instagram_posts;
begin
 select * into post from public.office_instagram_posts where id=p_id and lease_token=p_lease and lease_until>clock_timestamp()
   and dispatch_started_at is null and status='preparing' for update;
 if not found then return false; end if;
 if public.office_autonomy_check('instagram_publish','instagram',post.persisted_account_id,post.id::text,false)='allow' then return true; end if;
 update public.office_instagram_posts set status='queued',lease_token=null,lease_until=null,next_attempt_at=now()+interval '5 minutes',
  preparation_attempts=greatest(preparation_attempts-1,0),updated_at=now() where id=post.id;
 return false;
end $$;
create function public.office_autonomy_dispatch(p_id uuid,p_lease uuid,p_request uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o public.office_capture_opportunities;
begin
 select * into o from public.office_capture_opportunities where id=p_id and lease_token=p_lease and request_id=p_request and status='dispatching'
   and lease_until>clock_timestamp();
 if not found or not exists(select 1 from public.office_capture_settings where id and enabled and actor_user_id=o.claimed_by)
   or public.tc_has_admin_access(o.claimed_by) is not true or public.office_capture_guard(p_id) is not null then return false; end if;
 return public.office_autonomy_check('capture_reply',o.channel,o.account_id,o.request_id::text,false)='allow';
end $$;

create function public.office_capture_discover(p_batch uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e record; n int:=0; reason text; candidate record; allowed text[]:=array[]::text[]; source record;
begin
 if p_batch is null then raise exception 'OFFICE_INVALID'; end if;
 -- Evaluate each account once, outside the potentially large set of inbox rows.
 for source in
   select distinct channel,account_id from public.office_capture_social_threads
   union select distinct channel,account_id from public.office_capture_opportunities where channel='whatsapp' and status='sent'
   union select distinct 'meta_form',coalesce(nullif(page_id,''),'form:'||nullif(form_id,''),'meta-leads')
     from public.meta_lead_events where status='processed'
   order by 1,2
 loop
   if public.office_autonomy_check('capture_discovery',source.channel,source.account_id,
      p_batch::text||':'||source.channel||':'||source.account_id,true)='allow' then
     allowed:=array_append(allowed,source.channel||':'||source.account_id);
   end if;
 end loop;
 -- Private exact-text ingestions and periodic metadata scans share the same source key.
 -- Resolve each native thread once for the whole batch. Taking the limit only
 -- after the join keeps recent unmatched IDs from starving older genuine input.
 for e in with threads as materialized (
   select distinct on (channel,account_id,kind,thread_key) channel,account_id,kind,thread_key,id,recipient_id,name
   from public.office_capture_social_threads where channel||':'||account_id=any(allowed)
   order by channel,account_id,kind,thread_key,remote_updated_at desc,id
 )
 select a.*,t.id thread_id,t.recipient_id,t.name from public.tc_social_inbox_activity a
   join threads t on (t.channel,t.account_id,t.kind,t.thread_key)=(a.provider,a.account_id,a.kind,a.thread_remote_id)
   where a.removed_at is null and a.occurred_at<=now() and not exists(select 1 from public.office_capture_inbound i
     where (i.channel,i.account_id,i.kind,i.source_id)=(a.provider,a.account_id,a.kind,a.remote_id))
   order by a.occurred_at desc,a.id desc limit 250
 loop
   perform public.office_capture_store(e.provider,e.account_id,e.kind,e.thread_remote_id,e.remote_id,e.occurred_at,null,true,e.thread_id,
     e.recipient_id,e.name,null,null,null,null,false); n:=n+1;
 end loop;
 -- Threads imported before the verified inbox ledger remain visible; a preview never opens a reply window.
 for e in select t.* from public.office_capture_social_threads t where t.channel||':'||t.account_id=any(allowed) and not exists(select 1 from public.office_capture_opportunities o
   where (o.channel,o.account_id,o.kind,o.thread_key)=(t.channel,t.account_id,t.kind,t.thread_key))
   order by t.remote_updated_at desc,t.id limit 150
 loop
  perform public.office_capture_store(e.channel,e.account_id,e.kind,e.thread_key,'thread:'||e.id,coalesce(e.remote_created_at,e.remote_updated_at),
    null,false,e.id,e.recipient_id,e.name,null,null,null,null,false); n:=n+1;
 end loop;
 for e in select m.leadgen_id,m.page_id,m.form_id,m.captacion_lead_id,m.cliente_id,m.meta_created_at,c.pais,c.nombre,
   exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.payload#>'{lead,field_data}')='array' then m.payload#>'{lead,field_data}' else '[]' end) f
     where lower(f->>'name') in ('whatsapp_opt_in','consent_whatsapp','acepto_contacto_por_whatsapp','autorizo_contacto_por_whatsapp')
       and case when jsonb_typeof(f->'values')='array' then jsonb_array_length(f->'values')=1 else false end
       and lower(trim(f#>>'{values,0}')) in ('true','1','yes','sí','si','acepto','autorizo')) consent
   from public.meta_lead_events m join public.captacion_leads l on l.id=m.captacion_lead_id and l.cliente_id=m.cliente_id
   join public.crm_clientes c on c.id=m.cliente_id where m.status='processed' and m.meta_created_at<=now()
     and 'meta_form:'||coalesce(nullif(m.page_id,''),'form:'||nullif(m.form_id,''),'meta-leads')=any(allowed)
     and nullif(m.leadgen_id,'') is not null and coalesce(lower(c.origen),'') not like '%orion%' and coalesce(lower(l.origen),'') not like '%orion%'
     and not exists(select 1 from public.office_capture_inbound i where i.channel='meta_form' and i.kind='form' and i.source_id=m.leadgen_id
       and i.account_id=coalesce(nullif(m.page_id,''),'form:'||nullif(m.form_id,''),'meta-leads'))
   order by m.meta_created_at desc,m.leadgen_id limit 150
 loop
   perform public.office_capture_store('meta_form',coalesce(nullif(e.page_id,''),'form:'||nullif(e.form_id,''),'meta-leads'),'form',
     'lead:'||e.captacion_lead_id,e.leadgen_id,e.meta_created_at,null,true,null,null,e.nombre,null,e.cliente_id,e.captacion_lead_id,e.pais,e.consent);
   n:=n+1;
 end loop;
 -- A second inbound during dispatch remains in the private ledger. Re-arm it only after a definitive receipt.
 for e in select o.*,i.source_id newer_id,i.source_at newer_at,i.inbound_text newer_text from public.office_capture_opportunities o
   join lateral (select * from public.office_capture_inbound i where i.opportunity_id=o.id order by i.source_at desc,i.source_id desc limit 1) i on true
   where o.status='sent' and o.kind<>'form' and o.channel||':'||o.account_id=any(allowed) and (i.source_at,i.source_id)>(o.latest_inbound_at,o.source_id) limit 100
 loop
   perform public.office_capture_store(e.channel,e.account_id,e.kind,e.thread_key,e.newer_id,e.newer_at,e.newer_text,true,e.thread_id,
     e.recipient_id,e.name,e.session_id,e.client_id,e.lead_id,e.market,e.whatsapp_consent); n:=n+1;
 end loop;
 update public.office_capture_opportunities set status='uncertain',last_error='dispatch_receipt_missing',lease_until=null,updated_at=now()
   where status='dispatching' and lease_until<=clock_timestamp();
 update public.office_capture_opportunities set status='pending',lease_token=null,lease_until=null,updated_at=now()
   where status='claimed' and lease_until<=clock_timestamp();
 update public.office_capture_opportunities x set status='purchased',last_error='purchased',lease_token=null,lease_until=null,updated_at=now()
 from (select distinct p.client_id from public.office_crm_purchase_evidence p where p.at<=now() and p.recorded_at<=now()) paid
 where paid.client_id=x.client_id and x.status not in ('purchased','dispatching','uncertain','opted_out');
 for candidate in select id,status from public.office_capture_opportunities x where x.status='pending'
   order by x.latest_inbound_at desc,x.id limit 250
 loop
   reason:=public.office_capture_guard(candidate.id,false);
   if reason is not null then
     update public.office_capture_opportunities set status=case when reason in ('opted_out','purchased','expired') then reason else 'handoff' end,
       last_error=reason,updated_at=now() where id=candidate.id and status=candidate.status;
   end if;
 end loop;
 return jsonb_build_object('processed',n);
end $$;
create or replace function public.office_capture_discover() returns jsonb language sql security invoker set search_path='' as $$
 select public.office_capture_discover(gen_random_uuid())
$$;
revoke all on function public.office_capture_discover(uuid) from public,anon,authenticated,service_role;
grant execute on function public.office_capture_discover(uuid) to service_role;

create function public.office_autonomy_snapshot(p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare since_ timestamptz:=date_trunc('day',now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
begin
 perform public.office_actor(p_actor);
 return jsonb_build_object(
 'rules',(select coalesce(jsonb_agg(to_jsonb(r)-'updated_by' order by department,action,channel,account),'[]') from public.office_autonomy_rules r),
 'usage',(select coalesce(jsonb_agg(to_jsonb(g) order by g.action,g.channel),'[]') from
   (select action,channel,count(*) operations,sum(budget_usd) reserved_usd from public.office_autonomy_usage
    where started_at>=since_ group by action,channel) g),
 'estimated_usd',(select coalesce(sum(coalesce(nullif(usage->>'estimated_cost_usd','')::numeric,nullif(usage->>'cost_usd','')::numeric)),0)
   from public.office_run_attempts where claimed_at>=since_ and step<2),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by channel,account),'[]') from (
   select distinct o.channel,o.account_id account from public.office_capture_opportunities o
   union select 'instagram',p.persisted_account_id from public.office_instagram_posts p
   union select c.provider,c.account_id from public.tc_social_connections_v2 c where c.provider in ('instagram','facebook') and c.account_id is not null
   ) a where a.account<>''),
 'as_of',now());
end $$;

revoke all on function public.office_autonomy_departments(text),public.office_autonomy_check(text,text,text,text,boolean),
 public.office_autonomy_creative(uuid,uuid),public.office_autonomy_ig_prepare(uuid,uuid),
 public.office_autonomy_hold(uuid,text,boolean,int),public.office_autonomy_set(uuid,jsonb,int),public.office_autonomy_snapshot(uuid),public.office_autonomy_dispatch(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.office_autonomy_departments(text),public.office_autonomy_check(text,text,text,text,boolean),
 public.office_autonomy_creative(uuid,uuid),public.office_autonomy_ig_prepare(uuid,uuid),
 public.office_autonomy_hold(uuid,text,boolean,int),public.office_autonomy_set(uuid,jsonb,int),public.office_autonomy_snapshot(uuid),public.office_autonomy_dispatch(uuid,uuid,uuid) to service_role;
commit;
