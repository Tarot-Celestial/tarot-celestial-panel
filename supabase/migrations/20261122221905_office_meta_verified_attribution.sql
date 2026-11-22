begin;

create table public.office_meta_panel_links (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  opportunity_id uuid not null references public.office_capture_opportunities(id),
  destination text not null check (destination in ('panel','oracle')),
  channel text not null,account_id text not null,thread_key text not null,recipient_id text not null,contact_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 days'),
  opened_at timestamptz
);
create index office_meta_panel_links_opportunity on public.office_meta_panel_links(opportunity_id);
create table public.office_meta_panel_proofs (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  link_digest text not null references public.office_meta_panel_links(digest),
  client_id uuid not null references public.crm_clientes(id),
  auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '15 minutes')
);
create index office_meta_panel_proofs_link on public.office_meta_panel_proofs(link_digest,expires_at);
create table public.office_meta_verified_clients (
  opportunity_id uuid primary key references public.office_capture_opportunities(id),
  client_id uuid unique not null references public.crm_clientes(id),
  proof_digest text unique not null references public.office_meta_panel_proofs(digest),
  contact_at timestamptz not null,
  channel text not null, account_id text not null, recipient_id text not null, source_id text not null,
  bound_at timestamptz not null default now(),
  unique(channel,account_id,recipient_id), unique(channel,account_id,source_id)
);
alter table public.office_meta_panel_links enable row level security;
alter table public.office_meta_panel_proofs enable row level security;
alter table public.office_meta_verified_clients enable row level security;
revoke all on public.office_meta_panel_links, public.office_meta_panel_proofs, public.office_meta_verified_clients from public, anon, authenticated, service_role;
grant select,insert on public.office_meta_panel_links, public.office_meta_panel_proofs, public.office_meta_verified_clients to service_role;
grant update(opened_at) on public.office_meta_panel_links to service_role;

create function public.office_meta_panel_issue(p_opportunity uuid,p_digest text,p_destination text) returns boolean
language sql volatile security invoker set search_path='' as $$
  with inserted as (
    insert into public.office_meta_panel_links(digest,opportunity_id,destination,channel,account_id,thread_key,recipient_id,contact_at)
    select p_digest,o.id,p_destination,o.channel,o.account_id,o.thread_key,o.recipient_id,observed.first_at from public.office_capture_opportunities o
    join lateral (select min(i.source_at) as first_at from public.office_capture_inbound i where i.opportunity_id=o.id and i.channel=o.channel
      and i.account_id=o.account_id and i.thread_key=o.thread_key and i.recipient_id=o.recipient_id and i.kind='message' and i.verified) observed on observed.first_at is not null
    where o.id=p_opportunity and o.kind='message' and o.channel in ('instagram','facebook','whatsapp')
      and nullif(btrim(o.account_id),'') is not null and nullif(btrim(o.recipient_id),'') is not null
    returning 1
  ) select exists(select 1 from inserted)
$$;
create function public.office_meta_panel_visit(p_digest text) returns text
language sql volatile security invoker set search_path='' as $$
  update public.office_meta_panel_links set opened_at=coalesce(opened_at,now()) where digest=p_digest and expires_at>now() returning destination
$$;

create function public.office_meta_panel_challenge(p_link text,p_code_hash text,p_client uuid,p_user uuid) returns text
language plpgsql volatile security invoker set search_path='' as $$
declare l public.office_meta_panel_links%rowtype; o public.office_capture_opportunities%rowtype; existing uuid;
begin
  select * into l from public.office_meta_panel_links where digest=p_link and opened_at is not null and expires_at>now();
  if not found then return 'unavailable'; end if;
  select * into o from public.office_capture_opportunities where id=l.opportunity_id;
  if (l.channel,l.account_id,l.thread_key,l.recipient_id) is distinct from (o.channel,o.account_id,o.thread_key,o.recipient_id)
     or (select count(*) from public.crm_clientes where auth_user_id=p_user)<>1
     or not exists(select 1 from public.crm_clientes where id=p_client and auth_user_id=p_user)
     or (o.client_id is not null and o.client_id<>p_client) then return 'unavailable'; end if;
  select client_id into existing from public.office_meta_verified_clients where opportunity_id=o.id;
  if existing=p_client then return 'confirmed'; end if;
  if existing is not null or exists(select 1 from public.office_meta_verified_clients where client_id=p_client or
     (channel=o.channel and account_id=o.account_id and recipient_id=o.recipient_id)) then return 'unavailable'; end if;
  -- A second browser/account never invalidates another customer's proof.
  insert into public.office_meta_panel_proofs(digest,link_digest,client_id,auth_user_id) values(p_code_hash,p_link,p_client,p_user)
    on conflict(digest) do nothing;
  if not exists(select 1 from public.office_meta_panel_proofs where digest=p_code_hash and link_digest=p_link
       and client_id=p_client and auth_user_id=p_user and expires_at>now()) then return 'unavailable'; end if;
  return 'pending';
