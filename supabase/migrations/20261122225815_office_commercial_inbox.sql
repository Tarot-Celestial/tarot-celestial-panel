begin;
create table public.office_commercial_cases (
  opportunity_id uuid primary key references public.office_capture_opportunities(id),
  state text not null check (state in ('open','claimed','resolved','returned')),
  reason text not null, opened_at timestamptz not null, updated_at timestamptz not null default now(),
  owner_id uuid references public.workers(id), outcome text, note text, returned_at timestamptz,
  version integer not null default 1 check(version>0)
);
create index office_commercial_queue on public.office_commercial_cases(state,opened_at,opportunity_id);
create index office_commercial_peers on public.office_capture_opportunities(channel,account_id,recipient_id) where verified and recipient_id is not null;
create index office_commercial_map_events on public.office_capture_events(id desc) where action in ('handoff','commercial_returned');
create table public.office_commercial_changes (
  request_id uuid primary key, opportunity_id uuid not null references public.office_commercial_cases(opportunity_id),
  actor_id uuid not null references public.workers(id), action text not null, input jsonb not null,
  result jsonb not null, created_at timestamptz not null default now()
);
alter table public.office_commercial_cases enable row level security;
alter table public.office_commercial_changes enable row level security;
revoke all on public.office_commercial_cases,public.office_commercial_changes from public,anon,authenticated,service_role;
grant select,insert,update on public.office_commercial_cases to service_role;
grant select,insert on public.office_commercial_changes to service_role;

-- Separate native platforms may share an identity only through a verified CRM link.
create function public.office_commercial_related(p_opportunity uuid) returns table(id uuid)
language sql stable security invoker set search_path='' as $$
  with origin as (select * from public.office_capture_opportunities where id=p_opportunity)
  select o.id from origin o
  union select x.id from origin o join public.office_capture_opportunities x on x.client_id=o.client_id
  union select x.id from origin o join public.office_capture_opportunities x
    on (o.channel,o.account_id,o.recipient_id)=(x.channel,x.account_id,x.recipient_id) where o.verified and x.verified
$$;
create function public.office_commercial_blocked(p_opportunity uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select from public.office_commercial_cases c join public.office_commercial_related(p_opportunity) r on r.id=c.opportunity_id
   where c.state in ('open','claimed','resolved'))
$$;
create function public.office_commercial_last_return(p_opportunity uuid) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select max(c.returned_at) from public.office_commercial_cases c join public.office_commercial_related(p_opportunity) r on r.id=c.opportunity_id
$$;

-- A short transaction fence serializes transfers with the irrevocable dispatch
-- marker. No provider call or customer message is made under this lock.
create function public.office_commercial_fence() returns trigger language plpgsql security invoker set search_path='' as $$
declare released timestamptz;
begin
 if new.status='dispatching' and old.status is distinct from new.status then
   perform pg_advisory_xact_lock(1772026,71);
   if public.office_commercial_blocked(old.id) then raise exception 'OFFICE_COMMERCIAL_ACTIVE'; end if;
 elsif old.status='handoff' and new.status='handoff' and new.verified and old.source_id<>new.source_id and new.latest_inbound_at>old.latest_inbound_at then
   released:=public.office_commercial_last_return(old.id);
   if released is not null and new.latest_inbound_at>released and not public.office_commercial_blocked(old.id) then
     new.status:=case when new.window_until>clock_timestamp() then 'pending' else 'expired' end;
     new.last_error:=null;
   end if;
 end if;
 return new;
end $$;
create trigger office_commercial_fence before update of status,source_id on public.office_capture_opportunities
for each row execute function public.office_commercial_fence();

create function public.office_commercial_record() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.action='handoff' then
   if new.detail='commercial_wait_new_inbound' then return new; end if;
   perform pg_advisory_xact_lock(1772026,71);
   if new.detail='commercial_intervention' and public.office_commercial_blocked(new.opportunity_id) then return new; end if;
   insert into public.office_commercial_cases as c(opportunity_id,state,reason,opened_at)
   values(new.opportunity_id,'open',coalesce(new.detail,'review_needed'),new.created_at)
   on conflict(opportunity_id) do update set state='open',reason=excluded.reason,opened_at=excluded.opened_at,
     owner_id=null,note=null,outcome=null,updated_at=now(),version=c.version+1 where c.state='returned';
 elsif new.action in ('purchased','opted_out') then
   update public.office_commercial_cases set state='resolved',outcome=new.action,updated_at=new.created_at,version=version+1
    where opportunity_id=new.opportunity_id and state in ('open','claimed');
 end if;
 return new;
