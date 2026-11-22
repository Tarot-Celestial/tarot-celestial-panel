begin;
create table public.office_capture_opportunities(
  id uuid primary key default gen_random_uuid(), channel text not null check(channel in ('instagram','facebook','whatsapp','meta_form')),
  kind text not null check(kind in ('message','comment','form')), account_id text not null, thread_key text not null,
  source_id text not null, source_at timestamptz not null, latest_inbound_at timestamptz not null, window_until timestamptz not null,
  thread_id uuid, recipient_id text, session_id text, name text, inbound_text text, verified boolean not null default false,
  client_id uuid references public.crm_clientes(id), lead_id uuid references public.captacion_leads(id),
  market text, whatsapp_consent boolean not null default false, opted_out boolean not null default false,
  status text not null default 'pending' check(status in ('pending','claimed','dispatching','sent','expired','handoff','blocked','failed','uncertain','opted_out','purchased')),
  request_id uuid not null default gen_random_uuid(), claimed_by uuid, lease_token uuid, lease_until timestamptz, last_error text, receipt_id text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(channel,account_id,kind,thread_key)
);
create index office_capture_claimable on public.office_capture_opportunities(latest_inbound_at,id) where status='pending';
create index office_capture_client on public.office_capture_opportunities(client_id) where client_id is not null;
create table public.office_capture_inbound(
  id bigint generated always as identity primary key,opportunity_id uuid not null references public.office_capture_opportunities(id),
  channel text not null,account_id text not null,kind text not null,thread_key text not null,source_id text not null,
  source_at timestamptz not null,recipient_id text,inbound_text text,verified boolean not null,created_at timestamptz not null default now(),
  unique(channel,account_id,kind,source_id)
);
create index office_capture_incoming_order on public.office_capture_inbound(opportunity_id,source_at desc,source_id desc);
create table public.office_capture_events(
  id bigint generated always as identity primary key,opportunity_id uuid not null references public.office_capture_opportunities(id),
  action text not null,detail text,request_id uuid,receipt_id text,created_at timestamptz not null default now()
);
create index office_capture_events_by_opportunity on public.office_capture_events(opportunity_id,created_at desc);
create index office_capture_sent_requests on public.office_capture_events(request_id) where request_id is not null;
create table public.office_capture_suppressions(
  channel text not null,account_id text not null,peer_id text not null,client_id uuid references public.crm_clientes(id),
  created_at timestamptz not null default now(), primary key(channel,account_id,peer_id)
);
create table public.office_capture_attempts(
  request_id uuid primary key,opportunity_id uuid not null references public.office_capture_opportunities(id),
  source_id text not null,actor_user_id uuid not null,body text not null,route text not null,created_at timestamptz not null default now(),
  outcome text,receipt_id text,completed_at timestamptz
);
alter table public.office_capture_opportunities enable row level security;
alter table public.office_capture_inbound enable row level security;
alter table public.office_capture_events enable row level security;
alter table public.office_capture_suppressions enable row level security;
alter table public.office_capture_attempts enable row level security;
revoke all on public.office_capture_opportunities,public.office_capture_inbound,public.office_capture_events,public.office_capture_suppressions,public.office_capture_attempts from public,anon,authenticated;
grant select,insert,update on public.office_capture_opportunities,public.office_capture_inbound,public.office_capture_attempts to service_role;
grant select,insert on public.office_capture_events,public.office_capture_suppressions to service_role;
grant usage,select on sequence public.office_capture_events_id_seq,public.office_capture_inbound_id_seq to service_role;

create function public.office_capture_event() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.office_capture_events(opportunity_id,action) values(new.id,'discovered');
  end if;
  if (tg_op='INSERT' and new.status<>'pending') or (tg_op='UPDATE' and old.status is distinct from new.status) then
    insert into public.office_capture_events(opportunity_id,action,request_id,receipt_id,detail)
      values(new.id,new.status,new.request_id,new.receipt_id,new.last_error);
  end if;
  return new;
end $$;
create trigger office_capture_history after insert or update of status on public.office_capture_opportunities
for each row execute function public.office_capture_event();