end $$;

create function public.office_meta_panel_confirm(p_opportunity uuid,p_source_id text,p_code text) returns boolean
language plpgsql volatile security invoker set search_path='' as $$
declare proof public.office_meta_panel_proofs%rowtype; original public.office_capture_opportunities%rowtype;
  reply public.office_capture_opportunities%rowtype; h text; inserted uuid;
begin
  if p_code is null or p_code !~ '^TC-[0-9A-F]{12}$' then return false; end if;
  h:=encode(sha256(convert_to(p_code,'UTF8')),'hex');
  select * into proof from public.office_meta_panel_proofs where digest=h;
  if not found then return false; end if;
  select o.* into original from public.office_meta_panel_links l join public.office_capture_opportunities o on o.id=l.opportunity_id
    where l.digest=proof.link_digest and (l.channel,l.account_id,l.thread_key,l.recipient_id)=(o.channel,o.account_id,o.thread_key,o.recipient_id) for update of o;
  select * into reply from public.office_capture_opportunities where id=p_opportunity;
  if not found or original.id is null or original.kind<>'message' or reply.kind<>'message'
    or original.channel not in ('instagram','facebook','whatsapp')
    or (original.channel,original.account_id,original.thread_key,original.recipient_id) is distinct from
       (reply.channel,reply.account_id,reply.thread_key,reply.recipient_id)
    or nullif(trim(reply.recipient_id),'') is null or (original.client_id is not null and original.client_id<>proof.client_id)
    or (reply.client_id is not null and reply.client_id<>proof.client_id) then return false; end if;
  if not exists(select 1 from public.office_capture_inbound i where i.opportunity_id=reply.id and i.source_id=p_source_id
      and i.verified and i.kind='message' and i.channel=reply.channel and i.account_id=reply.account_id and i.thread_key=reply.thread_key
      and i.recipient_id=original.recipient_id
      and upper(trim(i.inbound_text))=p_code and i.source_at>=proof.created_at and i.source_at<=proof.expires_at
      and i.source_at<=clock_timestamp()+interval '2 seconds') then return false; end if;
  -- Neither a new login nor a later CRM relink may take over an old challenge.
  perform 1 from public.crm_clientes where id=proof.client_id and auth_user_id=proof.auth_user_id for share;
  if not found or (select count(*) from public.crm_clientes where auth_user_id=proof.auth_user_id)<>1 then return false; end if;
  insert into public.office_meta_verified_clients(opportunity_id,client_id,proof_digest,channel,account_id,recipient_id,source_id,contact_at)
    select original.id,proof.client_id,h,reply.channel,reply.account_id,reply.recipient_id,p_source_id,l.contact_at from public.office_meta_panel_links l where l.digest=proof.link_digest
    on conflict do nothing returning opportunity_id into inserted;
  if inserted is null then return exists(select 1 from public.office_meta_verified_clients where opportunity_id=original.id and client_id=proof.client_id
    and proof_digest=h and source_id=p_source_id); end if;
  update public.office_capture_opportunities set client_id=proof.client_id where id=original.id and (client_id is null or client_id=proof.client_id);
  return true;
end $$;

-- Codes work independently of the marketing dispatcher, including a handoff or opted-out conversation.
create function public.office_meta_inbound_proof() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform public.office_meta_panel_confirm(new.opportunity_id,new.source_id,upper(trim(new.inbound_text)));
  return new;
end $$;
create trigger office_meta_record_private_proof after insert or update of inbound_text on public.office_capture_inbound
for each row when (new.verified and new.kind='message' and upper(trim(new.inbound_text)) ~ '^TC-[0-9A-F]{12}$')
execute function public.office_meta_inbound_proof();