end $$;
create trigger office_commercial_record after insert on public.office_capture_events for each row execute function public.office_commercial_record();

-- Until an operator explicitly returns the conversation to Atlas, a customer who
-- writes again after a human resolution comes back to that operator's active list.
create function public.office_commercial_reopen() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.verified and new.source_id<>old.source_id and new.latest_inbound_at>old.latest_inbound_at then
   update public.office_commercial_cases c set
     state=case when exists(select from public.workers w where w.id=c.owner_id and w.is_active is true) then 'claimed' else 'open' end,
     owner_id=case when exists(select from public.workers w where w.id=c.owner_id and w.is_active is true) then c.owner_id end,
     reason='new_inbound',outcome=null,note=null,opened_at=new.latest_inbound_at,updated_at=now(),version=c.version+1
   where c.opportunity_id=new.id and c.state='resolved' and c.outcome not in ('opted_out','purchased') and new.latest_inbound_at>c.updated_at;
 end if;
 return new;
end $$;
create trigger office_commercial_reopen after update of source_id on public.office_capture_opportunities
for each row execute function public.office_commercial_reopen();

-- Preserve the actual handoff timestamp, including cases which have since converted.
insert into public.office_commercial_cases(opportunity_id,state,reason,opened_at,outcome,updated_at)
select o.id,case when o.status in ('opted_out','purchased') then 'resolved' else 'open' end,
 coalesce(h.detail,o.last_error,'review_needed'),coalesce(h.created_at,o.updated_at),
 case when o.status in ('opted_out','purchased') then o.status end,o.updated_at
from public.office_capture_opportunities o left join lateral (select e.detail,e.created_at from public.office_capture_events e
  where e.opportunity_id=o.id and e.action='handoff' order by e.created_at desc,e.id desc limit 1) h on true
where o.status='handoff' or (o.status in ('opted_out','purchased') and h.created_at is not null)
on conflict do nothing;

create function public.office_commercial_actor(p_actor uuid) returns table(worker_id uuid,admin_access boolean,native_access boolean,role text)
language sql stable security invoker set search_path='' as $$
 select w.id,public.tc_has_admin_access(p_actor) is true,w.role in ('central','admin'),w.role::text from public.workers w
 where w.user_id=p_actor and w.is_active is true and (w.role='central' or public.tc_has_admin_access(p_actor) is true)
 order by w.id limit 1
$$;