create view public.office_capture_social_threads with (security_invoker=true) as
  select 'instagram'::text channel,t.account_id,t.kind,t.id,t.recipient_id,
    case when t.kind='message' then coalesce(t.recipient_id,'unverified:'||t.id) else t.remote_id end thread_key,
    t.name,t.remote_created_at,t.remote_updated_at,t.last_reply_at,t.private_reply_sent
  from public.tc_instagram_threads t where t.merged_into is null
  union all select 'facebook',t.account_id,t.kind,t.id,t.recipient_id,
    case when t.kind='message' then coalesce(t.recipient_id,t.remote_id) else t.remote_id end,
    t.name,t.remote_created_at,t.remote_updated_at,t.last_reply_at,t.private_reply_sent
  from public.tc_facebook_threads t where not t.is_deleted;
revoke all on public.office_capture_social_threads from public,anon,authenticated;
grant select on public.office_capture_social_threads to service_role;

-- The source adapters below supply verified channel identifiers. Text is never put in the
-- existing Realtime attention feed, which deliberately contains only unread metadata.
create function public.office_capture_stop_text(p_body text) returns boolean language sql immutable strict set search_path='' as $$
 select lower(trim(p_body)) ~ '^(stop|unsubscribe|baja|b[oó]rrame|no me interesa|cancelar suscripci[oó]n)([[:space:][:punct:]]|$)|\m(no (me )?(escriban|escribas|contacten|contactes|env[ií]en|manden)|no quiero (m[aá]s )?(mensajes|publicidad|promociones)|dejen de escribirme|do not (contact|message|text) me|stop (texting|messaging))\M';
$$;

