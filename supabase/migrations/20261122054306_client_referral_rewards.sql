begin;

-- A referral is a staff-confirmed relationship between existing CRM records.
-- Qualification is read from actual purchases; credits are consumed once.
create table public.client_referral_rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 100),
  referrals_required integer not null check (referrals_required between 1 and 1000),
  reward_type text not null check (reward_type in ('free_minutes','normal_minutes','coins','oracle','roulette','rank')),
  amount integer not null check (amount between 1 and 1000000),
  roulette_level integer,
  rank_key text,
  rank_days integer,
  enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.workers(id),
  updated_by uuid not null references public.workers(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((reward_type='roulette' and roulette_level is not null and roulette_level between 1 and 5 and amount<=100)
    or (reward_type<>'roulette' and roulette_level is null)),
  check ((reward_type='rank' and rank_key is not null and rank_key in ('oro','diamante') and rank_days is not null and rank_days between 1 and 365 and amount=1)
    or (reward_type<>'rank' and rank_key is null and rank_days is null)),
  check (reward_type not in ('free_minutes','normal_minutes') or amount<=10000),
  check (reward_type<>'oracle' or amount<=100)
);
create index client_referral_rewards_created_by_idx on public.client_referral_rewards(created_by);
create index client_referral_rewards_updated_by_idx on public.client_referral_rewards(updated_by);
create index client_referral_rewards_enabled_idx on public.client_referral_rewards(referrals_required,id) where enabled;