create function public.office_commercial_page(p_actor uuid,p_filter text,p_at timestamptz,p_after uuid,p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a record; result jsonb; target uuid:=p_id;
begin
 select * into a from public.office_commercial_actor(p_actor);
 if not found then raise exception 'OFFICE_FORBIDDEN'; end if;
 if p_filter is null or p_filter not in ('active','open','mine','resolved','returned','all') or (p_at is null)<>(p_after is null) then raise exception 'OFFICE_INVALID'; end if;
 -- The monthly attribution view identifies forms before the capture backfill runs.
 -- Resolve only a unique, existing handoff. Mutations always take its native UUID.
 if p_id is not null and not exists(select from public.office_commercial_cases where opportunity_id=p_id) then
   if not exists(select from public.office_capture_opportunities where id=p_id) then
     select (array_agg(o.id))[1] into target from public.office_capture_opportunities o
     where o.channel='meta_form' and o.kind='form' and o.lead_id is not null and o.thread_key='lead:'||o.lead_id
       and md5(jsonb_build_array('tc:meta:form',o.account_id,o.lead_id)::text)::uuid=p_id having count(*)=1;
   end if;
   if target is not null and not exists(select from public.office_commercial_cases where opportunity_id=target) then
     select (array_agg(c.opportunity_id))[1] into target from public.office_capture_opportunities o
     cross join lateral public.office_commercial_related(o.id) r join public.office_commercial_cases c on c.opportunity_id=r.id
     where o.id=target and o.status='handoff' and ((o.last_error='commercial_intervention' and c.state<>'returned') or
       (o.last_error='commercial_wait_new_inbound' and c.state='returned')) having count(*)=1;
   end if;
 end if;
 with page as materialized (
   select c.*,o.channel,o.kind,o.name,o.source_at,o.latest_inbound_at,o.status capture_status,o.thread_id,o.lead_id,
     case when o.channel='whatsapp' and a.native_access and o.session_id in ('central','w-'||a.worker_id) then o.recipient_id end wa_peer,
     case when o.channel='whatsapp' and a.native_access and o.session_id in ('central','w-'||a.worker_id) then o.account_id end wa_account,
     case when o.channel='whatsapp' and a.native_access and o.session_id in ('central','w-'||a.worker_id) then o.session_id end wa_session,w.display_name owner_name
   from public.office_commercial_cases c join public.office_capture_opportunities o on o.id=c.opportunity_id left join public.workers w on w.id=c.owner_id
   where (p_id is null or c.opportunity_id=target) and (p_id is not null or case p_filter
     when 'active' then c.state in ('open','claimed') when 'mine' then c.state='claimed' and c.owner_id=a.worker_id
     when 'all' then true else c.state=p_filter end)
     and (p_at is null or (c.opened_at,c.opportunity_id)>(p_at,p_after))
   order by c.opened_at,c.opportunity_id limit 26
 ), visible as (select * from page order by opened_at,opportunity_id limit 25)
 select jsonb_build_object('actor_id',a.worker_id,'is_admin',a.admin_access,'native_access',a.native_access,
   'central_path',case when a.role='central' then '/panel-central' else '/admin/central' end,
   'items',coalesce((select jsonb_agg(to_jsonb(v) order by opened_at,opportunity_id) from visible v),'[]'::jsonb),
   'next',case when (select count(*) from page)>25 then (select jsonb_build_object('at',opened_at,'id',opportunity_id) from visible
     order by opened_at desc,opportunity_id desc limit 1) end) into result;
 return result;
end $$;

create function public.office_commercial_change(p_actor uuid,p_id uuid,p_request uuid,p_version integer,p_action text,p_outcome text,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a record; c public.office_commercial_cases; o public.office_capture_opportunities; prior public.office_commercial_changes;
 arguments jsonb; response jsonb; reason text;
begin
 select * into a from public.office_commercial_actor(p_actor);
 if not found then raise exception 'OFFICE_FORBIDDEN'; end if;
 if p_request is null or p_id is null or p_version is null or p_version<1 or p_action is null or p_action not in ('claim','release','resolve','return')
   or length(coalesce(p_note,''))>600 or (p_action='resolve' and (p_outcome is null or p_outcome not in ('answered','appointment','no_interest','unreachable','other')))
   or (p_action<>'resolve' and p_outcome is not null) or (p_outcome='other' and nullif(trim(p_note),'') is null) then raise exception 'OFFICE_INVALID'; end if;
 arguments:=jsonb_build_array(p_version,p_action,p_outcome,coalesce(trim(p_note),''));
 select * into o from public.office_capture_opportunities where id=p_id for update;
 if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(1772026,71);
 select * into prior from public.office_commercial_changes where request_id=p_request;
 if found then
   if prior.opportunity_id<>p_id or prior.actor_id<>a.worker_id or prior.input<>arguments then raise exception 'OFFICE_CONFLICT'; end if;
   return prior.result;
 end if;
 select * into c from public.office_commercial_cases where opportunity_id=p_id for update;
 if not found then raise exception 'OFFICE_NOT_FOUND'; end if;
 if c.version<>p_version then raise exception 'OFFICE_CONFLICT'; end if;
 if p_action='claim' then
   if c.state<>'open' or exists(select from public.office_commercial_cases x join public.office_commercial_related(p_id) r on r.id=x.opportunity_id
    where x.state='claimed' and x.owner_id<>a.worker_id) then raise exception 'OFFICE_CONFLICT'; end if;
   if exists(select from public.office_commercial_related(p_id) r join public.office_capture_opportunities x on x.id=r.id where x.status='dispatching') then raise exception 'OFFICE_DISPATCH_ACTIVE'; end if;
   update public.office_commercial_cases set state='claimed',owner_id=a.worker_id where opportunity_id=p_id;
 else
   if not a.admin_access and c.owner_id is distinct from a.worker_id then raise exception 'OFFICE_FORBIDDEN'; end if;
   if p_action='release' then
     if c.state<>'claimed' then raise exception 'OFFICE_CONFLICT'; end if;
     update public.office_commercial_cases set state='open',owner_id=null where opportunity_id=p_id;
   elsif p_action='resolve' then
     if c.state<>'claimed' then raise exception 'OFFICE_CONFLICT'; end if;
     update public.office_commercial_cases set state='resolved',outcome=p_outcome,note=nullif(trim(p_note),'') where opportunity_id=p_id;
   else
     if c.state not in ('claimed','resolved') then raise exception 'OFFICE_CONFLICT'; end if;
     if o.opted_out or o.status in ('purchased','opted_out','uncertain','dispatching') or exists(
       select from public.office_capture_suppressions s where s.client_id=o.client_id or
       (s.channel,s.account_id,s.peer_id)=(o.channel,o.account_id,coalesce(o.recipient_id,o.thread_key))) or
       (o.client_id is not null and exists(select from public.tc_crm_first_purchases_batch(array[o.client_id]))) then raise exception 'OFFICE_RETURN_UNAVAILABLE'; end if;
     update public.office_commercial_cases set state='returned',returned_at=clock_timestamp() where opportunity_id=p_id;
   end if;
 end if;
 update public.office_commercial_cases set updated_at=clock_timestamp(),version=version+1 where opportunity_id=p_id returning * into c;
 response:=jsonb_build_object('state',c.state,'version',c.version);
 insert into public.office_commercial_changes(request_id,opportunity_id,actor_id,action,input,result) values(p_request,p_id,a.worker_id,p_action,arguments,response);
 insert into public.office_capture_events(opportunity_id,action,detail,request_id)
 values(p_id,'commercial_'||case p_action when 'claim' then 'claimed' when 'release' then 'released' when 'resolve' then 'resolved' else 'returned' end,p_outcome,p_request);
 return response;
end $$;

create or replace function public.office_capture_guard(p_id uuid,p_check_purchase boolean default true) returns text language plpgsql stable security invoker set search_path='' as $$
declare o public.office_capture_opportunities; t public.office_capture_social_threads; released timestamptz;
begin
 select * into strict o from public.office_capture_opportunities where id=p_id;
 if o.opted_out or exists(select 1 from public.office_capture_suppressions s where
   (o.client_id is not null and s.client_id=o.client_id) or (s.channel,s.account_id,s.peer_id)=(o.channel,o.account_id,coalesce(o.recipient_id,o.thread_key)))
   then return 'opted_out'; end if;
 if p_check_purchase and o.client_id is not null and exists(select 1 from public.tc_crm_first_purchases_batch(array[o.client_id])) then return 'purchased'; end if;
 if public.office_commercial_blocked(p_id) then return 'commercial_intervention'; end if;
 released:=public.office_commercial_last_return(p_id);
 if released is not null and o.latest_inbound_at<=released then return 'commercial_wait_new_inbound'; end if;
 if not o.verified then return 'unverified_inbound'; end if;
 if o.window_until<=clock_timestamp() then return 'expired'; end if;
 if o.channel in ('instagram','facebook') then
   -- Facebook validates its environment-bound page via Graph; Instagram uses its stored OAuth account.
   if o.channel='instagram' and not exists(select 1 from public.tc_social_connections_v2 where provider=o.channel and account_id=o.account_id) then return 'connection_changed'; end if;
   select * into t from public.office_capture_social_threads where channel=o.channel and id=o.thread_id and account_id=o.account_id and kind=o.kind and thread_key=o.thread_key;
   if not found or (o.kind='message' and (t.recipient_id is null or t.recipient_id<>o.thread_key)) then return 'unverified_thread'; end if;
   if not exists(select 1 from public.tc_social_inbox_activity a where (a.provider,a.account_id,a.kind,a.remote_id,a.thread_remote_id)=
     (o.channel,o.account_id,o.kind,o.source_id,o.thread_key) and a.removed_at is null) then return 'source_removed'; end if;
   if o.kind='comment' and (o.thread_key<>o.source_id or t.private_reply_sent) then return 'comment_managed'; end if;
   -- Native receipts from staff, including ambiguous dispatches, pause the whole thread.
   if o.channel='instagram' and exists(select 1 from public.tc_instagram_sends s where s.thread_id=o.thread_id
     and (s.status in ('uncertain','sending') or (s.status in ('sent','confirmed_sent') and (released is null or coalesce(s.completed_at,s.created_at)>=released))) and not exists(select 1 from public.office_capture_attempts a where a.request_id=s.request_id))
     then return 'human_takeover'; end if;
   if o.channel='facebook' and exists(select 1 from public.tc_facebook_sends s where s.thread_id=o.thread_id
     and (s.status in ('uncertain','sending') or (s.status in ('sent','confirmed_sent') and (released is null or coalesce(s.completed_at,s.created_at)>=released))) and not exists(select 1 from public.office_capture_attempts a where a.request_id=s.request_id))
     then return 'human_takeover'; end if;
   if t.last_reply_at>=o.latest_inbound_at then return 'already_answered'; end if;
 elsif o.channel='meta_form' then
   if not o.whatsapp_consent then return 'whatsapp_consent_missing'; end if;
   if not exists(select 1 from public.captacion_leads l where l.id=o.lead_id and l.cliente_id=o.client_id
     and lower(coalesce(l.estado,'')) not in ('cliente','captado','no_interesado','numero_invalido','perdido','cerrado','finalizado')
     and l.closed_at is null and coalesce(greatest(l.contacted_at,l.last_contact_at),'-infinity')<o.latest_inbound_at) then return 'lead_managed'; end if;
   if exists(select 1 from public.captacion_whatsapp_deliveries d where d.lead_id=o.lead_id and d.submission_key='meta:'||o.source_id)
     then return 'already_answered'; end if;
 end if;
 return null;
end $$;

create or replace function public.office_capture_record_whatsapp(p_account text,p_session text,p_rows jsonb) returns int
language plpgsql security invoker set search_path='' as $$
declare e record; opportunity uuid; n int:=0; known boolean;
begin
 if p_session !~ '^(central|w-[a-zA-Z0-9_-]{1,60})$' or p_account !~ '^[0-9]+(:[0-9]+)?@(s\.whatsapp\.net|lid)$'
   or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'OFFICE_CAPTURE_INVALID'; end if;
 for e in select * from jsonb_to_recordset(p_rows) as x(thread_key text,source_id text,source_at timestamptz,
    body text,name text,business_interest boolean,last_own_id text,last_own_at timestamptz)
    order by x.source_at,x.source_id
 loop
   if e.thread_key !~ '^([1-9][0-9]{7,14}@s\.whatsapp\.net|[1-9][0-9]{0,29}@lid)$' or
     e.thread_key=regexp_replace(p_account,':[0-9]+@','@') or nullif(trim(e.body),'') is null then continue; end if;
   select exists(select 1 from public.office_capture_opportunities where channel='whatsapp' and kind='message'
     and account_id=p_account and thread_key=e.thread_key and session_id=p_session) into known;
   if not known and e.business_interest is not true then
     if public.office_capture_stop_text(e.body) then perform public.office_capture_suppress('whatsapp',p_account,e.thread_key,null); end if;
     continue;
   end if;
   if exists(select 1 from public.office_capture_opportunities where channel='whatsapp' and kind='message'
     and account_id=p_account and thread_key=e.thread_key and session_id is distinct from p_session) then continue; end if;
   opportunity:=public.office_capture_store('whatsapp',p_account,'message',e.thread_key,e.source_id,e.source_at,e.body,true,null,
     e.thread_key,e.name,p_session,null,null,null,false);
   if e.last_own_id is not null and (e.last_own_at is null or e.last_own_at>=coalesce(public.office_commercial_last_return(opportunity),'-infinity')) and not exists(select 1 from public.office_capture_attempts a where a.opportunity_id=opportunity
        and a.outcome='sent' and a.receipt_id=e.last_own_id) then
     update public.office_capture_opportunities set status='handoff',last_error='human_takeover',lease_token=null,lease_until=null,updated_at=now()
       where id=opportunity and status in ('pending','claimed','sent','failed','blocked');
   end if;
   n:=n+1;
 end loop;
 return n;
end $$;

revoke all on function public.office_commercial_related(uuid),public.office_commercial_blocked(uuid),public.office_commercial_last_return(uuid),
 public.office_commercial_fence(),public.office_commercial_record(),public.office_commercial_reopen(),public.office_commercial_actor(uuid),
 public.office_commercial_page(uuid,text,timestamptz,uuid,uuid),public.office_commercial_change(uuid,uuid,uuid,integer,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.office_commercial_related(uuid),public.office_commercial_blocked(uuid),public.office_commercial_last_return(uuid),
 public.office_commercial_fence(),public.office_commercial_record(),public.office_commercial_reopen(),public.office_commercial_actor(uuid),
 public.office_commercial_page(uuid,text,timestamptz,uuid,uuid),public.office_commercial_change(uuid,uuid,uuid,integer,text,text,text) to service_role;
commit;