create function public.office_capture_suppress(p_channel text,p_account text,p_peer text,p_client uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.office_capture_suppressions(channel,account_id,peer_id,client_id) values(p_channel,p_account,p_peer,p_client) on conflict do nothing;
 update public.office_capture_opportunities x set opted_out=true,status=case when status in ('dispatching','uncertain') then status else 'opted_out' end,
   last_error='opted_out',updated_at=now() where not opted_out and ((p_client is not null and x.client_id=p_client)
   or (x.channel,x.account_id,coalesce(x.recipient_id,x.thread_key))=(p_channel,p_account,p_peer));
end $$;

create function public.office_capture_store(p_channel text,p_account text,p_kind text,p_key text,p_source text,p_at timestamptz,
 p_text text,p_verified boolean,p_thread uuid,p_peer text,p_name text,p_session text,p_client uuid,p_lead uuid,p_market text,p_consent boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare o public.office_capture_opportunities; win timestamptz; initial text; seen_id uuid;
begin
 if p_channel not in ('instagram','facebook','meta_form','whatsapp') or p_kind not in ('message','comment','form') or
   length(p_key) not between 1 and 500 or length(p_source) not between 1 and 500 or length(p_account) not between 1 and 500
   or p_at is null or not isfinite(p_at) or p_at>clock_timestamp()+interval '1 minute' then raise exception 'OFFICE_CAPTURE_INVALID'; end if;
 win:=p_at+case when p_kind='comment' then interval '7 days' else interval '24 hours' end;
 initial:=case when win<=now() then 'expired' when not p_verified then 'handoff' else 'pending' end;
 insert into public.office_capture_opportunities(channel,account_id,kind,thread_key,source_id,source_at,latest_inbound_at,window_until,
   inbound_text,verified,thread_id,recipient_id,name,session_id,client_id,lead_id,market,whatsapp_consent,status,last_error)
 values(p_channel,p_account,p_kind,p_key,p_source,p_at,p_at,win,left(p_text,4000),p_verified,p_thread,p_peer,left(p_name,120),p_session,p_client,p_lead,
   left(p_market,80),coalesce(p_consent,false),initial,case when not p_verified then 'unverified_inbound' end)
 on conflict(channel,account_id,kind,thread_key) do nothing;
 select * into strict o from public.office_capture_opportunities where (channel,account_id,kind,thread_key)=(p_channel,p_account,p_kind,p_key) for update;
 if o.recipient_id is not null and p_peer is not null and o.recipient_id<>p_peer then
   raise exception 'OFFICE_CAPTURE_IDENTITY_CONFLICT';
 end if;
 if p_verified then
   insert into public.office_capture_inbound(opportunity_id,channel,account_id,kind,thread_key,source_id,source_at,recipient_id,inbound_text,verified)
   values(o.id,p_channel,p_account,p_kind,p_key,p_source,p_at,p_peer,left(p_text,4000),true)
   on conflict(channel,account_id,kind,source_id) do update set inbound_text=coalesce(nullif(public.office_capture_inbound.inbound_text,''),excluded.inbound_text)
     where public.office_capture_inbound.opportunity_id=excluded.opportunity_id and public.office_capture_inbound.source_at=excluded.source_at
       and public.office_capture_inbound.recipient_id is not distinct from excluded.recipient_id
   returning opportunity_id into seen_id;
   if seen_id is null then raise exception 'OFFICE_CAPTURE_IDENTITY_CONFLICT'; end if;
   if (not o.verified or (p_at,p_source)>(o.latest_inbound_at,o.source_id)) and o.status not in ('dispatching','uncertain') then
     update public.office_capture_opportunities set source_id=p_source,latest_inbound_at=p_at,source_at=case when verified then least(source_at,p_at) else p_at end,
       window_until=win,inbound_text=left(p_text,4000),verified=true,thread_id=coalesce(p_thread,thread_id),recipient_id=coalesce(p_peer,recipient_id),
       name=coalesce(left(p_name,120),name),client_id=coalesce(client_id,p_client),lead_id=coalesce(lead_id,p_lead),market=coalesce(p_market,market),
       whatsapp_consent=coalesce(p_consent,false),request_id=gen_random_uuid(),lease_token=null,lease_until=null,receipt_id=null,
       status=case when status in ('opted_out','purchased') or (status='handoff' and last_error is distinct from 'unverified_inbound') then status else initial end,
       last_error=case when status in ('opted_out','purchased','handoff') and last_error is distinct from 'unverified_inbound' then last_error end,
       updated_at=now() where id=o.id;
   elsif p_source=o.source_id and p_at=o.latest_inbound_at and coalesce(o.inbound_text,'')='' and coalesce(p_text,'')<>'' then
     update public.office_capture_opportunities set inbound_text=left(p_text,4000),updated_at=now() where id=o.id;
   elsif p_at<o.source_at and o.verified then update public.office_capture_opportunities set source_at=p_at where id=o.id;
   end if;
   if p_kind='message' and p_key=p_peer and public.office_capture_stop_text(p_text) then
     perform public.office_capture_suppress(p_channel,p_account,p_peer,o.client_id);
   end if;
 end if;
 return o.id;
end $$;

create function public.office_capture_record_social(p_channel text,p_account text,p_rows jsonb)
returns int language plpgsql security invoker set search_path='' as $$
declare e record; n int:=0;
begin
 if p_channel not in ('instagram','facebook') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'OFFICE_CAPTURE_INVALID'; end if;
 for e in select a.*,t.id thread_id,t.recipient_id,t.name,x.body from jsonb_to_recordset(p_rows) as x(kind text,source_id text,thread_key text,body text)
   join public.tc_social_inbox_activity a on (a.provider,a.account_id,a.kind,a.remote_id,a.thread_remote_id)=(p_channel,p_account,x.kind,x.source_id,x.thread_key)
   join lateral (select * from public.office_capture_social_threads t where (t.channel,t.account_id,t.kind,t.thread_key)=
     (a.provider,a.account_id,a.kind,a.thread_remote_id) order by t.remote_updated_at desc,t.id limit 1) t on true
   where a.removed_at is null order by a.occurred_at,a.id
 loop
   perform public.office_capture_store(e.provider,e.account_id,e.kind,e.thread_remote_id,e.remote_id,e.occurred_at,e.body,true,e.thread_id,
     e.recipient_id,e.name,null,null,null,null,false);
   n:=n+1;
 end loop;
 return n;
end $$;

create function public.office_capture_guard(p_id uuid,p_check_purchase boolean default true) returns text language plpgsql stable security invoker set search_path='' as $$
declare o public.office_capture_opportunities; t public.office_capture_social_threads;
begin
 select * into strict o from public.office_capture_opportunities where id=p_id;
 if o.opted_out or exists(select 1 from public.office_capture_suppressions s where
   (o.client_id is not null and s.client_id=o.client_id) or (s.channel,s.account_id,s.peer_id)=(o.channel,o.account_id,coalesce(o.recipient_id,o.thread_key)))
   then return 'opted_out'; end if;
 if p_check_purchase and o.client_id is not null and exists(select 1 from public.tc_crm_first_purchases_batch(array[o.client_id])) then return 'purchased'; end if;
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
     and s.status in ('sent','confirmed_sent','uncertain','sending') and not exists(select 1 from public.office_capture_attempts a where a.request_id=s.request_id))
     then return 'human_takeover'; end if;
   if o.channel='facebook' and exists(select 1 from public.tc_facebook_sends s where s.thread_id=o.thread_id
     and s.status in ('sent','confirmed_sent','uncertain','sending') and not exists(select 1 from public.office_capture_attempts a where a.request_id=s.request_id))
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

create function public.office_capture_discover() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e record; n int:=0; reason text; candidate record;
begin
 -- Private exact-text ingestions and periodic metadata scans share the same source key.
 for e in select a.*,t.id thread_id,t.recipient_id,t.name from public.tc_social_inbox_activity a
   join lateral (select * from public.office_capture_social_threads t where (t.channel,t.account_id,t.kind,t.thread_key)=
     (a.provider,a.account_id,a.kind,a.thread_remote_id) order by t.remote_updated_at desc,t.id limit 1) t on true
   where a.removed_at is null and a.occurred_at<=now() and not exists(select 1 from public.office_capture_inbound i
     where (i.channel,i.account_id,i.kind,i.source_id)=(a.provider,a.account_id,a.kind,a.remote_id))
   order by a.occurred_at desc,a.id desc limit 250
 loop
   perform public.office_capture_store(e.provider,e.account_id,e.kind,e.thread_remote_id,e.remote_id,e.occurred_at,null,true,e.thread_id,
     e.recipient_id,e.name,null,null,null,null,false); n:=n+1;
 end loop;
 -- Threads imported before the verified inbox ledger remain visible; a preview never opens a reply window.
 for e in select t.* from public.office_capture_social_threads t where not exists(select 1 from public.office_capture_opportunities o
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
   where o.status='sent' and o.kind<>'form' and (i.source_at,i.source_id)>(o.latest_inbound_at,o.source_id) limit 100
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

create function public.office_capture_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; worker uuid; o public.office_capture_opportunities; reason text; attempts int:=0;
begin
 select s.actor_user_id,w.id into actor,worker from public.office_capture_settings s
 join public.workers w on w.user_id=s.actor_user_id and w.is_active is true
 where s.id and s.enabled and public.tc_has_admin_access(s.actor_user_id) is true;
 if actor is null then return null; end if;
 loop
  select * into o from public.office_capture_opportunities where status='pending'
    order by latest_inbound_at,id for update skip locked limit 1;
  if not found or attempts>=20 then return null; end if;
  reason:=public.office_capture_guard(o.id);
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

create function public.office_capture_begin(p_id uuid,p_lease_token uuid,p_body text,p_route text) returns jsonb
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
 insert into public.office_capture_attempts(request_id,opportunity_id,source_id,actor_user_id,body,route)
   values(o.request_id,o.id,o.source_id,actor,p_body,p_route);
 update public.office_capture_opportunities set status='dispatching',last_error=null,lease_until=clock_timestamp()+interval '3 minutes',updated_at=now() where id=o.id returning * into o;
 return to_jsonb(o)||jsonb_build_object('actor_user_id',actor,'actor_worker_id',worker,'submission_key',case when o.kind='form' then 'meta:'||o.source_id end);
end $$;

create function public.office_capture_finish(p_id uuid,p_lease_token uuid,p_outcome text,p_receipt text,p_reason text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.office_capture_opportunities;
begin
 if p_lease_token is null or p_outcome is null or p_outcome not in ('sent','uncertain','blocked','handoff','expired','failed') or length(p_receipt)>500
    or (p_outcome='sent' and nullif(trim(p_receipt),'') is null) then raise exception 'OFFICE_CAPTURE_INVALID'; end if;
 select * into o from public.office_capture_opportunities where id=p_id for update;
 if not found or o.lease_token is distinct from p_lease_token then return false; end if;
 if o.status=p_outcome then return o.receipt_id is not distinct from p_receipt; end if;
 if o.status not in ('claimed','dispatching','uncertain') or (o.status='claimed' and p_outcome in ('sent','uncertain'))
   or (o.status='uncertain' and p_outcome<>'sent') then return false; end if;
 update public.office_capture_attempts set outcome=p_outcome,receipt_id=p_receipt,completed_at=now() where request_id=o.request_id;
 update public.office_capture_opportunities set status=p_outcome,receipt_id=p_receipt,last_error=left(p_reason,300),lease_until=null,updated_at=now() where id=o.id;
 return true;
end $$;

create function public.office_capture_optout(p_id uuid,p_lease_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.office_capture_opportunities;
begin
 select * into o from public.office_capture_opportunities where id=p_id for update;
 if not found or o.status<>'claimed' or p_lease_token is null or o.lease_token is distinct from p_lease_token then return false; end if;
 perform public.office_capture_suppress(o.channel,o.account_id,coalesce(o.recipient_id,o.thread_key),o.client_id);
 return true;
end $$;

-- Called only after a pinned, direct WhatsApp gateway conversation has been read.
-- Personal chats are filtered before storage. Further private messages may attach to
-- an existing business thread only under its original account, peer and session.
create function public.office_capture_record_whatsapp(p_account text,p_session text,p_rows jsonb) returns int
language plpgsql security invoker set search_path='' as $$
declare e record; opportunity uuid; n int:=0; known boolean;
begin
 if p_session !~ '^(central|w-[a-zA-Z0-9_-]{1,60})$' or p_account !~ '^[0-9]+(:[0-9]+)?@(s\.whatsapp\.net|lid)$'
   or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'OFFICE_CAPTURE_INVALID'; end if;
 for e in select * from jsonb_to_recordset(p_rows) as x(thread_key text,source_id text,source_at timestamptz,
    body text,name text,business_interest boolean,last_own_id text)
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
   if e.last_own_id is not null and not exists(select 1 from public.office_capture_attempts a where a.opportunity_id=opportunity
        and a.outcome='sent' and a.receipt_id=e.last_own_id) then
     update public.office_capture_opportunities set status='handoff',last_error='human_takeover',lease_token=null,lease_until=null,updated_at=now()
       where id=opportunity and status in ('pending','claimed','sent','failed','blocked');
   end if;
   n:=n+1;
 end loop;
 return n;
end $$;

revoke all on function public.office_capture_stop_text(text),public.office_capture_suppress(text,text,text,uuid),public.office_capture_event(), public.office_capture_guard(uuid,boolean), public.office_capture_discover(),
  public.office_capture_claim(), public.office_capture_begin(uuid,uuid,text,text), public.office_capture_finish(uuid,uuid,text,text,text),
  public.office_capture_optout(uuid,uuid), public.office_capture_record_social(text,text,jsonb), public.office_capture_record_whatsapp(text,text,jsonb),
  public.office_capture_store(text,text,text,text,text,timestamptz,text,boolean,uuid,text,text,text,uuid,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.office_capture_stop_text(text),public.office_capture_suppress(text,text,text,uuid),public.office_capture_event(), public.office_capture_guard(uuid,boolean), public.office_capture_discover(),
  public.office_capture_claim(), public.office_capture_begin(uuid,uuid,text,text), public.office_capture_finish(uuid,uuid,text,text,text),
  public.office_capture_optout(uuid,uuid), public.office_capture_record_social(text,text,jsonb), public.office_capture_record_whatsapp(text,text,jsonb),
  public.office_capture_store(text,text,text,text,text,timestamptz,text,boolean,uuid,text,text,text,uuid,uuid,text,boolean)
  to service_role;
commit;