create index office_capture_month_recent on public.office_capture_opportunities(source_at desc,id desc);
create function public.office_meta_attribution_report(p_actor uuid,p_month date,p_as_of timestamptz,
  p_after_at timestamptz default null,p_after_id uuid default null,p_status text default null,p_search text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare report jsonb; current_actor uuid:=public.office_actor(p_actor);
begin
  if p_actor is null or current_actor is null or p_month is null or extract(day from p_month)<>1
    or p_as_of is null or p_as_of>clock_timestamp()+interval '5 seconds' or (p_after_at is null)<>(p_after_id is null)
    or length(p_search)>100 or p_search ~ '[[:cntrl:]]' or (p_status is not null and p_status not in ('pending','claimed','dispatching','sent',
      'expired','handoff','blocked','failed','uncertain','opted_out','purchased','recorded'))
    or p_month>date_trunc('month',p_as_of at time zone 'Europe/Madrid')::date then raise exception 'OFFICE_INVALID'; end if;
  with form_evidence as materialized (
    select coalesce(nullif(e.page_id,''),'form:'||nullif(e.form_id,''),'meta-leads') as account,
      e.captacion_lead_id as lead_id,e.cliente_id as client_id,coalesce(e.meta_created_at,e.received_at) as contact_at,c.nombre
    from public.meta_lead_events e join public.captacion_leads l on l.id=e.captacion_lead_id and l.cliente_id=e.cliente_id
    join public.crm_clientes c on c.id=e.cliente_id where e.status='processed' and nullif(trim(e.leadgen_id),'') is not null
      and coalesce(e.inserted_at,e.received_at)<=p_as_of and coalesce(e.meta_created_at,e.received_at)<=p_as_of
      and coalesce(lower(c.origen),'') not like '%orion%' and coalesce(lower(l.origen),'') not like '%orion%'
      and not exists(select 1 from public.meta_lead_events conflict where conflict.leadgen_id=e.leadgen_id and conflict.status='processed'
        and conflict.cliente_id is not null and conflict.cliente_id<>e.cliente_id)
  ), forms as materialized (
    select md5(jsonb_build_array('tc:meta:form',f.account,f.lead_id)::text)::uuid as id,f.account,f.lead_id,f.client_id,
      min(f.contact_at) as contact_at,max(f.contact_at) as latest_at,max(f.nombre) as name
    from form_evidence f group by f.account,f.lead_id,f.client_id
  ), opportunities as (
    select o.id,o.channel,o.kind,o.source_at,o.latest_inbound_at,o.window_until,o.status,o.thread_id,o.lead_id,o.last_error,o.receipt_id,o.name,o.created_at
    from public.office_capture_opportunities o where o.channel<>'meta_form' or not exists(select 1 from forms f
      where f.account=o.account_id and o.thread_key='lead:'||f.lead_id)
    union all
    select f.id,'meta_form','form',f.contact_at,f.latest_at,o.window_until,coalesce(o.status,'recorded'),o.thread_id,f.lead_id,o.last_error,
       o.receipt_id,coalesce(o.name,f.name),f.contact_at from forms f left join public.office_capture_opportunities o on o.channel='meta_form'
       and o.kind='form' and o.account_id=f.account and o.thread_key='lead:'||f.lead_id and o.created_at<=p_as_of
  ), all_links as materialized (
    select b.opportunity_id,b.client_id,b.contact_at,0 as priority from public.office_meta_verified_clients b where b.bound_at<=p_as_of
    union all select f.id,f.client_id,f.contact_at,1 from forms f
  ), attributed as materialized (
    select b.*,row_number() over(partition by b.client_id order by b.contact_at,b.priority,b.opportunity_id) as credit
    from all_links b
  ), period as materialized (
    select o.* from opportunities o where o.source_at>=p_month::timestamp at time zone 'Europe/Madrid'
      and o.source_at<(p_month+interval '1 month') at time zone 'Europe/Madrid' and o.source_at<=p_as_of and o.created_at<=p_as_of
  ), linked as materialized (
    select b.* from attributed b join period o on o.id=b.opportunity_id
  ), firsts as materialized (
    select distinct on(e.client_id) e.client_id,e.at,e.source,e.status from public.office_crm_receipts(p_as_of) e
    join linked b on b.client_id=e.client_id where exists(select 1 from linked) order by e.client_id,e.at,e.source<>'crm_cliente_pagos',e.source,e.id
  ), visits as (
    select l.opportunity_id,bool_or(l.opened_at<=p_as_of) as opened,
      bool_or(p.created_at<=p_as_of and p.expires_at>p_as_of) as challenged
    from public.office_meta_panel_links l join period o on o.id=l.opportunity_id
    left join public.office_meta_panel_proofs p on p.link_digest=l.digest group by l.opportunity_id
  ), rows as materialized (
    select o.id,o.channel,o.kind,o.source_at,o.latest_inbound_at,o.window_until,o.status,o.thread_id,o.lead_id,
      case when o.name !~ '@|https?://' and length(regexp_replace(o.name,'[^0-9]','','g'))<7
        then nullif(left(trim(regexp_replace(o.name,'[[:cntrl:]]',' ','g')),80),'') end as display_name,
      case when o.last_error is null then null when o.last_error ~* '^[A-Z][A-Z0-9_]{1,63}$' and o.last_error !~ '[0-9]{5,}' then upper(o.last_error) else 'PROVIDER_ERROR' end as provider_error,
      o.receipt_id is not null as has_receipt,coalesce(v.opened,false) as opened,
      coalesce(b.credit=1,false) as linked,f.at as first_purchase_at,f.source as first_purchase_source,f.status as first_purchase_status,
      case when b.client_id is null then case when coalesce(v.challenged,false) then 'awaiting_proof' else 'unlinked' end
        when b.credit>1 then 'linked_elsewhere' when f.at is null then 'awaiting_purchase' when f.at<=b.contact_at then 'prior_customer' else 'first_purchase' end as conversion
    from period o left join linked b on b.opportunity_id=o.id left join firsts f on f.client_id=b.client_id left join visits v on v.opportunity_id=o.id
  ), counts as (
    select channel,grouping(channel) as all_platforms,count(*) as opportunities,count(*) filter(where linked) as linked_clients,
      count(*) filter(where opened) as opened_opportunities,count(*) filter(where conversion='awaiting_proof') as proof_pending,
      count(*) filter(where conversion='first_purchase') as first_purchases,count(*) filter(where conversion='prior_customer') as prior_clients,
      count(*) filter(where conversion='linked_elsewhere') as linked_elsewhere,
      count(*) filter(where conversion in ('unlinked','awaiting_proof','awaiting_purchase')) as pending from rows group by grouping sets((channel),())
  ), page as materialized (
    select * from rows where (p_after_id is null or (source_at,id)<(p_after_at,p_after_id)) and (p_status is null or status=p_status)
      and (p_search is null or position(lower(p_search) in lower(coalesce(display_name,'')))>0) order by source_at desc,id desc limit 26
  )
  select jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'as_of',p_as_of,
    'totals',(select to_jsonb(c)-'channel'-'all_platforms' from counts c where all_platforms=1),
    'platforms',coalesce((select jsonb_agg((to_jsonb(c)-'channel'-'all_platforms')||jsonb_build_object('platform',channel) order by channel) from counts c where all_platforms=0),'[]'::jsonb),
    'states',coalesce((select jsonb_agg(to_jsonb(s) order by state) from (select status state,count(*) count from rows group by status) s),'[]'::jsonb),
    'purchases',coalesce((select jsonb_agg(to_jsonb(p) order by source) from (select first_purchase_source source,count(*) count from rows where conversion='first_purchase' group by first_purchase_source) p),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(item)-'linked' order by source_at desc,id desc) from (select * from page order by source_at desc,id desc limit 25) item),'[]'::jsonb),
    'has_more',(select count(*)>25 from page)) into report;
  return report;
end $$;
revoke all on function public.office_meta_panel_issue(uuid,text,text),public.office_meta_panel_visit(text),
  public.office_meta_panel_challenge(text,text,uuid,uuid),public.office_meta_panel_confirm(uuid,text,text),
  public.office_meta_attribution_report(uuid,date,timestamptz,timestamptz,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.office_meta_inbound_proof() from public,anon,authenticated,service_role;
grant execute on function public.office_meta_panel_issue(uuid,text,text),public.office_meta_panel_visit(text),
  public.office_meta_panel_challenge(text,text,uuid,uuid),public.office_meta_panel_confirm(uuid,text,text),
  public.office_meta_attribution_report(uuid,date,timestamptz,timestamptz,uuid,text,text) to service_role;
commit;
