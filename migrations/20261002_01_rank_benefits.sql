-- Phase 1. Apply as database owner, before deploying the application.
-- Reuses the catalog already referenced by the project's benefit APIs.
begin;
create table if not exists public.tc_client_rank_benefits (
  rank_key text primary key,
  label text not null,
  sort_order integer not null,
  min_spend numeric not null,
  is_active boolean not null default true,
  coins_enabled boolean not null default true,
  purchase_coins integer not null default 0 check (purchase_coins between 0 and 1000000),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='tc_client_rank_benefits' and column_name='ritual_access') then
    alter table public.tc_client_rank_benefits add column ritual_access boolean not null default false;
    update public.tc_client_rank_benefits set ritual_access=true where rank_key='diamante';
  end if;
end $$;
alter table public.tc_client_rank_benefits add column if not exists revision integer not null default 0;
alter table public.tc_client_rank_benefits add column if not exists created_at timestamptz not null default now();
alter table public.tc_client_rank_benefits add column if not exists updated_at timestamptz not null default now();

-- Real ranks and existing thresholds, not demonstration benefits or customers.
insert into public.tc_client_rank_benefits(rank_key,label,sort_order,min_spend,ritual_access)
values ('bronce','Bronce',1,0.01,false),('plata','Plata',2,100,false),
       ('oro','Oro',3,500,false),('diamante','Diamante',4,1000,true)
on conflict (rank_key) do nothing;

-- Fail instead of accepting a catalog whose thresholds disagree with the active rank engine.
do $$ begin
  if exists (select 1 from public.tc_client_rank_benefits r join
    (values ('bronce',0.01),('plata',100),('oro',500),('diamante',1000)) v(k,n)
    on r.rank_key=v.k where r.min_spend<>v.n) then
    raise exception 'RANK_THRESHOLDS_MISMATCH: review the live rank catalog before applying Phase 1';
  end if;
end $$;

alter table public.tc_client_rank_benefits enable row level security;
revoke all on public.tc_client_rank_benefits from public, anon, authenticated;
grant select,insert,update,delete on public.tc_client_rank_benefits to service_role;

create or replace function public.tc_save_rank_phase_one(p_edit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.tc_client_rank_benefits;
begin
  if jsonb_typeof(p_edit->'purchase_coins') <> 'number'
     or jsonb_typeof(p_edit->'ritual_access') <> 'boolean'
     or jsonb_typeof(p_edit->'revision') <> 'number'
     or not (p_edit ?& array['rank_key','purchase_coins','ritual_access','revision'])
     or (p_edit->>'purchase_coins')::numeric not between 0 and 1000000
     or (p_edit->>'purchase_coins')::numeric <> trunc((p_edit->>'purchase_coins')::numeric)
     or (p_edit->>'revision')::numeric <> trunc((p_edit->>'revision')::numeric) then
    raise exception 'INVALID_BENEFIT_CONFIG';
  end if;
  update public.tc_client_rank_benefits set
    purchase_coins=(p_edit->>'purchase_coins')::integer,
    coins_enabled=true,
    ritual_access=(p_edit->>'ritual_access')::boolean,
    revision=revision+1, updated_at=clock_timestamp()
  where rank_key=p_edit->>'rank_key' and revision=(p_edit->>'revision')::integer
  returning * into saved;
  if not found then raise exception 'CONFIG_CONFLICT'; end if;
  return jsonb_build_object('rank_key',saved.rank_key,'label',saved.label,'sort_order',saved.sort_order,
    'purchase_coins',saved.purchase_coins,'ritual_access',saved.ritual_access,'revision',saved.revision);
end $$;

-- A single database resolver for purchase eligibility and the client's permission.
-- Mirrors the active rolling 30-day engine (payments + calls, including legacy name matching).
create or replace function public.tc_rank_phase_one_state(p_cliente_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.crm_clientes; v_rank_key text; spend numeric; benefit public.tc_client_rank_benefits;
begin
  select * into c from public.crm_clientes where id=p_cliente_id;
  if not found then raise exception 'CLIENTE_NO_EXISTE'; end if;
  select coalesce(sum(importe),0) into spend from public.crm_cliente_pagos
  where cliente_id=p_cliente_id and estado='completed' and importe>0
    and created_at between now()-interval '30 days' and now();
  select spend+coalesce(sum(l.importe),0) into spend from public.rendimiento_llamadas l
  where l.importe>0 and (l.fecha_hora>=now()-interval '30 days'
    or l.created_at between now()-interval '30 days' and now())
    and (l.cliente_id=p_cliente_id or (l.cliente_id is null and
      lower(regexp_replace(translate(trim(l.cliente_nombre),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g')) in (
        lower(regexp_replace(translate(trim(concat_ws(' ',c.nombre,c.apellido)),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g')),
        lower(regexp_replace(translate(trim(c.nombre),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g')))));
  select r.rank_key into v_rank_key from public.tc_client_rank_benefits r
    where round(spend,2)>=r.min_spend order by r.min_spend desc,r.sort_order desc limit 1;
  if to_regclass('public.client_rank_overrides') is not null then
    select coalesce((select o.assigned_rank from public.client_rank_overrides o
      where o.client_id=p_cliente_id and o.active and o.starts_at<=now()
        and (o.ends_at is null or o.ends_at>now()) order by o.created_at desc limit 1),v_rank_key) into v_rank_key;
  end if;
  if v_rank_key is null then
    return jsonb_build_object('rank_key',null,'purchase_coins',0,'ritual_access',false);
  end if;
  select * into benefit from public.tc_client_rank_benefits r where r.rank_key=v_rank_key;
  if not found then raise exception 'RANK_BENEFITS_NOT_CONFIGURED'; end if;
  return jsonb_build_object('rank_key',v_rank_key,
    'purchase_coins',case when benefit.coins_enabled and benefit.is_active then benefit.purchase_coins else 0 end,
    'ritual_access',benefit.ritual_access and benefit.is_active);
end $$;

revoke all on function public.tc_save_rank_phase_one(jsonb) from public,anon,authenticated;
revoke all on function public.tc_rank_phase_one_state(uuid) from public,anon,authenticated;
grant execute on function public.tc_save_rank_phase_one(jsonb) to service_role;
grant execute on function public.tc_rank_phase_one_state(uuid) to service_role;

-- Ritual rows are only exposed by the authenticated, permission-checked API.
do $$ begin
  if to_regclass('public.client_rituals') is not null then
    alter table public.client_rituals enable row level security;
    revoke all on public.client_rituals from anon,authenticated;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
