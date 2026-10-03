-- ============================================================
-- TAROT CELESTIAL · BENEFICIOS DE RANGO x NIVEL DE PAQUETE
-- 01 · ESQUEMA + ADMINISTRACIÓN
-- Compatible con Supabase real verificado el 2026-10-03.
-- No acredita recompensas todavía.
-- ============================================================
begin;
create extension if not exists pgcrypto;

do $$ begin
  if to_regclass('public.crm_clientes') is null then raise exception 'MISSING_REQUIRED_TABLE: crm_clientes'; end if;
  if to_regclass('public.workers') is null then raise exception 'MISSING_REQUIRED_TABLE: workers'; end if;
  if to_regclass('public.tc_client_rank_benefits') is null then raise exception 'MISSING_REQUIRED_TABLE: tc_client_rank_benefits'; end if;
  if to_regclass('public.tc_client_benefit_events') is null then raise exception 'MISSING_REQUIRED_TABLE: tc_client_benefit_events'; end if;
  if to_regclass('public.tc_client_benefit_audit') is null then raise exception 'MISSING_REQUIRED_TABLE: tc_client_benefit_audit'; end if;
  if to_regprocedure('public.tc_client_rank_state(uuid)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: tc_client_rank_state(uuid)'; end if;
end $$;

-- La tabla real ya tiene ritual_access, revision, updated_at y updated_by.
-- Solo se garantiza el estado inicial pedido: Diamante conserva acceso si todavía
-- no existe ningún rango con acceso configurado.
do $$ begin
  if not exists(select 1 from public.tc_client_rank_benefits where ritual_access=true) then
    update public.tc_client_rank_benefits set ritual_access=(rank_key='diamante'), updated_at=now() where rank_key in ('bronce','plata','oro','diamante');
  end if;
end $$;

-- Matriz de beneficio adicional por rango efectivo y nivel de paquete.
create table if not exists public.tc_rank_package_benefits (
  rank_key text not null references public.tc_client_rank_benefits(rank_key) on update cascade on delete restrict,
  package_level smallint not null check(package_level between 1 and 3),
  enabled boolean not null default false,
  coins integer not null default 0 check(coins between 0 and 1000000),
  oracle_credits integer not null default 0 check(oracle_credits between 0 and 100000),
  roulette_level_1_spins integer not null default 0 check(roulette_level_1_spins between 0 and 10000),
  roulette_level_2_spins integer not null default 0 check(roulette_level_2_spins between 0 and 10000),
  roulette_level_3_spins integer not null default 0 check(roulette_level_3_spins between 0 and 10000),
  roulette_special_spins integer not null default 0 check(roulette_special_spins between 0 and 10000),
  revision integer not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(rank_key,package_level)
);

insert into public.tc_rank_package_benefits(rank_key,package_level)
select r.rank_key,l.level
from public.tc_client_rank_benefits r
cross join (values(1::smallint),(2::smallint),(3::smallint)) l(level)
where r.rank_key in ('bronce','plata','oro','diamante')
on conflict(rank_key,package_level) do nothing;

-- Asignación administrable: nivel de paquete != nivel de ruleta.
create table if not exists public.tc_purchase_package_levels (
  package_source text not null check(package_source in ('standard','promotion')),
  package_key text not null,
  package_label text not null,
  package_level smallint check(package_level between 1 and 3),
  revision integer not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(package_source,package_key)
);

-- Agrupación que ya existía en el proyecto para los packs estándar.
-- Las promociones NO se asignan automáticamente.
insert into public.tc_purchase_package_levels(package_source,package_key,package_label,package_level)
values
 ('standard','pack_10','10 minutos',1),('standard','pack_20','20 minutos',1),('standard','pack_30','30 minutos',1),
 ('standard','pack_40','40 minutos',2),('standard','pack_50','50 minutos',2),('standard','pack_60','60 minutos',2),
 ('standard','pack_80','80 minutos',3),('standard','pack_120','120 minutos',3),('standard','pack_180','180 minutos',3)
on conflict(package_source,package_key) do nothing;

-- Se amplía el historial REAL existente, sin crear un historial paralelo.
alter table public.tc_client_benefit_events add column if not exists delivery_key text;
alter table public.tc_client_benefit_events add column if not exists package_level smallint;
alter table public.tc_client_benefit_events add column if not exists claim_day date;
create unique index if not exists uq_tc_client_benefit_events_delivery_key
  on public.tc_client_benefit_events(delivery_key) where delivery_key is not null;

create or replace function public.tc_assert_benefit_admin(p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_actor is null or not exists(
    select 1 from public.workers w
    where w.user_id=p_actor and w.role='admin' and coalesce(w.is_active,true)=true
  ) then raise exception 'ADMIN_REQUIRED'; end if;
end $$;

create or replace function public.tc_save_rank_package_benefit(p_actor uuid,p_edit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare oldrow public.tc_rank_package_benefits; saved public.tc_rank_package_benefits; v_level smallint;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  v_level=(p_edit->>'package_level')::smallint;
  select * into oldrow from public.tc_rank_package_benefits where rank_key=p_edit->>'rank_key' and package_level=v_level for update;
  if not found then raise exception 'INVALID_RANK_PACKAGE_LEVEL'; end if;
  if oldrow.revision<>(p_edit->>'revision')::integer then raise exception 'CONFIG_CONFLICT'; end if;
  update public.tc_rank_package_benefits set
    enabled=coalesce((p_edit->>'enabled')::boolean,false),
    coins=greatest(0,coalesce((p_edit->>'coins')::integer,0)),
    oracle_credits=greatest(0,coalesce((p_edit->>'oracle_credits')::integer,0)),
    roulette_level_1_spins=greatest(0,coalesce((p_edit->>'roulette_level_1_spins')::integer,0)),
    roulette_level_2_spins=greatest(0,coalesce((p_edit->>'roulette_level_2_spins')::integer,0)),
    roulette_level_3_spins=greatest(0,coalesce((p_edit->>'roulette_level_3_spins')::integer,0)),
    roulette_special_spins=greatest(0,coalesce((p_edit->>'roulette_special_spins')::integer,0)),
    revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
  where rank_key=oldrow.rank_key and package_level=oldrow.package_level returning * into saved;
  insert into public.tc_client_benefit_audit(actor_user_id,action,entity,entity_id,before_data,after_data)
  values(p_actor,'update','rank_package_benefit',saved.rank_key||':'||saved.package_level,to_jsonb(oldrow),to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.tc_save_rank_ritual_access(p_actor uuid,p_edit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare oldrow public.tc_client_rank_benefits; saved public.tc_client_rank_benefits;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  select * into oldrow from public.tc_client_rank_benefits where rank_key=p_edit->>'rank_key' for update;
  if not found then raise exception 'INVALID_RANK'; end if;
  if oldrow.revision<>(p_edit->>'revision')::integer then raise exception 'CONFIG_CONFLICT'; end if;
  update public.tc_client_rank_benefits set ritual_access=(p_edit->>'ritual_access')::boolean,
    revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
  where rank_key=oldrow.rank_key returning * into saved;
  insert into public.tc_client_benefit_audit(actor_user_id,action,entity,entity_id,before_data,after_data)
  values(p_actor,'update','rank_ritual_access',saved.rank_key,to_jsonb(oldrow),to_jsonb(saved));
  return jsonb_build_object('rank_key',saved.rank_key,'label',saved.label,'sort_order',saved.sort_order,'ritual_access',saved.ritual_access,'revision',saved.revision,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
end $$;

create or replace function public.tc_save_purchase_package_level(p_actor uuid,p_edit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare oldrow public.tc_purchase_package_levels; saved public.tc_purchase_package_levels; v_source text; v_key text; v_level smallint;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  v_source=p_edit->>'package_source'; v_key=btrim(p_edit->>'package_key');
  if v_source not in ('standard','promotion') or v_key='' then raise exception 'INVALID_PACKAGE'; end if;
  v_level=nullif(p_edit->>'package_level','')::smallint;
  if v_level is not null and v_level not between 1 and 3 then raise exception 'INVALID_PACKAGE_LEVEL'; end if;
  select * into oldrow from public.tc_purchase_package_levels where package_source=v_source and package_key=v_key for update;
  if found then
    if oldrow.revision<>(p_edit->>'revision')::integer then raise exception 'CONFIG_CONFLICT'; end if;
    update public.tc_purchase_package_levels set package_label=left(coalesce(nullif(btrim(p_edit->>'package_label'),''),package_label),160),package_level=v_level,
      revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
    where package_source=v_source and package_key=v_key returning * into saved;
  else
    if coalesce((p_edit->>'revision')::integer,0)<>0 then raise exception 'CONFIG_CONFLICT'; end if;
    insert into public.tc_purchase_package_levels(package_source,package_key,package_label,package_level,updated_by)
    values(v_source,v_key,left(coalesce(nullif(btrim(p_edit->>'package_label'),''),v_key),160),v_level,p_actor) returning * into saved;
  end if;
  insert into public.tc_client_benefit_audit(actor_user_id,action,entity,entity_id,before_data,after_data)
  values(p_actor,'update','package_level_assignment',saved.package_source||':'||saved.package_key,case when oldrow.package_key is null then null else to_jsonb(oldrow) end,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.tc_preview_rank_package_benefit(p_rank_key text,p_package_level smallint)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_build_object(
    'rank_key',b.rank_key,'package_level',b.package_level,'enabled',b.enabled,
    'coins',b.coins,'oracle_credits',b.oracle_credits,
    'roulette_level_1_spins',b.roulette_level_1_spins,
    'roulette_level_2_spins',b.roulette_level_2_spins,
    'roulette_level_3_spins',b.roulette_level_3_spins,
    'roulette_special_spins',b.roulette_special_spins,
    'summary',concat_ws(' · ',
      case when b.coins>0 then '+'||b.coins||' Coins' end,
      case when b.oracle_credits>0 then '+'||b.oracle_credits||' Oráculo' end,
      case when b.roulette_level_1_spins>0 then '+'||b.roulette_level_1_spins||' giro N1' end,
      case when b.roulette_level_2_spins>0 then '+'||b.roulette_level_2_spins||' giro N2' end,
      case when b.roulette_level_3_spins>0 then '+'||b.roulette_level_3_spins||' giro N3' end,
      case when b.roulette_special_spins>0 then '+'||b.roulette_special_spins||' giro Especial' end
    )
  ),'{}'::jsonb)
  from public.tc_rank_package_benefits b where b.rank_key=p_rank_key and b.package_level=p_package_level;
$$;

alter table public.tc_rank_package_benefits enable row level security;
alter table public.tc_purchase_package_levels enable row level security;
revoke all on public.tc_rank_package_benefits,public.tc_purchase_package_levels from public,anon,authenticated;
grant select,insert,update,delete on public.tc_rank_package_benefits,public.tc_purchase_package_levels to service_role;

revoke all on function public.tc_assert_benefit_admin(uuid),public.tc_save_rank_package_benefit(uuid,jsonb),public.tc_save_rank_ritual_access(uuid,jsonb),public.tc_save_purchase_package_level(uuid,jsonb),public.tc_preview_rank_package_benefit(text,smallint) from public,anon,authenticated;
grant execute on function public.tc_assert_benefit_admin(uuid),public.tc_save_rank_package_benefit(uuid,jsonb),public.tc_save_rank_ritual_access(uuid,jsonb),public.tc_save_purchase_package_level(uuid,jsonb),public.tc_preview_rank_package_benefit(text,smallint) to service_role;

notify pgrst,'reload schema';
commit;
