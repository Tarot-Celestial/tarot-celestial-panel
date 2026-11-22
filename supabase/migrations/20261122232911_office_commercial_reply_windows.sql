begin;

-- A comment reviewed as a non-inquiry stays closed on that specific source.
-- A different, later conversation by the same person can express new interest.
create or replace function public.office_commercial_blocked(p_opportunity uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(
    select from public.office_commercial_cases c
    join public.office_commercial_related(p_opportunity) r on r.id=c.opportunity_id
    where c.state in ('open','claimed','resolved')
      and (c.state<>'resolved' or c.outcome is distinct from 'no_inquiry')
  )
$$;

-- The current source remains held. Only a later verified inbound may start work.
create or replace function public.office_commercial_last_return(p_opportunity uuid) returns timestamptz
language sql stable security invoker set search_path='' as $$
  select max(case when c.state='resolved' and c.outcome='no_inquiry' then c.updated_at else c.returned_at end)
  from public.office_commercial_cases c
  join public.office_commercial_related(p_opportunity) r on r.id=c.opportunity_id
$$;

create or replace function public.office_commercial_record() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.action='handoff' then
   if new.detail='commercial_wait_new_inbound' then return new; end if;
   perform pg_advisory_xact_lock(1772026,71);
   if new.detail='commercial_intervention' and public.office_commercial_blocked(new.opportunity_id) then return new; end if;
   insert into public.office_commercial_cases as c(opportunity_id,state,reason,opened_at)
   values(new.opportunity_id,'open',coalesce(new.detail,'review_needed'),new.created_at)
   on conflict(opportunity_id) do update set state='open',reason=excluded.reason,opened_at=excluded.opened_at,
     owner_id=null,note=null,outcome=null,updated_at=now(),version=c.version+1 where c.state='returned'
       or (c.state='resolved' and c.outcome='no_inquiry' and exists(
         select from public.office_capture_opportunities o where o.id=c.opportunity_id
           and o.verified and o.latest_inbound_at>c.updated_at));
 elsif new.action in ('purchased','opted_out') then
   update public.office_commercial_cases set state='resolved',outcome=new.action,updated_at=new.created_at,version=version+1
    where opportunity_id=new.opportunity_id and state in ('open','claimed');
 end if;
 return new;
end $$;

create or replace function public.office_commercial_reopen() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.verified and new.source_id<>old.source_id and new.latest_inbound_at>old.latest_inbound_at then
   update public.office_commercial_cases c set
     state=case when exists(select from public.workers w where w.id=c.owner_id and w.is_active is true) then 'claimed' else 'open' end,
     owner_id=case when exists(select from public.workers w where w.id=c.owner_id and w.is_active is true) then c.owner_id end,
     reason='new_inbound',outcome=null,note=null,opened_at=new.latest_inbound_at,updated_at=now(),version=c.version+1
   where c.opportunity_id=new.id and c.state='resolved' and c.outcome not in ('opted_out','purchased','no_inquiry') and new.latest_inbound_at>c.updated_at;
 end if;
 return new;
end $$;

create or replace function public.office_commercial_page(p_actor uuid,p_filter text,p_at timestamptz,p_after uuid,p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a record; result jsonb; target uuid:=p_id;
begin
 select * into a from public.office_commercial_actor(p_actor);
 if not found then raise exception 'OFFICE_FORBIDDEN'; end if;
 if p_filter is null or p_filter not in ('active','open','mine','resolved','returned','all','reply_window') or (p_at is null)<>(p_after is null) then raise exception 'OFFICE_INVALID'; end if;
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
     case when o.verified and not o.opted_out and o.kind in ('message','comment') then o.window_until end reply_until,
     case when p_filter='reply_window' then o.window_until else c.opened_at end page_at,
     case when o.channel='whatsapp' and a.native_access and o.session_id in ('central','w-'||a.worker_id) then o.recipient_id end wa_peer,
     case when o.channel='whatsapp' and a.native_access and o.session_id in ('central','w-'||a.worker_id) then o.account_id end wa_account,
     case when o.channel='whatsapp' and a.native_access and o.session_id in ('central','w-'||a.worker_id) then o.session_id end wa_session,w.display_name owner_name
   from public.office_commercial_cases c join public.office_capture_opportunities o on o.id=c.opportunity_id left join public.workers w on w.id=c.owner_id
   where (p_id is null or c.opportunity_id=target) and (p_id is not null or case p_filter
     when 'active' then c.state in ('open','claimed') when 'mine' then c.state='claimed' and c.owner_id=a.worker_id
     when 'reply_window' then c.state in ('open','claimed') and (c.state='open' or c.owner_id=a.worker_id or a.admin_access)
       and o.verified and not o.opted_out and o.status='handoff' and o.kind in ('message','comment') and o.window_until>now()
       and lower(c.reason) in ('needs_personal_response','autonomy_handoff','new_inbound','review_needed')
       and a.native_access and (o.channel in ('instagram','facebook') and o.thread_id is not null
         or o.channel='whatsapp' and o.session_id in ('central','w-'||a.worker_id) and o.recipient_id is not null)
     when 'all' then true else c.state=p_filter end)
     and (p_at is null or ((case when p_filter='reply_window' then o.window_until else c.opened_at end),c.opportunity_id)>(p_at,p_after))
   order by page_at,c.opportunity_id limit 26
 ), visible as (select * from page order by page_at,opportunity_id limit 25)
 select jsonb_build_object('actor_id',a.worker_id,'is_admin',a.admin_access,'native_access',a.native_access,
   'central_path',case when a.role='central' then '/panel-central' else '/admin/central' end,
   'items',coalesce((select jsonb_agg((to_jsonb(v)-'page_at') order by page_at,opportunity_id) from visible v),'[]'::jsonb),
   'next',case when (select count(*) from page)>25 then (select jsonb_build_object('at',page_at,'id',opportunity_id) from visible
     order by page_at desc,opportunity_id desc limit 1) end) into result;
 return result;
end $$;

create or replace function public.office_commercial_change(p_actor uuid,p_id uuid,p_request uuid,p_version integer,p_action text,p_outcome text,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a record; c public.office_commercial_cases; o public.office_capture_opportunities; prior public.office_commercial_changes;
 arguments jsonb; response jsonb; reason text;
begin
 select * into a from public.office_commercial_actor(p_actor);
 if not found then raise exception 'OFFICE_FORBIDDEN'; end if;
 if p_request is null or p_id is null or p_version is null or p_version<1 or p_action is null or p_action not in ('claim','release','resolve','return')
   or length(coalesce(p_note,''))>600 or (p_action='resolve' and (p_outcome is null or p_outcome not in ('answered','appointment','no_interest','no_inquiry','unreachable','other')))
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

commit;
