-- Recuperación de clientes: estados compartidos, auditoría y 75 XP por compra confirmada.
-- Ejecutar una sola vez en Supabase antes de desplegar. No modifica contactos ni pagos.
begin;
create table if not exists public.crm_client_recovery (
 client_id uuid primary key references public.crm_clientes(id),
 status text not null default 'pending' check(status in ('pending','contacted','no_response','recycled','recovered')),
 responsible_id uuid references public.workers(id), contacted_at timestamptz,
 updated_at timestamptz not null default now(), recovered_at timestamptz,
 payment_id uuid unique references public.crm_cliente_pagos(id), purchase_amount numeric,
 xp integer not null default 0 check(xp in (0,75)), version integer not null default 0,
 check(status <> 'recovered' or (payment_id is not null and contacted_at is not null and responsible_id is not null and xp=75))
);
create table if not exists public.crm_client_recovery_history (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.crm_client_recovery(client_id),
 actor_id uuid not null references public.workers(id), status text not null, note text,
 created_at timestamptz not null default now()
);
create index if not exists crm_recovery_history_client on public.crm_client_recovery_history(client_id,created_at desc);
create index if not exists crm_recovery_status on public.crm_client_recovery(status,updated_at);
alter table public.crm_client_recovery enable row level security;
alter table public.crm_client_recovery_history enable row level security;
revoke all on public.crm_client_recovery,public.crm_client_recovery_history from public,anon,authenticated;
grant select,insert,update on public.crm_client_recovery,public.crm_client_recovery_history to service_role;
-- Unique across workers, so changing the responsible person cannot duplicate an award.
create unique index if not exists worker_xp_recovery_once on public.worker_xp_events(reference_id) where action_key='client_recovery';
insert into public.worker_xp_rules(action_key,name,description,xp_reward,frequency,enabled,integration_status)
 values('client_recovery','Recuperación de clientes','Compra de reencuentro confirmada tras una gestión; una vez por contacto.',75,'unlimited',true,'connected')
 on conflict(action_key) do nothing;

-- Recognizes JUNIO2026, junio 2026, JUN-2026, 2026-06, 06/2026 and year-only labels.
create or replace function public.tc_recovery_tag_month(label text) returns integer
language plpgsql immutable security invoker set search_path=public as $$
declare t text:=upper(trim(coalesce(label,''))); m text[]; n integer; best integer:=null;
 names text[]:=array['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
begin
 for m in select regexp_matches(t,'(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[ ._/-]*(20[0-9]{2})','g') loop
  n:=case when left(m[1],3)='SET' then 9 else array_position(names,left(m[1],3)) end;
  best:=greatest(best,m[2]::integer*100+n);
 end loop;
 for m in select regexp_matches(t,'(20[0-9]{2})[-_/ .](0?[1-9]|1[0-2])([^0-9]|$)','g') loop best:=greatest(best,m[1]::integer*100+m[2]::integer); end loop;
 for m in select regexp_matches(t,'(^|[^0-9])(0?[1-9]|1[0-2])[-_/ .](20[0-9]{2})','g') loop best:=greatest(best,m[3]::integer*100+m[2]::integer); end loop;
 if best is null and t ~ '^20[0-9]{2}$' then best:=t::integer*100+12; end if;
 return best;
end $$;

create or replace view public.tc_recovery_candidates with (security_invoker=true) as
select c.id,trim(concat_ws(' ',c.nombre,c.apellido)) nombre,c.telefono,
 coalesce(t.tags,'{}'::text[]) tags,
 (coalesce(t.tag_count,0)=0 or (t.latest_month is not null and t.latest_month<=202606)) eligible
from public.crm_clientes c
left join lateral (
 select array_agg(e.nombre order by e.nombre) tags,count(*) tag_count,max(public.tc_recovery_tag_month(e.nombre)) latest_month
 from public.crm_cliente_etiquetas ce join public.crm_etiquetas e on e.id=ce.etiqueta_id where ce.cliente_id=c.id
) t on true
where coalesce(c.origen,'') not ilike '%orion%' and length(regexp_replace(coalesce(c.telefono,''),'[^0-9]','','g'))>=6;
revoke all on public.tc_recovery_candidates from public,anon,authenticated;
grant select on public.tc_recovery_candidates to service_role;

-- All RPCs are invoker and service-only. The API validates the bearer token with Auth first.
create or replace function public.tc_recovery_list(p_user uuid,p_bucket text default 'pending',p_status text default '',p_search text default '',p_tag text default '',p_page integer default 1)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false) then raise exception 'FORBIDDEN'; end if;
 with base as (
 select c.*,coalesce(r.status,'pending') status,coalesce(r.version,0) version,r.responsible_id,w.display_name responsible_name,
 r.contacted_at,r.updated_at,r.recovered_at,r.payment_id,r.purchase_amount,coalesce(r.xp,0) xp,
 case when r.status in ('recycled','recovered') then r.status else 'pending' end bucket
 from tc_recovery_candidates c left join crm_client_recovery r on r.client_id=c.id left join workers w on w.id=r.responsible_id
 where c.eligible or r.status in ('recycled','recovered')
 ), filtered as (
 select * from base where bucket=p_bucket and (p_status='' or status=p_status)
 and (p_tag='' or (p_tag='__none__' and cardinality(tags)=0) or p_tag=any(tags))
 and (p_search='' or strpos(lower(nombre),lower(p_search))>0 or strpos(regexp_replace(telefono,'[^0-9]','','g'),regexp_replace(p_search,'[^0-9]','','g'))>0 and p_search ~ '[0-9]')
 ), page_rows as (
 select * from filtered order by updated_at desc nulls last,nombre,id limit 25 offset (greatest(1,p_page)-1)*25
 ) select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb),
 'total',(select count(*) from filtered),'counts',jsonb_build_object('pending',(select count(*) from base where bucket='pending'),'recycled',(select count(*) from base where bucket='recycled'),'recovered',(select count(*) from base where bucket='recovered')),
 'tags',coalesce((select jsonb_agg(tag order by tag) from (select distinct unnest(tags) tag from base) x),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function public.tc_recovery_detail(p_user uuid,p_client uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare r crm_client_recovery;
begin
 if not exists(select 1 from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false) then raise exception 'FORBIDDEN'; end if;
 select * into r from crm_client_recovery where client_id=p_client;
 if not exists(select 1 from tc_recovery_candidates where id=p_client and (eligible or r.status in ('recycled','recovered'))) then raise exception 'NOT_ELIGIBLE'; end if;
 return jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(p)) from (
 select id,importe,created_at from crm_cliente_pagos where cliente_id=p_client and estado='completed' and importe>0
 and created_at>=r.contacted_at and created_at<=now() and r.status<>'recovered' order by created_at desc limit 100) p),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h)) from (
 select h.id,h.status,h.note,h.created_at,w.display_name actor_name from crm_client_recovery_history h join workers w on w.id=h.actor_id where h.client_id=p_client order by h.created_at desc limit 100) h),'[]'::jsonb));