create table public.client_referral_reward_events (
  operation_id uuid primary key,
  reward_id uuid not null references public.client_referral_rewards(id),
  actor_worker_id uuid not null references public.workers(id),
  request jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index client_referral_reward_events_reward_idx on public.client_referral_reward_events(reward_id,created_at desc);
create index client_referral_reward_events_actor_idx on public.client_referral_reward_events(actor_worker_id);

create table public.client_referral_claims (
  id uuid primary key,
  cliente_id uuid not null references public.crm_clientes(id),
  auth_user_id uuid not null,
  reward_id uuid not null references public.client_referral_rewards(id),
  reward_version integer not null,
  reward_snapshot jsonb not null,
  referral_ids uuid[] not null check (cardinality(referral_ids)>0),
  receipt jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index client_referral_claims_client_idx on public.client_referral_claims(cliente_id,created_at desc);
create index client_referral_claims_reward_idx on public.client_referral_claims(reward_id);

create table public.client_referrals (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  referrer_id uuid not null references public.crm_clientes(id),
  referred_id uuid not null unique references public.crm_clientes(id),
  created_by uuid not null references public.workers(id),
  actor_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  claimed_by uuid references public.client_referral_claims(id),
  check (referrer_id<>referred_id)
);
create index client_referrals_referrer_idx on public.client_referrals(referrer_id,created_at,id);
create index client_referrals_available_idx on public.client_referrals(referrer_id,created_at,id) where claimed_by is null;
create index client_referrals_created_by_idx on public.client_referrals(created_by);
create index client_referrals_claim_idx on public.client_referrals(claimed_by) where claimed_by is not null;

alter table public.client_referral_rewards enable row level security;
alter table public.client_referral_reward_events enable row level security;
alter table public.client_referral_claims enable row level security;
alter table public.client_referrals enable row level security;
revoke all on public.client_referral_rewards,public.client_referral_reward_events,public.client_referral_claims,public.client_referrals from public,anon,authenticated;
grant select,insert,update on public.client_referral_rewards,public.client_referral_claims,public.client_referrals to service_role;
grant select,insert on public.client_referral_reward_events to service_role;

-- Same purchase convention as tc_crm_client_priority_page. Any linked payment,
-- even cancelled/refunded, suppresses its legacy call so refunds cannot reappear.
create function public.tc_referral_paid_total(p_cliente_id uuid) returns numeric
language sql stable security invoker set search_path='' as $$
  select coalesce(sum(p.amount),0) from (
    select importe as amount from public.crm_cliente_pagos
      where cliente_id=p_cliente_id and estado='completed' and importe>0 and created_at<=now()
    union all
    select l.importe from public.rendimiento_llamadas l
      where btrim(coalesce(l.cliente_id,''))=p_cliente_id::text and l.importe>0
        and l.created_at<=now() and coalesce(l.fecha_hora,l.created_at)<=now()
        and not exists(select 1 from public.crm_cliente_pagos p where p.source_rendimiento_id=l.id)
  ) p;
$$;

create function public.tc_client_referral_status(p_referrer_id uuid)
returns table(id uuid,referrer_id uuid,referred_id uuid,created_at timestamptz,claimed_by uuid,paid_total numeric,qualified boolean,status text)
language sql stable security invoker set search_path='' as $$
  select r.id,r.referrer_id,r.referred_id,r.created_at,r.claimed_by,p.total,p.total>10,
    case when r.claimed_by is not null then 'claimed' when p.total>10 then 'available' else 'pending' end
  from public.client_referrals r
  cross join lateral (select public.tc_referral_paid_total(r.referred_id) total) p
  where r.referrer_id=p_referrer_id order by r.created_at,r.id;
$$;

create function public.tc_save_referral_reward(
  p_reward_id uuid,p_expected_version integer,p_data jsonb,
  p_actor_worker_id uuid,p_actor_user_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.client_referral_rewards%rowtype; v_new public.client_referral_rewards%rowtype;
  v_event public.client_referral_reward_events%rowtype; v_request jsonb; v_title text; v_type text;
  v_amount integer; v_required integer; v_level integer; v_days integer; v_rank text; v_enabled boolean;
begin
  if not exists(select 1 from public.workers where id=p_actor_worker_id and user_id=p_actor_user_id
    and is_active is distinct from false and (role='admin' or public.tc_worker_has_admin_access(id)))
  then raise exception 'REFERRAL_FORBIDDEN'; end if;
  if p_reward_id is null or p_operation_id is null or jsonb_typeof(p_data) is distinct from 'object'
    or coalesce(p_data->>'amount','') !~ '^[1-9][0-9]{0,6}$'
    or coalesce(p_data->>'referrals_required','') !~ '^[1-9][0-9]{0,3}$'
    or jsonb_typeof(p_data->'enabled') is distinct from 'boolean'
  then raise exception 'REFERRAL_INVALID_REWARD'; end if;
  v_title:=btrim(coalesce(p_data->>'title','')); v_type:=p_data->>'reward_type';
  v_amount:=(p_data->>'amount')::integer; v_required:=(p_data->>'referrals_required')::integer;
  v_enabled:=(p_data->>'enabled')::boolean;
  if v_type='roulette' then
    if coalesce(p_data->>'roulette_level','') !~ '^[1-5]$' then raise exception 'REFERRAL_INVALID_REWARD'; end if;
    v_level:=(p_data->>'roulette_level')::integer;
  end if;
  if v_type='rank' then
    if coalesce(p_data->>'rank_days','') !~ '^[1-9][0-9]{0,2}$' then raise exception 'REFERRAL_INVALID_REWARD'; end if;
    v_days:=(p_data->>'rank_days')::integer; v_rank:=p_data->>'rank_key';
  end if;
  v_request:=jsonb_build_object('reward_id',p_reward_id,'expected_version',p_expected_version,
    'data',p_data,'actor_user_id',p_actor_user_id);
  perform pg_advisory_xact_lock(hashtextextended('referral-operation:'||p_operation_id,0));
  select * into v_event from public.client_referral_reward_events where operation_id=p_operation_id;
  if found then
    if v_event.request is distinct from v_request or v_event.actor_worker_id<>p_actor_worker_id then raise exception 'REFERRAL_OPERATION_REUSED'; end if;
    return v_event.after_state;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-catalog:'||p_reward_id,0));
  select * into v_old from public.client_referral_rewards where id=p_reward_id for update;
  if (v_old.id is null and coalesce(p_expected_version,0)<>0)
    or (v_old.id is not null and v_old.version is distinct from p_expected_version) then raise exception 'REFERRAL_REWARD_CHANGED'; end if;
  insert into public.client_referral_rewards(id,title,referrals_required,reward_type,amount,roulette_level,rank_key,rank_days,enabled,created_by,updated_by)
    values(p_reward_id,v_title,v_required,v_type,v_amount,v_level,v_rank,v_days,v_enabled,p_actor_worker_id,p_actor_worker_id)
  on conflict(id) do update set title=excluded.title,referrals_required=excluded.referrals_required,
    reward_type=excluded.reward_type,amount=excluded.amount,roulette_level=excluded.roulette_level,
    rank_key=excluded.rank_key,rank_days=excluded.rank_days,enabled=excluded.enabled,
    updated_by=p_actor_worker_id,version=client_referral_rewards.version+1,updated_at=clock_timestamp()
  returning * into v_new;
  insert into public.client_referral_reward_events(operation_id,reward_id,actor_worker_id,request,before_state,after_state)
    values(p_operation_id,p_reward_id,p_actor_worker_id,v_request,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return to_jsonb(v_new);
end;
$$;

create function public.tc_add_client_referral(
  p_referrer_id uuid,p_referred_id uuid,p_actor_worker_id uuid,p_actor_user_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.client_referrals%rowtype; v_referrer public.crm_clientes%rowtype;
  v_referred public.crm_clientes%rowtype; v_phone text; v_referrer_phone text; v_id uuid;
begin
  if not exists(select 1 from public.workers where id=p_actor_worker_id and user_id=p_actor_user_id
    and is_active is distinct from false and (role in ('admin','central') or public.tc_worker_has_admin_access(id)))
  then raise exception 'REFERRAL_FORBIDDEN'; end if;
  if p_referrer_id is null or p_referred_id is null or p_operation_id is null then raise exception 'REFERRAL_INVALID_INPUT'; end if;
  if p_referrer_id=p_referred_id then raise exception 'REFERRAL_SELF'; end if;
  -- Graph changes are infrequent; serializing them prevents reciprocal/concurrent
  -- cycles and duplicate-identity links, without serializing claims or purchases.
  perform pg_advisory_xact_lock(hashtextextended('client-referral-graph',0));
  select * into v_old from public.client_referrals where operation_id=p_operation_id;
  if found then
    if v_old.referrer_id<>p_referrer_id or v_old.referred_id<>p_referred_id
      or v_old.created_by<>p_actor_worker_id or v_old.actor_user_id<>p_actor_user_id then raise exception 'REFERRAL_OPERATION_REUSED'; end if;
    return to_jsonb(v_old);
  end if;
  perform 1 from public.crm_clientes where id in (p_referrer_id,p_referred_id) order by id for share;
  select * into v_referrer from public.crm_clientes where id=p_referrer_id;
  select * into v_referred from public.crm_clientes where id=p_referred_id;
  if v_referrer.id is null or v_referred.id is null then raise exception 'REFERRAL_CLIENT_NOT_FOUND'; end if;
  v_phone:=regexp_replace(coalesce(nullif(v_referred.telefono_normalizado,''),v_referred.telefono,''),'[^0-9]','','g');
  v_referrer_phone:=regexp_replace(coalesce(nullif(v_referrer.telefono_normalizado,''),v_referrer.telefono,''),'[^0-9]','','g');
  if (v_referred.auth_user_id is not null and v_referred.auth_user_id=v_referrer.auth_user_id)
    or (v_phone<>'' and v_phone=v_referrer_phone) then raise exception 'REFERRAL_SELF'; end if;
  if exists(select 1 from public.client_referrals r join public.crm_clientes c on c.id=r.referred_id
    where r.referred_id=p_referred_id or (v_referred.auth_user_id is not null and c.auth_user_id=v_referred.auth_user_id)
      or (v_phone<>'' and regexp_replace(coalesce(nullif(c.telefono_normalizado,''),c.telefono,''),'[^0-9]','','g')=v_phone))
  then raise exception 'REFERRAL_ALREADY_LINKED'; end if;
  if exists(with recursive descendants(id) as (
    select p_referred_id union select r.referred_id from public.client_referrals r join descendants d on d.id=r.referrer_id
  ) select 1 from descendants where id=p_referrer_id) then raise exception 'REFERRAL_CYCLE'; end if;
  insert into public.client_referrals(operation_id,referrer_id,referred_id,created_by,actor_user_id)
    values(p_operation_id,p_referrer_id,p_referred_id,p_actor_worker_id,p_actor_user_id) returning * into v_old;
  insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,event_type,event_data,is_pinned)
    values(p_referrer_id::text,'Referido vinculado. Se habilita para premios al superar 10 € en compras confirmadas.',
      p_actor_user_id,'Equipo','referral_linked',jsonb_build_object('referral_id',v_old.id,'referred_id',p_referred_id),false);
  return to_jsonb(v_old);
end;
$$;

create function public.tc_claim_referral_reward(
  p_cliente_id uuid,p_auth_user_id uuid,p_reward_id uuid,p_expected_version integer,p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_client public.crm_clientes%rowtype; v_reward public.client_referral_rewards%rowtype;
  v_prior public.client_referral_claims%rowtype; v_refs uuid[]; v_ref_clients uuid[]; v_receipt jsonb;
  v_before integer; v_after integer; v_rank_state jsonb; v_rank_id uuid; v_rank_end timestamptz;
  v_spin_ids uuid[]; v_message text; v_total bigint;
begin
  if p_cliente_id is null or p_auth_user_id is null or p_reward_id is null or p_operation_id is null then raise exception 'REFERRAL_INVALID_INPUT'; end if;
  if not exists(select 1 from public.crm_clientes where id=p_cliente_id and auth_user_id=p_auth_user_id)
    or (select count(*) from public.crm_clientes where auth_user_id=p_auth_user_id)<>1 then raise exception 'REFERRAL_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-claim:'||p_operation_id,0));
  select * into v_prior from public.client_referral_claims where id=p_operation_id;
  if found then
    if v_prior.cliente_id<>p_cliente_id or v_prior.auth_user_id<>p_auth_user_id or v_prior.reward_id<>p_reward_id
      or v_prior.reward_version is distinct from p_expected_version then raise exception 'REFERRAL_OPERATION_REUSED'; end if;
    return v_prior.receipt||jsonb_build_object('replayed',true);
  end if;
  -- Existing rank and oracle writers use these client advisory keys before balances.
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text,0));
  perform pg_advisory_xact_lock(hashtext(p_cliente_id::text));
  select * into v_client from public.crm_clientes where id=p_cliente_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'REFERRAL_FORBIDDEN'; end if;
  select * into v_reward from public.client_referral_rewards where id=p_reward_id for share;
  if not found or not v_reward.enabled then raise exception 'REFERRAL_REWARD_UNAVAILABLE'; end if;
  if v_reward.version is distinct from p_expected_version then raise exception 'REFERRAL_REWARD_CHANGED'; end if;
  select array_agg(s.id order by s.created_at,s.id),array_agg(s.referred_id order by s.created_at,s.id)
    into v_refs,v_ref_clients from (
      select r.id,r.referred_id,r.created_at from public.client_referrals r
      where r.referrer_id=p_cliente_id and r.claimed_by is null and public.tc_referral_paid_total(r.referred_id)>10
      order by r.created_at,r.id limit v_reward.referrals_required for update
    ) s;
  if coalesce(cardinality(v_refs),0)<>v_reward.referrals_required then raise exception 'REFERRAL_NOT_ENOUGH'; end if;
  -- Freeze only the purchase evidence selected for this claim. Refund/edit writers
  -- must finish before the eligibility recheck; later refunds never undo a receipt.
  perform 1 from public.crm_cliente_pagos where cliente_id=any(v_ref_clients) order by id for share;
  perform 1 from public.rendimiento_llamadas where btrim(coalesce(cliente_id,''))=any(select x::text from unnest(v_ref_clients) x) order by id for share;
  if exists(select 1 from unnest(v_ref_clients) c where public.tc_referral_paid_total(c)<=10) then raise exception 'REFERRAL_NOT_ENOUGH'; end if;
  if v_reward.reward_type='rank' then
    v_rank_state:=public.tc_client_rank_state(p_cliente_id);
    if exists(select 1 from public.client_rank_overrides where client_id=p_cliente_id and active and (ends_at is null or ends_at>now()))
      or coalesce(array_position(array['bronce','plata','oro','diamante'],v_rank_state->>'effective'),0)
        >=array_position(array['bronce','plata','oro','diamante'],v_reward.rank_key)
    then raise exception 'REFERRAL_RANK_CONFLICT'; end if;
  end if;
  insert into public.client_referral_claims(id,cliente_id,auth_user_id,reward_id,reward_version,reward_snapshot,referral_ids)
    values(p_operation_id,p_cliente_id,p_auth_user_id,p_reward_id,v_reward.version,to_jsonb(v_reward),v_refs);
  v_message:='Premio de referidos · '||v_reward.title;
  v_receipt:=jsonb_build_object('claim_id',p_operation_id,'reward_id',v_reward.id,'title',v_reward.title,
    'reward_type',v_reward.reward_type,'amount',v_reward.amount,'referrals_used',v_reward.referrals_required,
    'created_at',clock_timestamp());
  if v_reward.reward_type in ('free_minutes','normal_minutes','coins') then
    v_before:=case v_reward.reward_type when 'free_minutes' then coalesce(v_client.minutos_free_pendientes,0)
      when 'normal_minutes' then coalesce(v_client.minutos_normales_pendientes,0) else coalesce(v_client.puntos,0) end;
    v_total:=v_before::bigint+v_reward.amount;
    if v_total>2147483647 then raise exception 'REFERRAL_BALANCE_LIMIT'; end if;
    v_after:=v_total::integer;
    if v_reward.reward_type='free_minutes' then update public.crm_clientes set minutos_free_pendientes=v_after,updated_at=now() where id=p_cliente_id;
    elsif v_reward.reward_type='normal_minutes' then update public.crm_clientes set minutos_normales_pendientes=v_after,updated_at=now() where id=p_cliente_id;
    else
      update public.crm_clientes set puntos=v_after,updated_at=now() where id=p_cliente_id;
      insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta)
        values(p_cliente_id,'ganado',v_reward.amount,v_message,p_operation_id,v_after,
          jsonb_build_object('source','referral_reward','claim_id',p_operation_id,'reward_id',p_reward_id));
    end if;
    v_receipt:=v_receipt||jsonb_build_object('before_balance',v_before,'after_balance',v_after);
  elsif v_reward.reward_type='oracle' then
    v_before:=public.get_cliente_oracle_balance(p_cliente_id);
    if v_before::bigint+v_reward.amount>2147483647 then raise exception 'REFERRAL_BALANCE_LIMIT'; end if;
    insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,notes,meta)
      values(p_cliente_id,v_reward.amount,'adjustment','referral:'||p_operation_id,v_message,
        jsonb_build_object('source','referral_reward','claim_id',p_operation_id,'reward_id',p_reward_id));
    v_after:=public.get_cliente_oracle_balance(p_cliente_id);
    if v_after<>v_before+v_reward.amount then raise exception 'REFERRAL_DELIVERY_MISMATCH'; end if;
    v_receipt:=v_receipt||jsonb_build_object('before_balance',v_before,'after_balance',v_after);
  elsif v_reward.reward_type='roulette' then
    with added as (
      insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank)
      select p_cliente_id,'referral:'||p_operation_id||':'||i,'referral_reward',v_reward.roulette_level,'pending',
        case when v_reward.roulette_level=5 then 'diamante' else null end from generate_series(1,v_reward.amount) i returning id
    ) select array_agg(id) into v_spin_ids from added;
    v_receipt:=v_receipt||jsonb_build_object('roulette_level',v_reward.roulette_level,'spin_ids',v_spin_ids);
  elsif v_reward.reward_type='rank' then
    v_rank_end:=now()+make_interval(days=>v_reward.rank_days);
    v_rank_id:=public.set_client_rank_override(v_reward.rank_key,p_cliente_id,v_reward.created_by,v_rank_end,'temporary',
      'referral:'||p_operation_id,v_message,now());
    v_receipt:=v_receipt||jsonb_build_object('rank_key',v_reward.rank_key,'rank_days',v_reward.rank_days,'rank_ends_at',v_rank_end,'rank_override_id',v_rank_id);
  end if;
  update public.client_referrals set claimed_by=p_operation_id where id=any(v_refs) and claimed_by is null;
  if not found then raise exception 'REFERRAL_NOT_ENOUGH'; end if;
  update public.client_referral_claims set receipt=v_receipt where id=p_operation_id;
  insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data,is_pinned)
    values(p_cliente_id::text,v_message||'. Reclamado con '||v_reward.referrals_required||' referido(s).','Sistema','referral_reward_claimed',v_receipt,false);
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,leida,meta,created_at)
    values(p_cliente_id,'referral_reward','Premio de referidos reclamado',v_reward.title||'. Tu premio ya está disponible.',false,v_receipt,now());
  perform public.tc_touch_roulette_signal(p_cliente_id);
  return v_receipt||jsonb_build_object('replayed',false);
end;
$$;

revoke all on function public.tc_referral_paid_total(uuid),public.tc_client_referral_status(uuid),
  public.tc_save_referral_reward(uuid,integer,jsonb,uuid,uuid,uuid),
  public.tc_add_client_referral(uuid,uuid,uuid,uuid,uuid),
  public.tc_claim_referral_reward(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.tc_referral_paid_total(uuid),public.tc_client_referral_status(uuid),
  public.tc_save_referral_reward(uuid,integer,jsonb,uuid,uuid,uuid),
  public.tc_add_client_referral(uuid,uuid,uuid,uuid,uuid),
  public.tc_claim_referral_reward(uuid,uuid,uuid,integer,uuid) to service_role;
comment on table public.client_referrals is 'Staff-verified CRM referrals. Eligible only above 10 in cumulative confirmed purchases. Each referral is consumed by at most one reward claim.';
comment on table public.client_referral_claims is 'Immutable reward snapshot and idempotent delivery receipt. Does not create purchases or additional purchase benefits.';
notify pgrst,'reload schema';
commit;
