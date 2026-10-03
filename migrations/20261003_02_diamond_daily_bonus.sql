-- ============================================================
-- TAROT CELESTIAL · BONO DIARIO DIAMANTE
-- 02 · CONFIGURACIÓN + RECLAMACIÓN TRANSACCIONAL
-- Día natural del negocio: Europe/Madrid (coincide con el código existente).
-- Reutiliza Coins, Oráculo, ruletas y tc_client_benefit_events.
-- ============================================================
begin;
create extension if not exists pgcrypto;

do $$ begin
  if to_regprocedure('public.tc_client_rank_state(uuid)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: tc_client_rank_state(uuid)'; end if;
  if to_regprocedure('public.grant_cliente_oracle_credits(uuid,integer,text,text,text,jsonb)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: grant_cliente_oracle_credits'; end if;
  if to_regprocedure('public.tc_touch_roulette_signal(uuid)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: tc_touch_roulette_signal(uuid)'; end if;
end $$;

create table if not exists public.tc_rank_daily_bonus_config (
  id uuid primary key default gen_random_uuid(),
  rank_key text not null unique references public.tc_client_rank_benefits(rank_key),
  enabled boolean not null default false,
  name text not null default 'Bono diario Diamante',
  description text not null default 'Recompensa diaria exclusiva del rango Diamante.',
  coins integer not null default 0 check(coins between 0 and 1000000),
  oracle_credits integer not null default 0 check(oracle_credits between 0 and 100000),
  roulette_level_1_spins integer not null default 0 check(roulette_level_1_spins between 0 and 10000),
  roulette_level_2_spins integer not null default 0 check(roulette_level_2_spins between 0 and 10000),
  roulette_level_3_spins integer not null default 0 check(roulette_level_3_spins between 0 and 10000),
  roulette_special_spins integer not null default 0 check(roulette_special_spins between 0 and 10000),
  revision integer not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.tc_rank_daily_bonus_config(rank_key) values('diamante') on conflict(rank_key) do nothing;

alter table public.tc_client_benefit_events add column if not exists claim_day date;
alter table public.tc_client_benefit_events add column if not exists delivery_key text;
create unique index if not exists uq_tc_daily_rank_bonus_client_day
  on public.tc_client_benefit_events(cliente_id,claim_day)
  where benefit_type='daily_rank_bonus' and claim_day is not null;

create or replace function public.tc_save_diamond_daily_bonus(p_actor uuid,p_edit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare oldrow public.tc_rank_daily_bonus_config; saved public.tc_rank_daily_bonus_config; v_total bigint;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  select * into oldrow from public.tc_rank_daily_bonus_config where id=(p_edit->>'id')::uuid and rank_key='diamante' for update;
  if not found then raise exception 'INVALID_DIAMOND_BONUS'; end if;
  if oldrow.revision<>(p_edit->>'revision')::integer then raise exception 'CONFIG_CONFLICT'; end if;
  v_total=greatest(0,coalesce((p_edit->>'coins')::integer,0))+greatest(0,coalesce((p_edit->>'oracle_credits')::integer,0))+
    greatest(0,coalesce((p_edit->>'roulette_level_1_spins')::integer,0))+greatest(0,coalesce((p_edit->>'roulette_level_2_spins')::integer,0))+
    greatest(0,coalesce((p_edit->>'roulette_level_3_spins')::integer,0))+greatest(0,coalesce((p_edit->>'roulette_special_spins')::integer,0));
  if coalesce((p_edit->>'enabled')::boolean,false) and v_total<=0 then raise exception 'BONUS_REWARD_REQUIRED'; end if;
  update public.tc_rank_daily_bonus_config set
    enabled=coalesce((p_edit->>'enabled')::boolean,false),
    name=left(coalesce(nullif(btrim(p_edit->>'name'),''),'Bono diario Diamante'),120),description=left(coalesce(p_edit->>'description',''),600),
    coins=greatest(0,coalesce((p_edit->>'coins')::integer,0)),oracle_credits=greatest(0,coalesce((p_edit->>'oracle_credits')::integer,0)),
    roulette_level_1_spins=greatest(0,coalesce((p_edit->>'roulette_level_1_spins')::integer,0)),roulette_level_2_spins=greatest(0,coalesce((p_edit->>'roulette_level_2_spins')::integer,0)),
    roulette_level_3_spins=greatest(0,coalesce((p_edit->>'roulette_level_3_spins')::integer,0)),roulette_special_spins=greatest(0,coalesce((p_edit->>'roulette_special_spins')::integer,0)),
    revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
  where id=oldrow.id returning * into saved;

  -- Mantiene sincronizado el flag histórico ya existente para compatibilidad.
  update public.tc_client_rank_benefits
     set daily_bonus_enabled=saved.enabled,updated_at=clock_timestamp(),updated_by=p_actor,revision=revision+1
   where rank_key='diamante';

  insert into public.tc_client_benefit_audit(actor_user_id,action,entity,entity_id,before_data,after_data)
  values(p_actor,'update','diamond_daily_bonus',saved.id::text,to_jsonb(oldrow),to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.tc_available_rank_bonuses(p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s jsonb; cfg public.tc_rank_daily_bonus_config; d date; used boolean; next_at timestamptz;
begin
  s:=public.tc_client_rank_state(p_cliente_id);
  if coalesce(s->>'effective','')<>'diamante' then return '[]'::jsonb; end if;
  select * into cfg from public.tc_rank_daily_bonus_config where rank_key='diamante' and enabled=true;
  if not found then return '[]'::jsonb; end if;
  d:=(now() at time zone 'Europe/Madrid')::date;
  select exists(select 1 from public.tc_client_benefit_events e where e.cliente_id=p_cliente_id and e.benefit_type='daily_rank_bonus' and e.claim_day=d) into used;
  next_at:=((date_trunc('day',now() at time zone 'Europe/Madrid')+interval '1 day') at time zone 'Europe/Madrid');
  return jsonb_build_array(jsonb_build_object(
    'id',cfg.id,'authorized_rank','diamante','name',cfg.name,'description',cfg.description,'claimed_today',used,'uses_today',case when used then 1 else 0 end,
    'max_uses_per_client',1,'next_available_at',next_at,
    'benefit',jsonb_build_object('coins',cfg.coins,'oracle_credits',cfg.oracle_credits,
      'roulette_level_1_spins',cfg.roulette_level_1_spins,'roulette_level_2_spins',cfg.roulette_level_2_spins,
      'roulette_level_3_spins',cfg.roulette_level_3_spins,'roulette_special_spins',cfg.roulette_special_spins)
  ));
end $$;

create or replace function public.tc_claim_rank_bonus(p_cliente_id uuid,p_promotion_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; cfg public.tc_rank_daily_bonus_config; d date; ev uuid; i integer; spin_id uuid; spin_ids jsonb:='[]'::jsonb; next_at timestamptz;
begin
  if p_cliente_id is null then raise exception 'CLIENT_REQUIRED'; end if;
  d:=(now() at time zone 'Europe/Madrid')::date;
  perform pg_advisory_xact_lock(hashtextextended('diamond_daily:'||p_cliente_id::text||':'||d::text,0));
  s:=public.tc_client_rank_state(p_cliente_id);
  if coalesce(s->>'effective','')<>'diamante' then raise exception 'RANK_BENEFIT_FORBIDDEN'; end if;
  select * into cfg from public.tc_rank_daily_bonus_config where id=p_promotion_id and rank_key='diamante' for update;
  if not found or not cfg.enabled then raise exception 'BONUS_NOT_ACTIVE'; end if;
  if exists(select 1 from public.tc_client_benefit_events where cliente_id=p_cliente_id and benefit_type='daily_rank_bonus' and claim_day=d) then raise exception 'BONUS_ALREADY_USED'; end if;

  insert into public.tc_client_benefit_events(cliente_id,rank_at_event,benefit_key,benefit_type,coins,oracle_credits,claim_day,delivery_key,snapshot)
  values(p_cliente_id,'diamante','diamond_daily','daily_rank_bonus',cfg.coins,cfg.oracle_credits,d,'daily-rank:'||p_cliente_id::text||':'||d::text,
    jsonb_build_object('config',to_jsonb(cfg),'rank_state',s,'business_timezone','Europe/Madrid')) returning id into ev;

  if cfg.coins>0 then
    update public.crm_clientes set puntos=coalesce(puntos,0)+cfg.coins,updated_at=now() where id=p_cliente_id;
    insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,meta)
    values(p_cliente_id,'ganado',cfg.coins,'Bono diario Diamante',jsonb_build_object('benefit_event_id',ev,'claim_day',d));
  end if;

  if cfg.oracle_credits>0 then
    perform public.grant_cliente_oracle_credits(p_cliente_id,cfg.oracle_credits,'daily-rank:'||p_cliente_id::text||':'||d::text||':oracle','diamond_daily','Bono diario Diamante',jsonb_build_object('benefit_event_id',ev,'claim_day',d));
  end if;

  for i in 1..cfg.roulette_level_1_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank) values(p_cliente_id,'daily-rank:'||p_cliente_id::text||':'||d::text||':l1:'||i,'rank_daily_bonus',1,'pending','diamante') returning id into spin_id; spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;
  for i in 1..cfg.roulette_level_2_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank) values(p_cliente_id,'daily-rank:'||p_cliente_id::text||':'||d::text||':l2:'||i,'rank_daily_bonus',2,'pending','diamante') returning id into spin_id; spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;
  for i in 1..cfg.roulette_level_3_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank) values(p_cliente_id,'daily-rank:'||p_cliente_id::text||':'||d::text||':l3:'||i,'rank_daily_bonus',3,'pending','diamante') returning id into spin_id; spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;
  for i in 1..cfg.roulette_special_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank) values(p_cliente_id,'daily-rank:'||p_cliente_id::text||':'||d::text||':l4:'||i,'rank_daily_bonus',4,'pending','diamante') returning id into spin_id; spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;

  update public.tc_client_benefit_events set snapshot=snapshot||jsonb_build_object('delivered',jsonb_build_object('coins',cfg.coins,'oracle_credits',cfg.oracle_credits,'spin_ids',spin_ids)) where id=ev;
  perform public.tc_touch_roulette_signal(p_cliente_id);
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p_cliente_id,'daily_rank_bonus','Bono Diamante recibido','Tu bono diario Diamante ya está acreditado.',jsonb_build_object('benefit_event_id',ev,'claim_day',d),false,now());
  next_at:=((date_trunc('day',now() at time zone 'Europe/Madrid')+interval '1 day') at time zone 'Europe/Madrid');
  return jsonb_build_object('delivered',jsonb_build_object('coins',cfg.coins,'oracle_credits',cfg.oracle_credits,'spin_ids',spin_ids),'next_available_at',next_at,'bonuses',public.tc_available_rank_bonuses(p_cliente_id));
exception when unique_violation then
  raise exception 'BONUS_ALREADY_USED';
end $$;

alter table public.tc_rank_daily_bonus_config enable row level security;
revoke all on public.tc_rank_daily_bonus_config from public,anon,authenticated;
grant select,insert,update,delete on public.tc_rank_daily_bonus_config to service_role;
revoke all on function public.tc_save_diamond_daily_bonus(uuid,jsonb),public.tc_available_rank_bonuses(uuid),public.tc_claim_rank_bonus(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tc_save_diamond_daily_bonus(uuid,jsonb),public.tc_available_rank_bonuses(uuid),public.tc_claim_rank_bonus(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