end $$;

create or replace function public.tc_recovery_act(p_user uuid,p_client uuid,p_action text,p_version integer,p_payment uuid default null,p_note text default '')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor workers; r crm_client_recovery; payment crm_cliente_pagos; next_status text; client_name text;
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if p_action not in ('contacted','no_response','recycled','recovered','restore') then raise exception 'INVALID_ACTION'; end if;
 select nombre into client_name from tc_recovery_candidates where id=p_client and eligible;
 if not found then raise exception 'NOT_ELIGIBLE'; end if;
 insert into crm_client_recovery(client_id) values(p_client) on conflict do nothing;
 select * into r from crm_client_recovery where client_id=p_client for update;
 if r.status='recovered' then return jsonb_build_object('status','recovered','already_recovered',true,'xp',75); end if;
 if r.version<>p_version then raise exception 'STALE_VERSION'; end if;
 if r.responsible_id is not null and r.responsible_id<>actor.id and actor.role<>'admin' and p_action not in ('recovered') then raise exception 'OTHER_OWNER'; end if;
 if r.status='recycled' and p_action not in ('restore','recovered') then raise exception 'RESTORE_FIRST'; end if;
 if p_action='restore' and r.status<>'recycled' then raise exception 'INVALID_ACTION'; end if;
 next_status:=case when p_action='restore' then case when r.contacted_at is null then 'pending' else 'contacted' end else p_action end;
 if p_action in ('contacted','no_response') then
  r.contacted_at:=coalesce(r.contacted_at,now()); r.responsible_id:=coalesce(r.responsible_id,actor.id);
 end if;
 if p_action='recovered' then
  if r.contacted_at is null or r.responsible_id is null then raise exception 'CONTACT_FIRST'; end if;
  select * into payment from crm_cliente_pagos where id=p_payment and cliente_id=p_client and estado='completed' and importe>0 and created_at>=r.contacted_at and created_at<=now() for update;
  if not found then raise exception 'PAYMENT_REQUIRED'; end if;
  insert into worker_xp_events(worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_by_worker_id)
  values(r.responsible_id,'client_recovery',75,'client_recovery:'||p_client,'Cliente recuperado: '||client_name,'client_recovery','applied',jsonb_build_object('client_id',p_client,'payment_id',p_payment,'confirmed_by',actor.id),actor.id);
 end if;
 update crm_client_recovery set status=next_status,responsible_id=r.responsible_id,contacted_at=r.contacted_at,
 updated_at=now(),version=version+1,recovered_at=case when p_action='recovered' then now() else recovered_at end,
 payment_id=case when p_action='recovered' then p_payment else payment_id end,
 purchase_amount=case when p_action='recovered' then payment.importe else purchase_amount end,
 xp=case when p_action='recovered' then 75 else xp end where client_id=p_client;
 insert into crm_client_recovery_history(client_id,actor_id,status,note) values(p_client,actor.id,next_status,nullif(left(trim(p_note),1000),''));
 return jsonb_build_object('status',next_status,'xp',case when p_action='recovered' then 75 else 0 end);
end $$;
revoke all on function public.tc_recovery_tag_month(text),public.tc_recovery_list(uuid,text,text,text,text,integer),public.tc_recovery_detail(uuid,uuid),public.tc_recovery_act(uuid,uuid,text,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.tc_recovery_tag_month(text),public.tc_recovery_list(uuid,text,text,text,text,integer),public.tc_recovery_detail(uuid,uuid),public.tc_recovery_act(uuid,uuid,text,integer,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
