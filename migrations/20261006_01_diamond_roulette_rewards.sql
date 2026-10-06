-- Diamante: catalogue, atomic delivery, durable receipts and seven daily claims.
-- Apply after inspecting the live schema; see docs/DIAMOND-ROULETTE.md.
begin;

do $$ begin
  if to_regprocedure('public.tc_assert_benefit_admin(uuid)') is null
    or to_regprocedure('public.tc_touch_roulette_signal(uuid)') is null
    or to_regprocedure('public.grant_cliente_oracle_credits(uuid,integer,text,text,text,jsonb)') is null
    or to_regprocedure('public.tc_client_rank_state(uuid)') is null
    or to_regprocedure('public.tc_client_state_snapshot(uuid)') is null then
    raise exception 'DIAMOND_REQUIRED_INFRASTRUCTURE_MISSING';
  end if;
end $$;

create table if not exists public.tc_diamond_roulette_results (
  spin_id uuid primary key references public.cliente_ruleta_giros(id),
  cliente_id uuid not null references public.crm_clientes(id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists tc_diamond_results_client on public.tc_diamond_roulette_results(cliente_id,created_at desc);
create table if not exists public.tc_diamond_roulette_benefits (
  id uuid primary key default gen_random_uuid(),
  spin_id uuid not null unique references public.tc_diamond_roulette_results(spin_id),
  cliente_id uuid not null references public.crm_clientes(id),
  campaign_id uuid not null references public.tc_client_roulette_campaigns(id),
  reward_id uuid not null references public.tc_client_roulette_rewards(id),
  reward_name text not null,
  delivery_kind text not null check(delivery_kind in ('manual','daily_minutes')),
  status text not null check(status in ('pending','active','completed')),
  daily_minutes integer not null default 0 check(daily_minutes between 0 and 1000),
  total_claims integer not null default 0 check(total_claims between 0 and 31),
  claims_used integer not null default 0 check(claims_used between 0 and total_claims),
  starts_on date,
  expires_at timestamptz,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((delivery_kind='manual' and daily_minutes=0 and total_claims=0 and expires_at is null)
    or (delivery_kind='daily_minutes' and daily_minutes>0 and total_claims>0 and starts_on is not null and expires_at is not null))
);
create index if not exists tc_diamond_benefits_client on public.tc_diamond_roulette_benefits(cliente_id,created_at desc);
create table if not exists public.tc_diamond_roulette_claims (
  benefit_id uuid not null references public.tc_diamond_roulette_benefits(id),
  claim_day date not null,
  minutes integer not null check(minutes>0),
  balance_before numeric not null,
  balance_after numeric not null,
  created_at timestamptz not null default now(),
  primary key(benefit_id,claim_day)
);

alter table public.tc_diamond_roulette_results enable row level security;
alter table public.tc_diamond_roulette_benefits enable row level security;
alter table public.tc_diamond_roulette_claims enable row level security;
revoke all on public.tc_diamond_roulette_results,public.tc_diamond_roulette_benefits,public.tc_diamond_roulette_claims from public,anon,authenticated;
grant select,insert,update,delete on public.tc_diamond_roulette_results,public.tc_diamond_roulette_benefits,public.tc_diamond_roulette_claims to service_role;

-- Older grant functions labelled these two sources Diamante but wrote level 4.
-- Never reinterpret arbitrary level-4 spins or already-consumed spins.
create or replace function public.tc_normalize_diamond_spin_level()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.estado='pending' and new.nivel=4 and new.source in ('diamond_rank_purchase','admin_manual_diamond') then
    new.nivel:=5;
  end if;
  return new;
end $$;
drop trigger if exists trg_tc_normalize_diamond_spin_level on public.cliente_ruleta_giros;
create trigger trg_tc_normalize_diamond_spin_level before insert or update of nivel,source on public.cliente_ruleta_giros
for each row execute function public.tc_normalize_diamond_spin_level();
update public.cliente_ruleta_giros set nivel=5
where nivel=4 and estado='pending' and source in ('diamond_rank_purchase','admin_manual_diamond');

-- A stale client / legacy RPC must not award a Diamond spin with the old engine.
create or replace function public.tc_require_diamond_receipt()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.nivel=5 and old.estado='pending' and new.estado='used' and not exists(
    select 1 from public.tc_diamond_roulette_results where spin_id=new.id and cliente_id=new.cliente_id) then
    raise exception 'DIAMOND_ENGINE_REQUIRED';
  end if;
  return new;
end $$;
drop trigger if exists trg_tc_require_diamond_receipt on public.cliente_ruleta_giros;
create trigger trg_tc_require_diamond_receipt before update of estado on public.cliente_ruleta_giros
for each row execute function public.tc_require_diamond_receipt();
revoke all on function public.tc_require_diamond_receipt() from public,anon,authenticated;

-- UUID v4 supplies OS randomness. Rejection sampling avoids modulo bias.
create or replace function public.tc_diamond_roulette_ticket()
returns integer language plpgsql volatile set search_path=public,pg_temp as $$
declare n bigint;
begin
  loop
    n:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint;
    exit when n<4294960000;
  end loop;
  return (n%10000)::integer;
end $$;

create or replace function public.tc_install_diamond_catalogue_v1(p_campaign_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; preset jsonb := '[
  {
    "code": "minutes-7",
    "name": "7 minutos",
    "weight": 21.3,
    "kind": "minutes",
    "value": 7,
    "rarity": "common",
    "meta": {}
  },
  {
    "code": "minutes-9",
    "name": "9 minutos",
    "weight": 17,
    "kind": "minutes",
    "value": 9,
    "rarity": "common",
    "meta": {}
  },
  {
    "code": "minutes-10",
    "name": "10 minutos",
    "weight": 15,
    "kind": "minutes",
    "value": 10,
    "rarity": "common",
    "meta": {}
  },
  {
    "code": "minutes-15",
    "name": "15 minutos",
    "weight": 12,
    "kind": "minutes",
    "value": 15,
    "rarity": "uncommon",
    "meta": {}
  },
  {
    "code": "spin-1",
    "name": "Giro Nivel 1",
    "weight": 9,
    "kind": "roulette_spins",
    "value": 1,
    "rarity": "uncommon",
    "meta": {
      "roulette_level": 1
    }
  },
  {
    "code": "minutes-30",
    "name": "30 minutos",
    "weight": 7.5,
    "kind": "minutes",
    "value": 30,
    "rarity": "rare",
    "meta": {}
  },
  {
    "code": "spin-2",
    "name": "Giro Nivel 2",
    "weight": 5.5,
    "kind": "roulette_spins",
    "value": 1,
    "rarity": "rare",
    "meta": {
      "roulette_level": 2
    }
  },
  {
    "code": "oracle-2",
    "name": "2 tiradas del Oráculo",
    "weight": 4.5,
    "kind": "oracle_credits",
    "value": 2,
    "rarity": "rare",
    "meta": {}
  },
  {
    "code": "runa",
    "name": "Runa Milenaria",
    "weight": 2.8,
    "kind": "manual",
    "value": 0,
    "rarity": "epic",
    "meta": {}
  },
  {
    "code": "minutes-50",
    "name": "50 minutos",
    "weight": 2.2,
    "kind": "minutes",
    "value": 50,
    "rarity": "epic",
    "meta": {}
  },
  {
    "code": "minutes-70",
    "name": "70 minutos",
    "weight": 1.2,
    "kind": "minutes",
    "value": 70,
    "rarity": "legendary",
    "meta": {}
  },
  {
    "code": "spin-special",
    "name": "Giro Nivel Especial",
    "weight": 0.8,
    "kind": "roulette_spins",
    "value": 1,
    "rarity": "legendary",
    "meta": {
      "roulette_level": 4
    }
  },
  {
    "code": "minutes-100",
    "name": "100 minutos",
    "weight": 0.5,
    "kind": "minutes",
    "value": 100,
    "rarity": "ultra",
    "meta": {}
  },
  {
    "code": "daily-7",
    "name": "10 min diarios × 7 días",
    "weight": 0.35,
    "kind": "daily_minutes",
    "value": 10,
    "rarity": "diamond",
    "meta": {
      "daily_minutes": 10,
      "days_total": 7
    }
  },
  {
    "code": "tarotista-a",
    "name": "Consulta 10 min con Tarotista Rango A",
    "weight": 0.25,
    "kind": "manual",
    "value": 0,
    "rarity": "diamond",
    "meta": {}
  },
  {
    "code": "mystery",
    "name": "Bono Misterioso Diamante",
    "weight": 0.1,
    "kind": "manual",
    "value": 0,
    "rarity": "jackpot",
    "meta": {}
  }
]'::jsonb; pos integer:=0; old_catalogue jsonb;
begin
  perform 1 from public.tc_client_roulette_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'CAMPAIGN_REQUIRED'; end if;
  -- Re-running the migration or clicking twice preserves subsequent admin edits.
  if exists(select 1 from public.tc_client_roulette_rewards where campaign_id=p_campaign_id and nivel=5 and metadata->>'catalogue_version'='diamond-20261006') then
    return jsonb_build_object('already_installed',true);
  end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into old_catalogue from public.tc_client_roulette_rewards r where campaign_id=p_campaign_id and nivel=5;
  update public.tc_client_roulette_rewards set is_active=false,updated_at=now() where campaign_id=p_campaign_id and nivel=5;
  for item in select value from jsonb_array_elements(preset) loop
    pos:=pos+1;
    insert into public.tc_client_roulette_rewards(campaign_id,nivel,name,description,reward_type,reward_value,rarity,weight,special,fulfillment_mode,metadata,is_active,sort_order,updated_at)
    values(p_campaign_id,5,item->>'name',
      case when item->>'kind'='manual' then 'Toma una captura de pantalla de este premio y envíala al número de Tarot Celestial, o llámanos informando de que lo has ganado. Indica la referencia del premio.'
        when item->>'kind'='daily_minutes' then 'Reclama 10 minutos diarios durante 7 días naturales desde hoy (Europe/Madrid). Los días no reclamados no se acumulan.'
        else 'Se acredita automáticamente al ganar.' end,
      case item->>'kind' when 'minutes' then 'minutes' when 'daily_minutes' then 'streak_minutes' else 'perk' end,
      (item->>'value')::integer,item->>'rarity',(item->>'weight')::numeric,pos>=9,
      case item->>'kind' when 'manual' then 'manual' when 'daily_minutes' then 'claim' else 'immediate' end,
      (item->'meta')||jsonb_build_object('catalogue_version','diamond-20261006','prize_code',item->>'code','delivery_kind',item->>'kind'),true,pos,now());
  end loop;
  update public.tc_client_roulette_campaigns set diamond_enabled=true,updated_at=now() where id=p_campaign_id;
  insert into public.tc_client_roulette_audit(campaign_id,actor_user_id,action,snapshot)
    values(p_campaign_id,p_actor,'diamond_catalogue_installed',jsonb_build_object('before',old_catalogue,'catalogue',preset));
  return jsonb_build_object('installed',true,'prizes',16,'total_probability',100);
end $$;

-- Internal installer is owned by the migration role; it cannot be called through PostgREST.
revoke all on function public.tc_install_diamond_catalogue_v1(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.tc_seed_diamond_roulette(p_campaign_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.tc_assert_benefit_admin(p_actor);
  return public.tc_install_diamond_catalogue_v1(p_campaign_id,p_actor);
end $$;

-- Lock the campaign before changing the full distribution; a spin never sees
-- a partially-saved set of percentages. Works for all five levels.
create or replace function public.tc_save_roulette_probabilities_v1(p_campaign_id uuid,p_level integer,p_probabilities jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; total numeric; active_count integer;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  if p_level not between 1 and 5 or jsonb_typeof(p_probabilities)<>'array' then raise exception 'PROBABILIDADES_INVALIDAS'; end if;
  perform 1 from public.tc_client_roulette_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'CAMPAIGN_REQUIRED'; end if;
  select count(*),sum((x->>'probability')::numeric) into n,total from jsonb_array_elements(p_probabilities) x;
  if n=0 or total is distinct from 100::numeric or exists(select 1 from jsonb_array_elements(p_probabilities) x
    where x->>'id' is null or x->>'probability' is null or (x->>'probability')::numeric not between 0 and 100
      or round((x->>'probability')::numeric,2)<>(x->>'probability')::numeric)
    or n<>(select count(distinct x->>'id') from jsonb_array_elements(p_probabilities) x) then raise exception 'PROBABILIDADES_INVALIDAS'; end if;
  select count(*) into active_count from public.tc_client_roulette_rewards where campaign_id=p_campaign_id and nivel=p_level and is_active;
  if n<>active_count or exists(select 1 from jsonb_array_elements(p_probabilities) x where not exists(
    select 1 from public.tc_client_roulette_rewards where id=(x->>'id')::uuid and campaign_id=p_campaign_id and nivel=p_level and is_active)) then
    raise exception 'REPARTO_DEBE_INCLUIR_TODOS_LOS_PREMIOS_ACTIVOS';
  end if;
  update public.tc_client_roulette_rewards r set weight=(x->>'probability')::numeric,updated_at=now()
    from jsonb_array_elements(p_probabilities) x where r.id=(x->>'id')::uuid;
  insert into public.tc_client_roulette_audit(campaign_id,actor_user_id,action,snapshot)
    values(p_campaign_id,p_actor,'probabilities_updated',jsonb_build_object('nivel',p_level,'probabilities',p_probabilities));
  return jsonb_build_object('saved',true);
end $$;

create or replace function public.tc_diamond_roulette_benefits_v1(p_cliente_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object(
    'status',case when b.status='active' and now()>=b.expires_at then 'expired' else b.status end,
    'business_day',(now() at time zone 'Europe/Madrid')::date,
    'claimed_today',exists(select 1 from public.tc_diamond_roulette_claims c where c.benefit_id=b.id and c.claim_day=(now() at time zone 'Europe/Madrid')::date),
    'can_claim',b.delivery_kind='daily_minutes' and b.status='active' and now()<b.expires_at and (now() at time zone 'Europe/Madrid')::date>=b.starts_on
      and not exists(select 1 from public.tc_diamond_roulette_claims c where c.benefit_id=b.id and c.claim_day=(now() at time zone 'Europe/Madrid')::date),
    'next_claim_at',case when b.delivery_kind='daily_minutes' and b.status='active' and now()<b.expires_at then
      case when exists(select 1 from public.tc_diamond_roulette_claims c where c.benefit_id=b.id and c.claim_day=(now() at time zone 'Europe/Madrid')::date)
        then (((now() at time zone 'Europe/Madrid')::date+1)::timestamp at time zone 'Europe/Madrid')
        else now() end else null end
    ) order by b.created_at desc),'[]'::jsonb)
  from (select * from public.tc_diamond_roulette_benefits where cliente_id=p_cliente_id and status in ('active','pending')
    union all select * from (select * from public.tc_diamond_roulette_benefits where cliente_id=p_cliente_id and status='completed' order by created_at desc limit 20) recent) b;
$$;

create or replace function public.tc_diamond_roulette_summary_v1(p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare campaign public.tc_client_roulette_campaigns%rowtype; catalogue jsonb; spins jsonb; rank_state jsonb;
begin
  rank_state:=public.tc_client_rank_state(p_cliente_id);
  select * into campaign from public.tc_client_roulette_campaigns
    where status='active' and (starts_at is null or starts_at<=now()) and (active_until_disabled or ends_at is null or ends_at>now())
    order by created_at desc,id limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'nivel',5,'name',r.name,'label',r.name,'description',r.description,
    'reward_type',case when r.reward_type='perk' and r.metadata->>'delivery_kind' in ('oracle_credits','roulette_spins') then r.metadata->>'delivery_kind' else r.reward_type end,
    'reward_value',r.reward_value,'probability',r.weight,'weight',r.weight,'special',r.special,'rarity',r.rarity,'fulfillment_mode',r.fulfillment_mode,'meta',r.metadata,'sort_order',r.sort_order) order by r.sort_order,r.id),'[]'::jsonb)
    into catalogue from public.tc_client_roulette_rewards r where r.campaign_id=campaign.id and r.nivel=5 and r.is_active;
  select jsonb_build_object('level_5_spins',count(*),'next_spin_5',(array_agg(id order by created_at,id))[1]) into spins
    from public.cliente_ruleta_giros where cliente_id=p_cliente_id and nivel=5 and estado='pending'
      and (required_rank is null or required_rank=rank_state->>'effective');
  return spins||jsonb_build_object('diamond_access',coalesce(campaign.diamond_enabled,false) and jsonb_array_length(catalogue)>0
      and ((spins->>'level_5_spins')::integer>0 or rank_state->>'effective'='diamante'),
    'catalogue',catalogue,'diamond_benefits',public.tc_diamond_roulette_benefits_v1(p_cliente_id));
end $$;

create or replace function public.tc_diamond_roulette_spin_v1(p_cliente_id uuid,p_spin_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.cliente_ruleta_giros%rowtype; campaign public.tc_client_roulette_campaigns%rowtype;
  r public.tc_client_roulette_rewards%rowtype; chosen public.tc_client_roulette_rewards%rowtype;
  prior jsonb; v_result jsonb; kind text; amount integer; total numeric:=0; cumulative integer:=0; ticket integer;
  before_balance numeric; after_balance numeric; gift_spin uuid; benefit uuid;
  d date:=(now() at time zone 'Europe/Madrid')::date; rank_state jsonb; i integer;
begin
  -- Same lock order as daily claims / existing balance grants.
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  if not found then raise exception 'INVALID_CLIENT'; end if;
  select * into s from public.cliente_ruleta_giros where id=p_spin_id and cliente_id=p_cliente_id and nivel=5 for update;
  if not found then raise exception 'INVALID_SPIN'; end if;
  select x.result into prior from public.tc_diamond_roulette_results x where x.spin_id=p_spin_id and x.cliente_id=p_cliente_id;
  if found then return prior||jsonb_build_object('duplicate',true); end if;
  if s.estado<>'pending' then raise exception 'LEGACY_SPIN_ALREADY_USED'; end if;
  rank_state:=public.tc_client_rank_state(p_cliente_id);
  if s.required_rank is not null and s.required_rank is distinct from rank_state->>'effective' then raise exception 'RANK_BENEFIT_FORBIDDEN'; end if;
  select * into campaign from public.tc_client_roulette_campaigns
    where status='active' and (starts_at is null or starts_at<=now()) and (active_until_disabled or ends_at is null or ends_at>now())
    order by created_at desc,id limit 1 for share;
  if not found then raise exception 'ROULETTE_NO_ACTIVE_CAMPAIGN'; end if;
  if not coalesce(campaign.diamond_enabled,false) then raise exception 'DIAMOND_ROULETTE_PAUSED'; end if;
  ticket:=public.tc_diamond_roulette_ticket();
  for r in select * from public.tc_client_roulette_rewards where campaign_id=campaign.id and nivel=5 and is_active order by sort_order,id for share loop
    if r.fulfillment_mode is null or r.reward_type is null or r.weight is null or r.weight<0 or r.weight>100 or round(r.weight::numeric,2)<>r.weight then raise exception 'DIAMOND_INVALID_CATALOGUE'; end if;
    kind:=coalesce(r.metadata->>'delivery_kind',case r.reward_type when 'minutes' then 'minutes' when 'streak_minutes' then 'daily_minutes' else 'manual' end);
    if kind not in ('minutes','roulette_spins','oracle_credits','manual','daily_minutes') or r.reward_value is null
      or r.reward_value<0 or r.reward_value<>trunc(r.reward_value) or r.reward_value>1000
      or (kind<>'manual' and r.reward_value<=0)
      or (kind='manual' and r.fulfillment_mode<>'manual')
      or (kind in ('minutes','roulette_spins','oracle_credits') and r.fulfillment_mode<>'immediate')
      or (kind='daily_minutes' and (r.fulfillment_mode<>'claim' or (coalesce((r.metadata->>'days_total')::integer,0)<>7 or r.reward_value<>10)))
      or (kind='roulette_spins' and coalesce((r.metadata->>'roulette_level')::integer,0) not in (1,2,4)) then
      raise exception 'DIAMOND_INVALID_CATALOGUE';
    end if;
    total:=total+r.weight;
    cumulative:=cumulative+(r.weight*100)::integer;
    if chosen.id is null and ticket<cumulative then chosen:=r; end if;
  end loop;
  if total<>100 or chosen.id is null then raise exception 'DIAMOND_INVALID_CATALOGUE'; end if;
  r:=chosen; kind:=coalesce(r.metadata->>'delivery_kind',case r.reward_type when 'minutes' then 'minutes' when 'streak_minutes' then 'daily_minutes' else 'manual' end); amount:=r.reward_value::integer;
  select coalesce(minutos_free_pendientes,0)+coalesce(minutos_normales_pendientes,0) into before_balance from public.crm_clientes where id=p_cliente_id;
  after_balance:=before_balance;
  if kind='minutes' then
    update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+amount,updated_at=now() where id=p_cliente_id;
    after_balance:=before_balance+amount;
  elsif kind='oracle_credits' then
    perform public.grant_cliente_oracle_credits(p_cliente_id,amount,'diamond-spin:'||p_spin_id::text||':oracle','roulette_diamond',r.name,jsonb_build_object('spin_id',p_spin_id,'reward_id',r.id));
  elsif kind='roulette_spins' then
    for i in 1..amount loop
      insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank)
        values(p_cliente_id,'diamond-spin:'||p_spin_id::text||':gift:'||i,'diamond_reward',(r.metadata->>'roulette_level')::smallint,'pending',null) returning id into gift_spin;
    end loop;
  end if;
  v_result:=jsonb_build_object('spin_id',p_spin_id,'spin_level',5,'reward_id',r.id,'reward_type',
    case kind when 'daily_minutes' then 'streak_minutes' when 'manual' then 'perk' else kind end,
    'reward_value',amount,'reward_label',r.name,'reward_description',r.description,'reward_rarity',r.rarity,'reward_meta',r.metadata,
    'balance_before',before_balance,'balance_after',after_balance,'special',r.special,'fulfillment_mode',r.fulfillment_mode,'duplicate',false);
  insert into public.tc_diamond_roulette_results(spin_id,cliente_id,result) values(p_spin_id,p_cliente_id,v_result);
  if kind in ('manual','daily_minutes') then
    insert into public.tc_diamond_roulette_benefits(spin_id,cliente_id,campaign_id,reward_id,reward_name,delivery_kind,status,daily_minutes,total_claims,starts_on,expires_at)
      values(p_spin_id,p_cliente_id,campaign.id,r.id,r.name,kind,case kind when 'manual' then 'pending' else 'active' end,
        case kind when 'daily_minutes' then amount else 0 end,
        case kind when 'daily_minutes' then (r.metadata->>'days_total')::integer else 0 end,
        case kind when 'daily_minutes' then d else null end,
        case kind when 'daily_minutes' then ((d+(r.metadata->>'days_total')::integer)::timestamp at time zone 'Europe/Madrid') else null end) returning id into benefit;
    v_result:=v_result||jsonb_build_object('entitlement_id',benefit);
    update public.tc_diamond_roulette_results set result=v_result where spin_id=p_spin_id;
  end if;
  -- Keep legacy reward types in the shared spin history; the immutable result has the precise type.
  update public.cliente_ruleta_giros set estado='used',used_at=now(),campaign_id=campaign.id,reward_id=r.id,
    reward_type=r.reward_type,reward_value=amount,reward_label=r.name,reward_rarity=r.rarity,
    result_status=case when kind='manual' then 'pending' when kind='daily_minutes' then 'active' else 'credited' end where id=p_spin_id;
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
    values(p_cliente_id,'diamond_roulette_reward','Has ganado: '||r.name,
      case kind when 'manual' then 'Toma una captura de pantalla de este premio y envíala al número de Tarot Celestial, o llámanos informando de que lo has ganado.'
        when 'daily_minutes' then 'Reclama tus minutos diarios en Inicio durante 7 días naturales desde hoy. Leonaris te guiará. Los días no reclamados no se acumulan.'
        else 'Tu premio de la Ruleta Diamante ya está acreditado en tu cuenta.' end,
      jsonb_build_object('spin_id',p_spin_id,'entitlement_id',benefit,'href','/cliente/ruleta?nivel=5#premios-diamante'),false,now());
  perform public.tc_touch_roulette_signal(p_cliente_id);
  return v_result;
end $$;

create or replace function public.tc_diamond_roulette_claim_v1(p_cliente_id uuid,p_entitlement_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.tc_diamond_roulette_benefits%rowtype; receipt public.tc_diamond_roulette_claims%rowtype;
  d date:=(now() at time zone 'Europe/Madrid')::date; before_balance numeric; after_balance numeric;
begin
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  select * into b from public.tc_diamond_roulette_benefits where id=p_entitlement_id and cliente_id=p_cliente_id for update;
  if not found or b.delivery_kind<>'daily_minutes' then raise exception 'INVALID_BENEFIT'; end if;
  select * into receipt from public.tc_diamond_roulette_claims where benefit_id=b.id and claim_day=d;
  if found then return jsonb_build_object('minutes',receipt.minutes,'duplicate',true,'balance_after',receipt.balance_after); end if;
  if now()>=b.expires_at then raise exception 'BENEFIT_EXPIRED'; end if;
  if b.status<>'active' or b.claims_used>=b.total_claims then raise exception 'BENEFIT_COMPLETED'; end if;
  if d<b.starts_on then raise exception 'BENEFIT_NOT_READY'; end if;
  select coalesce(minutos_free_pendientes,0)+coalesce(minutos_normales_pendientes,0) into before_balance from public.crm_clientes where id=p_cliente_id;
  after_balance:=before_balance+b.daily_minutes;
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+b.daily_minutes,updated_at=now() where id=p_cliente_id;
  insert into public.tc_diamond_roulette_claims(benefit_id,claim_day,minutes,balance_before,balance_after) values(b.id,d,b.daily_minutes,before_balance,after_balance);
  update public.tc_diamond_roulette_benefits set claims_used=claims_used+1,status=case when claims_used+1>=total_claims then 'completed' else 'active' end where id=b.id;
  if b.claims_used+1>=b.total_claims then update public.cliente_ruleta_giros set result_status='completed' where id=b.spin_id; end if;
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
    values(p_cliente_id,'diamond_roulette_daily','Minutos diarios acreditados','Has recibido '||b.daily_minutes||' minutos de tu premio Diamante.',jsonb_build_object('entitlement_id',b.id,'claim_day',d,'href','/cliente/dashboard#saldo-minutes'),false,now());
  perform public.tc_touch_roulette_signal(p_cliente_id);
  return jsonb_build_object('minutes',b.daily_minutes,'duplicate',false,'balance_before',before_balance,'balance_after',after_balance);
end $$;

create or replace function public.tc_complete_diamond_benefit_v1(p_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.tc_diamond_roulette_benefits%rowtype;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  select * into b from public.tc_diamond_roulette_benefits where id=p_id and delivery_kind='manual' for update;
  if not found then raise exception 'INVALID_BENEFIT'; end if;
  if b.status='completed' then return jsonb_build_object('completed',true,'duplicate',true); end if;
  update public.tc_diamond_roulette_benefits set status='completed',completed_at=now(),completed_by=p_actor where id=b.id;
  update public.cliente_ruleta_giros set result_status='completed' where id=b.spin_id;
  insert into public.tc_client_roulette_audit(campaign_id,reward_id,actor_user_id,action,snapshot)
    values(b.campaign_id,b.reward_id,p_actor,'diamond_manual_completed',to_jsonb(b));
  return jsonb_build_object('completed',true);
end $$;

-- Preserve the deployed snapshot contract and all existing balance/rank fields.
create or replace function public.tc_client_state_snapshot_diamond_v1(p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot jsonb; spins jsonb;
begin
  snapshot:=public.tc_client_state_snapshot(p_cliente_id);
  select jsonb_build_object('level_1',count(*) filter(where nivel=1),'level_2',count(*) filter(where nivel=2),
    'level_3',count(*) filter(where nivel=3),'special',count(*) filter(where nivel=4),'diamond',count(*) filter(where nivel=5),
    'total',count(*)) into spins from public.cliente_ruleta_giros where cliente_id=p_cliente_id and estado='pending';
  return jsonb_set(snapshot,'{spins}',coalesce(snapshot->'spins','{}'::jsonb)||spins);
end $$;
revoke all on function public.tc_client_state_snapshot_diamond_v1(uuid) from public,anon,authenticated;
grant execute on function public.tc_client_state_snapshot_diamond_v1(uuid) to service_role;

-- RPCs are callable only by the server after verified user/client or admin identity.
revoke all on function public.tc_normalize_diamond_spin_level(),public.tc_diamond_roulette_ticket(),public.tc_seed_diamond_roulette(uuid,uuid),
  public.tc_save_roulette_probabilities_v1(uuid,integer,jsonb,uuid),public.tc_diamond_roulette_benefits_v1(uuid),
  public.tc_diamond_roulette_summary_v1(uuid),public.tc_diamond_roulette_spin_v1(uuid,uuid),
  public.tc_diamond_roulette_claim_v1(uuid,uuid),public.tc_complete_diamond_benefit_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tc_seed_diamond_roulette(uuid,uuid),public.tc_save_roulette_probabilities_v1(uuid,integer,jsonb,uuid),
  public.tc_diamond_roulette_benefits_v1(uuid),public.tc_diamond_roulette_summary_v1(uuid),public.tc_diamond_roulette_spin_v1(uuid,uuid),
  public.tc_diamond_roulette_claim_v1(uuid,uuid),public.tc_complete_diamond_benefit_v1(uuid,uuid) to service_role;
-- Install the requested catalogue in the one current campaign, with system audit
-- attribution (no invented administrator identity). Other campaigns stay unchanged.
do $$
declare active_ids uuid[];
begin
  select array_agg(id) into active_ids from public.tc_client_roulette_campaigns
    where status='active' and (starts_at is null or starts_at<=now()) and (active_until_disabled or ends_at is null or ends_at>now());
  if cardinality(active_ids)>1 then raise exception 'DIAMOND_AMBIGUOUS_ACTIVE_CAMPAIGN'; end if;
  if cardinality(active_ids)=1 then perform public.tc_install_diamond_catalogue_v1(active_ids[1],null); end if;
end $$;
notify pgrst,'reload schema';
commit;
