-- Customer benefits v2026-11. Employees, balances and awarded prizes are not migrated.
-- Decisions confirmed by Alex on 2026-11-02 02:55:09 UTC:
-- legacy spins: 48h from that instant; passes: one, counting current-cycle uses;
-- Diamond: copy the existing Special catalogue without removing Special.
begin;
set local lock_timeout='5s';
create table if not exists public.tc_customer_benefit_policy (
 id boolean primary key default true check(id),
 version text not null,
 activated_at timestamptz,
 legacy_spin_clock_started_at timestamptz not null,
 ranks jsonb not null,
 diamond_purchase_coins integer not null check(diamond_purchase_coins>=0),
 spin_lifetime_hours integer not null check(spin_lifetime_hours>0),
 pass_cycle_days integer not null check(pass_cycle_days>0),
 pass_transition text not null,
 created_at timestamptz not null default now()
);
alter table public.tc_customer_benefit_policy enable row level security;
revoke all on public.tc_customer_benefit_policy from public,anon,authenticated;
grant select,insert,update on public.tc_customer_benefit_policy to service_role;
insert into public.tc_customer_benefit_policy(id,version,legacy_spin_clock_started_at,ranks,diamond_purchase_coins,spin_lifetime_hours,pass_cycle_days,pass_transition)
values(true,'2026-11-v1','2026-11-02T02:55:09Z',
'{"sin_rango":{"intro_minutes":7,"regular_bonus_minutes":0,"pass_minutes":0},
"bronce":{"intro_minutes":7,"regular_bonus_minutes":0,"pass_minutes":0},
"plata":{"intro_minutes":8,"regular_bonus_minutes":3,"pass_minutes":5,"post_ritual":"1 semana"},
"oro":{"intro_minutes":9,"regular_bonus_minutes":5,"pass_minutes":10,"post_ritual":"1 mes"},
"diamante":{"intro_minutes":12,"regular_bonus_minutes":8,"pass_minutes":12,"post_ritual":"1 mes"}}',
300,48,30,'immediate_count_current_uses') on conflict(id) do nothing;

alter table public.cliente_ruleta_giros add column if not exists expires_at timestamptz;
alter table public.cliente_ruleta_giros add column if not exists expiry_policy text;
alter table public.crm_cliente_pagos add column if not exists customer_benefit_version text;
alter table public.raffle_entries add column if not exists benefit_origin text;
create unique index if not exists raffle_one_rank_number on public.raffle_entries(raffle_id,client_id) where benefit_origin='rank';
create index if not exists customer_spins_pending_expiry on public.cliente_ruleta_giros(cliente_id,nivel,expires_at) where estado='pending';
create index if not exists customer_pass_last_use on public.crm_free_pass_uses(cliente_id,created_at desc);
-- Match the canonical rank predicate, including legacy text IDs and fallback dates.
create index if not exists customer_rank_call_lookup on public.rendimiento_llamadas
 ((pg_catalog.btrim(coalesce(cliente_id,''))), (coalesce(fecha_hora,created_at))) where importe>0;

-- The event ID, not this policy version, remains the deduplication identity.
create or replace function public.tc_customer_payment_is_current(p_payment_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.crm_cliente_pagos; a timestamptz; started timestamptz;
begin
 select * into p from public.crm_cliente_pagos where id=p_payment_id;
 select activated_at into a from public.tc_customer_benefit_policy where id;
 if p.id is null or a is null then return false; end if;
 if p.customer_benefit_version is not null then return p.customer_benefit_version='2026-11-v1'; end if;
 if p.created_at<a then return false; end if;
 started:=nullif(p.benefits_context->>'benefits_started_at','')::timestamptz;
 if started is not null and started<a then return false; end if;
 -- Delayed provider confirmation retains the checkout's original regime.
 if exists(select 1 from public.cliente_payment_attempts x where x.cliente_id=p.cliente_id and x.created_at<a
   and (p.referencia_externa=x.provider||':'||x.order_id or p.referencia_externa=x.order_id or p.stripe_session_id=x.order_id
     or p.benefits_context->>'attempt_id'=x.id::text))
 or exists(select 1 from public.crm_paypal_orders x where x.cliente_id=p.cliente_id and x.created_at<a
   and (x.payment_id=p.id or x.order_id=p.paypal_order_id or x.capture_id=p.paypal_capture_id
     or p.referencia_externa in ('paypal:'||x.capture_id,'paypal:'||x.order_id)
     or p.benefits_context->>'paypal_collection_order_id'=x.id::text))
 then return false; end if;
 return true;
end $$;

-- Server-owned shared policy, including the existing rank x package quantities.
create or replace function public.tc_customer_benefits_config()
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('redemptions',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',r.id,'minutes',r.minutos_otorgados,'coins',r.puntos_coste) order by r.minutos_otorgados),'[]') from public.recompensas r where r.activo),
 'package_benefits',(select coalesce(jsonb_agg((to_jsonb(b)-'updated_by')||case when b.rank_key='diamante' and p.activated_at is not null then
 jsonb_build_object('enabled',true,'coins',p.diamond_purchase_coins,'roulette_level_1_spins',0,'roulette_level_2_spins',0,
 'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',1) else '{}'::jsonb end order by b.rank_key,b.package_level),'[]')
 from public.tc_rank_package_benefits b)) from public.tc_customer_benefit_policy p where p.id
$$;

create or replace function public.tc_customer_spin_expiry()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.tc_customer_benefit_policy;
begin
 if tg_op='INSERT' then
  select * into p from public.tc_customer_benefit_policy where id;
  if p.activated_at is not null and new.nivel in (1,2,3,5) then
   new.expires_at:=coalesce(new.created_at,clock_timestamp())+make_interval(hours=>p.spin_lifetime_hours);
   new.expiry_policy:=p.version;
  end if;
 elsif old.estado='pending' and new.estado='used' and old.expires_at is not null and old.expires_at<=clock_timestamp() then
  raise exception 'SPIN_EXPIRED';
 end if;
 return new;
end $$;
drop trigger if exists z_customer_spin_expiry on public.cliente_ruleta_giros;
create trigger z_customer_spin_expiry before insert or update of estado on public.cliente_ruleta_giros
for each row execute function public.tc_customer_spin_expiry();

-- Only these customer programme functions are executable through the verified API.
CREATE OR REPLACE FUNCTION public.tc_apply_purchase_benefits_before_202611(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.crm_cliente_pagos%rowtype; r jsonb; cfg jsonb; ctx jsonb; q jsonb; k text;
  base_coins integer; bonus_coins integer; oc integer; n integer; lvl smallint; s uuid; e uuid; i integer;
  v_package_source text; v_package_key text; v_package_level smallint; v_matrix boolean:=false; v_matrix_result jsonb:='{}'::jsonb; v_policy jsonb; v_eligible boolean; v_spin_eligible boolean;
begin
  select * into p from public.crm_cliente_pagos where id=p_payment_id;
  if p.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=p.cliente_id for update;
  select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
  if p.estado<>'completed' or p.importe<=0 or p.benefits_processed_at is not null then return '{}'::jsonb; end if;

  v_policy:=public.tc_purchase_reward_policy(p.id);
  v_eligible:=coalesce((v_policy->>'coins_eligible')::boolean,false);
  v_spin_eligible:=coalesce((v_policy->>'roulette_eligible')::boolean,false);
  q:=public.tc_purchase_benefit_quote(p.importe,p.moneda);
  v_package_source:=case when coalesce(p.pack_id,'') like 'promo:%' then 'promotion' else 'standard' end;
  v_package_key:=case when v_package_source='promotion' then substring(p.pack_id from 7) else p.pack_id end;
  select x.package_level into v_package_level from public.tc_purchase_package_levels x
   where x.package_source=v_package_source and x.package_key=v_package_key;
  if v_package_level is null and p.source_rendimiento_id is not null and v_policy->>'pricing_mode'='regular' then
    v_package_level:=(q->>'roulette_level')::smallint;
  end if;
  v_matrix:=v_package_level is not null;

  r:=public.tc_client_rank_state(p.cliente_id); cfg:=r->'config'; ctx:=coalesce(p.benefits_context,'{}'::jsonb);
  base_coins:=case when v_eligible and not (v_matrix and p.source_rendimiento_id is not null and v_policy->>'pricing_mode'='regular') then greatest(coalesce((ctx->>'coins')::integer,0),0) else 0 end;
  bonus_coins:=case when v_eligible and not v_matrix and (cfg->>'is_active')::boolean and (cfg->>'coins_enabled')::boolean then (cfg->>'purchase_coins')::integer else 0 end;
  oc:=greatest(coalesce((ctx->>'oracle_credits')::integer,0),0);
  if base_coins>0 or bonus_coins>0 then
    update public.crm_clientes set puntos=coalesce(puntos,0)+base_coins+bonus_coins,updated_at=now() where id=p.cliente_id;
  end if;
  for k,n in select * from (values('pack_coins',base_coins),('rank_coins',bonus_coins)) v(k,n) loop
    if n>0 then
      insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,coins,snapshot)
      values(p.cliente_id,p.id,r->>'effective',k,'coins',p.importe,p.moneda,n,jsonb_build_object('config',cfg,'context',ctx)) returning id into e;
      insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta)
      select p.cliente_id,'ganado',n,case when k='rank_coins' then 'Beneficio de rango · '||coalesce(cfg->>'label','') else 'Beneficio del pack' end,
        e,round(coalesce(c.puntos,0)-case when k='pack_coins' then bonus_coins else 0 end)::integer,jsonb_build_object('payment_id',p.id,'benefit_event_id',e,'rank',r->>'effective')
      from public.crm_clientes c where c.id=p.cliente_id;
    end if;
  end loop;
  if oc>0 then
    insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,pack_id,notes,meta)
    values(p.cliente_id,oc,'purchase','benefit:'||p.id||':oracle',coalesce(p.pack_id,'purchase'),'Beneficio de compra',jsonb_build_object('payment_id',p.id)) on conflict(reference) do nothing;
    insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,oracle_credits,snapshot)
    values(p.cliente_id,p.id,r->>'effective','pack_oracle','oracle_credits',p.importe,p.moneda,oc,ctx);
  end if;
  q:=public.tc_purchase_benefit_quote(p.importe,p.moneda);
  for k,lvl,n in select * from (values
    ('purchase_roulette',case when coalesce((ctx->>'special_spins')::integer,0)>0 then 4::smallint else (q->>'roulette_level')::smallint end,
      case when coalesce((ctx->>'special_spins')::integer,0)>0 then (ctx->>'special_spins')::integer else coalesce((q->>'roulette_spins')::integer,0) end),
    ('rank_roulette',(cfg->>'roulette_level')::smallint,
      case when v_eligible and not v_matrix and (cfg->>'is_active')::boolean and (cfg->>'roulette_enabled')::boolean then (cfg->>'roulette_spins')::integer else 0 end)
  ) v(k,lvl,n) loop
    if v_policy->>'pricing_mode'='super_promo' then
      lvl:=4; n:=case when k='purchase_roulette' then 1 else 0 end;
    end if;
    if v_spin_eligible and lvl is not null and n>0 then
      for i in 1..n loop
        insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
        values(p.cliente_id,
          case when v_policy->>'pricing_mode'='super_promo' and p.source_rendimiento_id is not null and k='purchase_roulette'
            then 'rendimiento:'||p.source_rendimiento_id::text else 'benefit:'||p.id||':'||k||':'||i end,
          case when v_policy->>'pricing_mode'='super_promo' and p.source_rendimiento_id is not null and k='purchase_roulette'
            then 'super_promo_ruleta' else 'rank_benefits' end,lvl,p.id,p.importe,p.moneda,'pending',
          case when k='rank_roulette' then r->>'effective' end) returning id into s;
        insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,spin_id,snapshot)
        values(p.cliente_id,p.id,r->>'effective',k||':'||i,'roulette',p.importe,p.moneda,s,jsonb_build_object('level',lvl,'band',q,'config',cfg,'context',ctx));
      end loop;
    end if;
  end loop;

  if v_matrix then
    v_matrix_result:=public.tc_apply_rank_package_benefits_before_202611(p.id);
  end if;

  perform public.tc_grant_diamond_purchase_minutes(p.id);
  update public.crm_cliente_pagos set benefits_processed_at=now() where id=p.id;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,r->>'effective','purchase_processed','processed',p.importe,p.moneda,jsonb_build_object('rank_state',r,'context',ctx,'rank_package_matrix',v_matrix_result,'reward_policy',v_policy));
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p.cliente_id,'purchase_benefits','Beneficios de compra actualizados',case when v_eligible then 'Los beneficios de tu compra ya están disponibles en tu saldo y en tus ruletas.' when v_policy->>'pricing_mode'='super_promo' then 'Tu giro de Super Promo Ruleta ya está disponible.' else 'Compra registrada. Esta tarifa no incluye Coins ni giros de ruleta.' end,
    jsonb_build_object('payment_id',p.id,'rank',r->>'effective','coins',base_coins+bonus_coins,'rank_package_matrix',v_matrix_result),false,now());
  perform public.tc_touch_roulette_signal(p.cliente_id);
  return jsonb_build_object('rank',r->>'effective','coins',base_coins+bonus_coins,'oracle_credits',oc,'rank_package_matrix',v_matrix_result,'reward_policy',v_policy);
end $function$;


CREATE OR REPLACE FUNCTION public.tc_apply_rank_package_benefits_before_202611(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.crm_cliente_pagos%rowtype;
  v_source text;
  v_key text;
  v_resolution jsonb;
  v_cfg jsonb;
  v_rank_key text;
  v_level smallint;
  v_status text;
  v_event uuid;
  v_existing jsonb;
  v_snapshot jsonb;
  v_spin_ids jsonb := '[]'::jsonb;
  v_spin uuid;
  v_i integer;
  v_coins integer := 0;
  v_oracle integer := 0;
  v_n1 integer := 0;
  v_n2 integer := 0;
  v_n3 integer := 0;
  v_special integer := 0;
  v_policy jsonb; v_rank_state jsonb; v_band jsonb;
begin
  select * into p
  from public.crm_cliente_pagos
  where id = p_payment_id
  for update;

  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  select e.snapshot into v_existing
  from public.tc_client_benefit_events e
  where e.delivery_key = 'rank-package:' || p.id::text
  limit 1;

  if v_existing is not null then
    return v_existing || jsonb_build_object('duplicate_prevented', true);
  end if;

  if lower(coalesce(p.estado,'')) <> 'completed' or coalesce(p.importe,0) <= 0 then
    return jsonb_build_object('status','payment_not_completed');
  end if;

  v_source := case when coalesce(p.pack_id,'') like 'promo:%' then 'promotion' else 'standard' end;
  v_key := case when v_source='promotion' then substring(p.pack_id from 7) else p.pack_id end;

  v_policy:=public.tc_purchase_reward_policy(p.id);
  if nullif(v_key,'') is null and p.source_rendimiento_id is not null and v_policy->>'pricing_mode'='regular' then
    v_band:=public.tc_purchase_benefit_quote(p.importe,p.moneda);
    v_level:=(v_band->>'roulette_level')::smallint;
    v_rank_state:=public.tc_client_rank_state(p.cliente_id);
    v_rank_key:=v_rank_state->>'effective';
    select to_jsonb(b) into v_cfg from public.tc_rank_package_benefits b where b.rank_key=v_rank_key and b.package_level=v_level;
    v_resolution:=jsonb_build_object('status',case when v_cfg is null then 'config_missing' when coalesce((v_cfg->>'enabled')::boolean,false) then 'ready' else 'disabled' end,
      'rank_key',v_rank_key,'rank_state',v_rank_state,'package_source','regular_amount_band','package_key',null,'package_level',v_level,'rank_benefits',v_cfg,'amount_band',v_band);
  else
  v_resolution := public.tc_resolve_rank_package_benefit_before_202611(
    p.cliente_id,
    null,
    v_source,
    coalesce(v_key,''),
    null
  );
  end if;

  v_status := coalesce(v_resolution->>'status','config_missing');
  v_rank_key := nullif(v_resolution->>'rank_key','');
  v_level := nullif(v_resolution->>'package_level','')::smallint;
  v_cfg := v_resolution->'rank_benefits';

  if v_status = 'ready' then
    v_coins := greatest(0,coalesce((v_cfg->>'coins')::integer,0));
    v_oracle := greatest(0,coalesce((v_cfg->>'oracle_credits')::integer,0));
    v_n1 := greatest(0,coalesce((v_cfg->>'roulette_level_1_spins')::integer,0));
    v_n2 := greatest(0,coalesce((v_cfg->>'roulette_level_2_spins')::integer,0));
    v_n3 := greatest(0,coalesce((v_cfg->>'roulette_level_3_spins')::integer,0));
    v_special := greatest(0,coalesce((v_cfg->>'roulette_special_spins')::integer,0));
  end if;

  if not coalesce((v_policy->>'coins_eligible')::boolean,false) then v_coins:=0; end if;
  if v_policy->>'pricing_mode'<>'regular' then
    v_n1:=0;v_n2:=0;v_n3:=0;v_special:=0;
  end if;
  v_snapshot := jsonb_build_object(
    'reward_policy',v_policy,
    'status', v_status,
    'payment_id', p.id,
    'resolution', v_resolution,
    'native_benefits_context', p.benefits_context
  );

  insert into public.tc_client_benefit_events(
    cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,
    coins,oracle_credits,package_level,delivery_key,snapshot
  ) values(
    p.cliente_id,p.id,v_rank_key,'rank_package:'||coalesce(v_level::text,'none'),'rank_package',p.importe,p.moneda,
    v_coins,v_oracle,v_level,'rank-package:'||p.id::text,v_snapshot
  ) returning id into v_event;

  if v_status <> 'ready' then
    return v_snapshot;
  end if;

  if v_coins > 0 then
    update public.crm_clientes
    set puntos = coalesce(puntos,0) + v_coins,
        updated_at = now()
    where id = p.cliente_id;

    insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,meta)
    values(
      p.cliente_id,'ganado',v_coins,
      'Beneficio de rango · paquete nivel '||v_level,
      jsonb_build_object('payment_id',p.id,'benefit_event_id',v_event,'rank',v_rank_key,'package_level',v_level)
    );
  end if;

  if v_oracle > 0 then
    perform public.grant_cliente_oracle_credits(
      p.cliente_id,
      v_oracle,
      'rank-package:'||p.id::text||':oracle',
      'rank_package',
      'Beneficio de rango por compra',
      jsonb_build_object('payment_id',p.id,'benefit_event_id',v_event,'package_level',v_level,'rank',v_rank_key)
    );
  end if;

  for v_i in 1..v_n1 loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l1:'||v_i,'rank_package_matrix',1,p.id,p.importe,p.moneda,'pending',v_rank_key)
    returning id into v_spin;
    v_spin_ids := v_spin_ids || to_jsonb(v_spin);
  end loop;

  for v_i in 1..v_n2 loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l2:'||v_i,'rank_package_matrix',2,p.id,p.importe,p.moneda,'pending',v_rank_key)
    returning id into v_spin;
    v_spin_ids := v_spin_ids || to_jsonb(v_spin);
  end loop;

  for v_i in 1..v_n3 loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l3:'||v_i,'rank_package_matrix',3,p.id,p.importe,p.moneda,'pending',v_rank_key)
    returning id into v_spin;
    v_spin_ids := v_spin_ids || to_jsonb(v_spin);
  end loop;

  for v_i in 1..v_special loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l4:'||v_i,'rank_package_matrix',4,p.id,p.importe,p.moneda,'pending',v_rank_key)
    returning id into v_spin;
    v_spin_ids := v_spin_ids || to_jsonb(v_spin);
  end loop;

  v_snapshot := v_snapshot || jsonb_build_object(
    'delivered', jsonb_build_object(
      'coins', v_coins,
      'oracle_credits', v_oracle,
      'roulette_level_1_spins', v_n1,
      'roulette_level_2_spins', v_n2,
      'roulette_level_3_spins', v_n3,
      'roulette_special_spins', v_special,
      'spin_ids', v_spin_ids
    )
  );

  update public.tc_client_benefit_events
  set snapshot = v_snapshot
  where id = v_event;

  perform public.tc_touch_roulette_signal(p.cliente_id);

  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(
    p.cliente_id,
    'rank_package_benefits',
    'Beneficios de rango aplicados',
    'Tus beneficios adicionales por rango y nivel de paquete ya están disponibles.',
    jsonb_build_object('payment_id',p.id,'rank',v_rank_key,'package_level',v_level,'benefit_event_id',v_event),
    false,
    now()
  );

  return v_snapshot;
exception
  when unique_violation then
    select e.snapshot into v_existing
    from public.tc_client_benefit_events e
    where e.delivery_key = 'rank-package:' || p_payment_id::text
    limit 1;
    if v_existing is not null then
      return v_existing || jsonb_build_object('duplicate_prevented', true);
    end if;
    raise;
end;
$function$;


CREATE OR REPLACE FUNCTION public.crm_free_pass_status_before_202611(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_first timestamptz;
  v_last timestamptz;
  v_eligible boolean;
  v_rank text;
  v_rank_eligible boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer := 0;
  v_policy public.crm_free_pass_policy%rowtype;
begin
  select * into strict v_policy
  from public.crm_free_pass_policy
  where id;

  -- Preserve the historical confirmed-purchase and original cycle rules.
  -- El primer pago conserva el calendario de ciclos existente.
  select min(t), max(t)
  into v_first, v_last
  from (
    select p.created_at as t
    from public.crm_cliente_pagos p
    where p.cliente_id = p_cliente_id
      and p.estado = 'completed'
      and p.importe > 0

    union all

    select coalesce(r.fecha_hora, r.created_at)
    from public.rendimiento_llamadas r
    where r.cliente_id = p_cliente_id::text
      and r.cliente_compra_minutos
      and r.importe > 0
      and not coalesce(r.misma_compra, false)
      and not exists (
        select 1
        from public.crm_cliente_pagos p
        where p.source_rendimiento_id = r.id
      )
  ) purchases
  where t <= now();

  v_rank := public.tc_client_rank_state(p_cliente_id)->>'effective';
  v_rank_eligible := coalesce(v_rank in ('plata', 'oro', 'diamante'), false);
  v_eligible := v_first is not null and v_rank_eligible;

  if v_first is not null then
    v_start := v_first
      + floor(
          extract(epoch from (now() - v_first))
          / (v_policy.cycle_days * 86400)
        ) * make_interval(days => v_policy.cycle_days);
    v_end := v_start + make_interval(days => v_policy.cycle_days);

    select count(*)
    into v_used
    from public.crm_free_pass_uses
    where cliente_id = p_cliente_id
      and cycle_start = v_start;
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'effective_rank', v_rank,
    'rank_eligible', v_rank_eligible,
    'eligibility_reason', case
      when not v_rank_eligible then 'RANK_NOT_ELIGIBLE'
      when v_first is null then 'NO_CONFIRMED_PURCHASE'
      else null
    end,
    'last_purchase_at', v_last,
    'eligible_until', null,
    'total', v_policy.passes,
    'available', case
      when not v_eligible then 0
      else greatest(0, v_policy.passes - v_used)
    end,
    'used', v_used,
    'minutes', v_policy.minutes,
    'cycle_days', v_policy.cycle_days,
    'cycle_start', v_start,
    'renews_at', v_end
  );
end
$function$;


CREATE OR REPLACE FUNCTION public.tc_claim_rank_bonus_before_202611(p_cliente_id uuid, p_promotion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.tc_available_rank_bonuses_before_202611(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.tc_apply_configured_purchase_before_202611(p_kind text, p_payload jsonb, p_rank text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb; pay public.crm_cliente_pagos%rowtype; a public.cliente_payment_attempts%rowtype;
 snap jsonb; base jsonb; b jsonb; resolution jsonb; v_promotion boolean:=false;
 v_coins integer; v_free integer; v_oracle integer; app_id uuid; i integer; v_spin_count integer; v_level integer; balances jsonb; summary text;
begin
 if p_kind='promotion' then
  select * into strict a from public.cliente_payment_attempts where id=(p_payload->>'attempt_id')::uuid;
  snap:=a.promotion_snapshot;
  base:=jsonb_build_object('coins',snap->'coins','free_minutes',snap->'free_minutes','oracle_credits',snap->'oracle_credits','roulette_spins',snap->'roulette_spins','roulette_level',snap->'roulette_level');
  v_promotion:=true;
  result:=public.cliente_confirmar_compra_promocion_v1(a.id);
 elsif p_kind='manual' then
  result:=public.crm_register_call_atomic_v8(p_payload);
  if result->'payment' is null or result->'payment'='null'::jsonb then return result; end if;
  b:=coalesce(p_payload->'purchase_benefits','{}');
  v_promotion:=coalesce(b->>'source','')='active_promotion' or coalesce((p_payload->>'promo')::boolean,false);
  base:=jsonb_build_object('coins',coalesce((p_payload->>'points_to_add')::integer,0),'free_minutes',coalesce((p_payload->>'purchase_free_minutes')::integer,0),'oracle_credits',coalesce((b->>'oracle_credits')::integer,0));
 elsif p_kind in ('web','pack') then
  if p_kind='pack' then result:=public.cliente_confirmar_compra_ruleta_v3(p_payload);
  else result:=public.cliente_confirmar_compra_ruleta_v2(p_payload); end if;
  base:=jsonb_build_object('coins',coalesce((p_payload->>'points')::integer,0),'free_minutes',coalesce((p_payload->>'free')::integer,0),'oracle_credits',coalesce((p_payload->>'oracle_credits')::integer,0));
 else raise exception 'INVALID_PURCHASE_KIND'; end if;
 select * into strict pay from public.crm_cliente_pagos where id=(result->'payment'->>'id')::uuid for update;
 if coalesce((result->>'duplicated')::boolean,false) or coalesce((result->>'duplicate_prevented')::boolean,false) then
  select snapshot into resolution from public.client_benefit_applications where operation_key='purchase:'||pay.id;
  return result||jsonb_build_object('configured_benefits',resolution);
 end if;
 if pay.estado<>'completed' then raise exception 'PAYMENT_NOT_CONFIRMED'; end if;
 -- Include the actual spin generated by the existing trigger, not a second guessed formula.
 select count(*),max(nivel) into v_spin_count,v_level from public.cliente_ruleta_giros
  where purchase_id=pay.id or (pay.source_rendimiento_id is not null and payment_key='rendimiento:'||pay.source_rendimiento_id);
 base:=base||jsonb_build_object('roulette_spins',v_spin_count,'roulette_level',v_level);
 resolution:=public.tc_evaluate_benefits(p_rank,pay.importe,upper(pay.moneda),v_promotion,base);
 b:=resolution->'benefits';
 v_coins:=coalesce((b->>'coins')::integer,0)-coalesce((base->>'coins')::integer,0);
 v_free:=coalesce((b->>'free_minutes')::integer,0)-coalesce((base->>'free_minutes')::integer,0);
 v_oracle:=coalesce((b->>'oracle_credits')::integer,0)-coalesce((base->>'oracle_credits')::integer,0);
 insert into public.client_benefit_applications(client_id,payment_id,operation_key,snapshot)
  values(pay.cliente_id,pay.id,'purchase:'||pay.id,resolution) returning id into app_id;
 update public.crm_clientes set puntos=coalesce(puntos,0)+v_coins,minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+v_free,updated_at=now() where id=pay.cliente_id;
 if exists(select 1 from public.crm_clientes where id=pay.cliente_id and (puntos<0 or minutos_free_pendientes<0)) then raise exception 'BENEFIT_CHANGE_EXCEEDS_AVAILABLE_BALANCE'; end if;
 if v_coins<>0 then
  insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,meta)
   values(pay.cliente_id,'ganado',v_coins,'Ajuste de beneficios configurados · compra '||pay.id,app_id,resolution||jsonb_build_object('payment_id',pay.id));
 end if;
 if v_oracle<>0 then
  insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,notes,meta)
   values(pay.cliente_id,v_oracle,'adjustment','benefits:'||app_id,'Beneficios configurados de compra',resolution);
 end if;
 if (b->>'roulette_spins')::integer<>v_spin_count or ((b->>'roulette_level')::integer is distinct from v_level and (b->>'roulette_spins')::integer>0) then
  delete from public.cliente_ruleta_giros where estado='pending' and (purchase_id=pay.id or (pay.source_rendimiento_id is not null and payment_key='rendimiento:'||pay.source_rendimiento_id));
  for i in 1..coalesce((b->>'roulette_spins')::integer,0) loop
   insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency)
    values(pay.cliente_id,'benefits:'||pay.id||':'||i,'configured_purchase',(b->>'roulette_level')::smallint,pay.id,pay.importe,pay.moneda);
  end loop;
 end if;
 summary:='Beneficios de compra confirmados: '||coalesce(b->>'coins','0')||' Coins; '||coalesce(b->>'free_minutes','0')||' minutos FREE; '||coalesce(b->>'oracle_credits','0')||' tiradas Oráculo; '||coalesce(b->>'roulette_spins','0')||' giros.';
 select jsonb_build_object('free',minutos_free_pendientes,'normal',minutos_normales_pendientes,'coins',puntos,'free_after',minutos_free_pendientes,'normal_after',minutos_normales_pendientes,'coins_after',puntos) into balances from public.crm_clientes where id=pay.cliente_id;
 update public.cliente_notificaciones set mensaje=summary,meta=coalesce(meta,'{}')||jsonb_build_object('configured_benefits',resolution,'balances',balances)
  where cliente_id=pay.cliente_id and meta->>'payment_id'=pay.id::text and tipo='purchase_benefits';
 insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data)
 values(pay.cliente_id::text,summary,'Sistema','configured_purchase_benefits',resolution||jsonb_build_object('payment_id',pay.id));
 return result||jsonb_build_object('configured_benefits',resolution,'balances',coalesce(result->'balances','{}')||balances);
end $function$;


CREATE OR REPLACE FUNCTION public.tc_resolve_rank_package_benefit_before_202611(p_cliente_id uuid, p_rank_key_override text, p_package_source text, p_package_key text, p_config_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rank_state jsonb := null;
  v_rank_key text := null;
  v_level smallint := null;
  v_assignment jsonb := null;
  v_cfg jsonb := null;
  v_legacy jsonb := null;
  v_status text := 'config_missing';
begin
  if p_package_source not in ('standard','promotion') then
    raise exception 'INVALID_PACKAGE_SOURCE';
  end if;
  if nullif(btrim(coalesce(p_package_key,'')), '') is null then
    raise exception 'INVALID_PACKAGE_KEY';
  end if;

  if p_cliente_id is not null then
    v_rank_state := public.tc_client_rank_state(p_cliente_id);
    v_rank_key := nullif(v_rank_state->>'effective','');
  else
    v_rank_key := nullif(btrim(coalesce(p_rank_key_override,'')), '');
  end if;

  select to_jsonb(x), x.package_level
    into v_assignment, v_level
  from public.tc_purchase_package_levels x
  where x.package_source = p_package_source
    and x.package_key = p_package_key
  limit 1;

  if v_rank_key is not null then
    select jsonb_build_object(
      'rank_key', r.rank_key,
      'label', r.label,
      'is_active', r.is_active,
      'coins_enabled', r.coins_enabled,
      'purchase_coins', r.purchase_coins,
      'roulette_enabled', r.roulette_enabled,
      'roulette_level', r.roulette_level,
      'roulette_spins', r.roulette_spins,
      'ritual_access', r.ritual_access,
      'daily_bonus_enabled', r.daily_bonus_enabled
    )
      into v_legacy
    from public.tc_client_rank_benefits r
    where r.rank_key = v_rank_key;
  end if;

  if v_level is null then
    v_status := 'unmapped_package';
  elsif v_rank_key is null then
    v_status := 'no_effective_rank';
  else
    if p_config_override is not null
       and p_config_override->>'rank_key' = v_rank_key
       and nullif(p_config_override->>'package_level','')::smallint = v_level then
      v_cfg := p_config_override;
    else
      select to_jsonb(b)
        into v_cfg
      from public.tc_rank_package_benefits b
      where b.rank_key = v_rank_key
        and b.package_level = v_level;
    end if;

    if v_cfg is null then
      v_status := 'config_missing';
    elsif coalesce((v_cfg->>'enabled')::boolean, false) then
      v_status := 'ready';
    else
      v_status := 'disabled';
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'rank_key', v_rank_key,
    'rank_state', v_rank_state,
    'package_source', p_package_source,
    'package_key', p_package_key,
    'package_level', v_level,
    'package_assignment', v_assignment,
    'rank_benefits', v_cfg,
    'legacy_purchase_benefits', v_legacy,
    -- Política vigente: si hay nivel administrado, la matriz sustituye los
    -- antiguos extras globales de compra del rango. Los beneficios propios
    -- del pack/promoción SIEMPRE se conservan y se acumulan.
    'legacy_general_applies', (v_level is null)
  );
end;
$function$;

create or replace function public.tc_apply_purchase_benefits(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.crm_cliente_pagos; policy public.tc_customer_benefit_policy; state jsonb; cfg jsonb; reward_policy jsonb;
 level smallint; source text; key text; result jsonb; minutes integer:=0; coins integer:=0; oracle integer:=0;
 event_id uuid; spin uuid; v_effective_rank text;
begin
 select * into p from public.crm_cliente_pagos where id=p_payment_id;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 perform 1 from public.crm_clientes where id=p.cliente_id for update;
 select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
 if p.benefits_processed_at is not null then
  select snapshot into result from public.tc_client_benefit_events where payment_id=p.id and benefit_key='purchase_processed';
  return coalesce(result,'{}')||jsonb_build_object('duplicate_prevented',true);
 end if;
 if p.estado is distinct from 'completed' or coalesce(p.importe,0)<=0 then return '{}'::jsonb; end if;
 if not public.tc_customer_payment_is_current(p.id) then
  update public.crm_cliente_pagos set customer_benefit_version='legacy' where id=p.id;
  return public.tc_apply_purchase_benefits_before_202611(p.id);
 end if;
 select * into policy from public.tc_customer_benefit_policy where id;
 update public.crm_cliente_pagos set customer_benefit_version=policy.version where id=p.id;
 state:=public.tc_client_rank_state(p.cliente_id); v_effective_rank:=state->>'effective';
 reward_policy:=public.tc_purchase_reward_policy(p.id);
 source:=case when p.pack_id like 'promo:%' then 'promotion' else 'standard' end;
 key:=case when source='promotion' then substring(p.pack_id from 7) else p.pack_id end;
 select package_level into level from public.tc_purchase_package_levels where package_source=source and package_key=key;
 if level is null and p.source_rendimiento_id is not null and reward_policy->>'pricing_mode'='regular' then
  level:=(public.tc_purchase_benefit_quote(p.importe,p.moneda)->>'roulette_level')::smallint;
 end if;
 if v_effective_rank='diamante' and level in (1,2,3) then
  -- Total replacement, never 300 plus native/matrix coins or two wheel grants.
  coins:=policy.diamond_purchase_coins;
  select to_jsonb(b) into cfg from public.tc_rank_package_benefits b where b.rank_key=v_effective_rank and b.package_level=level;
  oracle:=greatest(coalesce((p.benefits_context->>'oracle_credits')::int,0),0)
   +case when coalesce((cfg->>'enabled')::boolean,false) then greatest(coalesce((cfg->>'oracle_credits')::int,0),0) else 0 end;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,
   coins,oracle_credits,package_level,delivery_key,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'rank_package:'||level,'rank_package',coins,oracle,level,'rank-package:'||p.id,p.importe,p.moneda,
   jsonb_build_object('policy_version',policy.version,'coins_total',coins,'rank_state',state,'package_level',level,'reward_policy',reward_policy))
  returning id into event_id;
  update public.crm_clientes set puntos=coalesce(puntos,0)+coins,updated_at=now() where id=p.cliente_id;
  insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta)
  select p.cliente_id,'ganado',coins,'Compra Diamante · 300 Coins totales',event_id,c.puntos::int,
   jsonb_build_object('payment_id',p.id,'benefit_event_id',event_id,'policy_version',policy.version)
  from public.crm_clientes c where c.id=p.cliente_id;
  if oracle>0 then perform public.grant_cliente_oracle_credits(p.cliente_id,oracle,'rank-package:'||p.id||':oracle',
   'rank_package','Beneficio de compra',jsonb_build_object('payment_id',p.id,'benefit_event_id',event_id)); end if;
  insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado)
  values(p.cliente_id,'benefit:'||p.id||':purchase_roulette:1','customer_purchase_diamond',5,p.id,p.importe,p.moneda,'pending')
  returning id into spin;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,spin_id,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'purchase_roulette:1','roulette',spin,p.importe,p.moneda,jsonb_build_object('level',5,'policy_version',policy.version));
  result:=jsonb_build_object('policy_version',policy.version,'rank',v_effective_rank,'coins',coins,'oracle_credits',oracle,
   'rank_package_matrix',jsonb_build_object('delivered',jsonb_build_object('coins',coins,'oracle_credits',oracle,'spin_ids',jsonb_build_array(spin),'roulette_diamond_spins',1)));
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'purchase_processed','processed',p.importe,p.moneda,result);
  update public.crm_cliente_pagos set benefits_processed_at=now() where id=p.id;
 else
  -- Keep verified native/matrix quantities for all other customer ranks.
  result:=public.tc_apply_purchase_benefits_before_202611(p.id);
 end if;
 if reward_policy->>'pricing_mode'='regular' then
  minutes:=coalesce((policy.ranks->v_effective_rank->>'regular_bonus_minutes')::int,0);
 end if;
 if minutes>0 then
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'regular_purchase_minutes','minutes',minutes,'regular-minutes:'||p.id,p.importe,p.moneda,
   jsonb_build_object('policy_version',policy.version,'rank_state',state,'pricing_mode','regular'))
  on conflict(payment_id,benefit_key) do nothing returning id into event_id;
  if event_id is not null then
   update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+minutes,updated_at=now() where id=p.cliente_id;
   insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data)
   values(p.cliente_id::text,'Compra regular: +'||minutes||' minutos FREE de rango.','Sistema','regular_purchase_minutes',
    jsonb_build_object('payment_id',p.id,'benefit_event_id',event_id,'minutes',minutes,'policy_version',policy.version));
  end if;
 end if;
 result:=coalesce(result,'{}')||jsonb_build_object('regular_bonus_minutes',minutes,'policy_version',policy.version);
 update public.tc_client_benefit_events set snapshot=snapshot||result where payment_id=p.id and benefit_key='purchase_processed';
 perform public.tc_touch_roulette_signal(p.cliente_id);
 return result;
end $$;

create or replace function public.tc_apply_rank_package_benefits(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.tc_customer_payment_is_current(p_payment_id) then return public.tc_apply_purchase_benefits(p_payment_id); end if;
 return public.tc_apply_rank_package_benefits_before_202611(p_payment_id);
end $$;










-- ASSEMBLED SECTIONS
CREATE OR REPLACE FUNCTION public.tc_grant_diamond_purchase_minutes(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.crm_cliente_pagos%rowtype; s jsonb; ev uuid;
begin
  if public.tc_customer_payment_is_current(p_payment_id) then return 0; end if;
  select * into p from public.crm_cliente_pagos where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=p.cliente_id for update;
  select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
  if p.estado is distinct from 'completed' or coalesce(p.importe,0)<=0 or p.benefits_processed_at is not null then return 0; end if;
  if coalesce(p.referencia_externa,'') like 'registrar_llamada:%' then return 0; end if;
  s := public.tc_client_rank_state(p.cliente_id);
  if coalesce(s->>'effective','')<>'diamante' then return 0; end if;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,
    purchase_amount,currency,minutes,delivery_key,snapshot)
  values(p.cliente_id,p.id,'diamante','diamond_purchase_minutes','minutes',p.importe,p.moneda,15,
    'diamond-minutes:'||p.id::text,jsonb_build_object('free_minutes',15,'rank_state',s,'rule','diamond_each_completed_purchase'))
  on conflict(payment_id,benefit_key) do nothing returning id into ev;
  if ev is null then return 0; end if;
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+15,
    updated_at=clock_timestamp() where id=p.cliente_id;
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p.cliente_id,'rank_purchase_minutes','Tus 15 minutos Diamante ya están disponibles',
    'Hemos añadido 15 minutos FREE adicionales por tu compra confirmada.',
    jsonb_build_object('payment_id',p.id,'benefit_event_id',ev,'free_minutes',15),false,now());
  perform public.tc_touch_roulette_signal(p.cliente_id);
  return 15;
end $function$;


CREATE OR REPLACE FUNCTION public.tc_apply_configured_purchase(p_kind text, p_payload jsonb, p_rank text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb; pay public.crm_cliente_pagos%rowtype; a public.cliente_payment_attempts%rowtype;
 snap jsonb; base jsonb; b jsonb; resolution jsonb; v_promotion boolean:=false;
 v_coins integer; v_free integer; v_oracle integer; app_id uuid; i integer; v_spin_count integer; v_level integer; balances jsonb; summary text;
begin
 if p_kind='promotion' then
  select * into strict a from public.cliente_payment_attempts where id=(p_payload->>'attempt_id')::uuid;
  snap:=a.promotion_snapshot;
  base:=jsonb_build_object('coins',snap->'coins','free_minutes',snap->'free_minutes','oracle_credits',snap->'oracle_credits','roulette_spins',snap->'roulette_spins','roulette_level',snap->'roulette_level');
  v_promotion:=true;
  result:=public.cliente_confirmar_compra_promocion_v1(a.id);
 elsif p_kind='manual' then
  result:=public.crm_register_call_atomic_v8(p_payload);
  if result->'payment' is null or result->'payment'='null'::jsonb then return result; end if;
  b:=coalesce(p_payload->'purchase_benefits','{}');
  v_promotion:=coalesce(b->>'source','')='active_promotion' or coalesce((p_payload->>'promo')::boolean,false);
  base:=jsonb_build_object('coins',coalesce((p_payload->>'points_to_add')::integer,0),'free_minutes',coalesce((p_payload->>'purchase_free_minutes')::integer,0),'oracle_credits',coalesce((b->>'oracle_credits')::integer,0));
 elsif p_kind in ('web','pack') then
  if p_kind='pack' then result:=public.cliente_confirmar_compra_ruleta_v3(p_payload);
  else result:=public.cliente_confirmar_compra_ruleta_v2(p_payload); end if;
  base:=jsonb_build_object('coins',coalesce((p_payload->>'points')::integer,0),'free_minutes',coalesce((p_payload->>'free')::integer,0),'oracle_credits',coalesce((p_payload->>'oracle_credits')::integer,0));
 else raise exception 'INVALID_PURCHASE_KIND'; end if;
 select * into strict pay from public.crm_cliente_pagos where id=(result->'payment'->>'id')::uuid for update;
 if public.tc_customer_payment_is_current(pay.id) then return result; end if;
 if coalesce((result->>'duplicated')::boolean,false) or coalesce((result->>'duplicate_prevented')::boolean,false) then
  select snapshot into resolution from public.client_benefit_applications where operation_key='purchase:'||pay.id;
  return result||jsonb_build_object('configured_benefits',resolution);
 end if;
 if pay.estado<>'completed' then raise exception 'PAYMENT_NOT_CONFIRMED'; end if;
 -- Include the actual spin generated by the existing trigger, not a second guessed formula.
 select count(*),max(nivel) into v_spin_count,v_level from public.cliente_ruleta_giros
  where purchase_id=pay.id or (pay.source_rendimiento_id is not null and payment_key='rendimiento:'||pay.source_rendimiento_id);
 base:=base||jsonb_build_object('roulette_spins',v_spin_count,'roulette_level',v_level);
 resolution:=public.tc_evaluate_benefits(p_rank,pay.importe,upper(pay.moneda),v_promotion,base);
 b:=resolution->'benefits';
 v_coins:=coalesce((b->>'coins')::integer,0)-coalesce((base->>'coins')::integer,0);
 v_free:=coalesce((b->>'free_minutes')::integer,0)-coalesce((base->>'free_minutes')::integer,0);
 v_oracle:=coalesce((b->>'oracle_credits')::integer,0)-coalesce((base->>'oracle_credits')::integer,0);
 insert into public.client_benefit_applications(client_id,payment_id,operation_key,snapshot)
  values(pay.cliente_id,pay.id,'purchase:'||pay.id,resolution) returning id into app_id;
 update public.crm_clientes set puntos=coalesce(puntos,0)+v_coins,minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+v_free,updated_at=now() where id=pay.cliente_id;
 if exists(select 1 from public.crm_clientes where id=pay.cliente_id and (puntos<0 or minutos_free_pendientes<0)) then raise exception 'BENEFIT_CHANGE_EXCEEDS_AVAILABLE_BALANCE'; end if;
 if v_coins<>0 then
  insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,meta)
   values(pay.cliente_id,'ganado',v_coins,'Ajuste de beneficios configurados · compra '||pay.id,app_id,resolution||jsonb_build_object('payment_id',pay.id));
 end if;
 if v_oracle<>0 then
  insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,notes,meta)
   values(pay.cliente_id,v_oracle,'adjustment','benefits:'||app_id,'Beneficios configurados de compra',resolution);
 end if;
 if (b->>'roulette_spins')::integer<>v_spin_count or ((b->>'roulette_level')::integer is distinct from v_level and (b->>'roulette_spins')::integer>0) then
  delete from public.cliente_ruleta_giros where estado='pending' and (purchase_id=pay.id or (pay.source_rendimiento_id is not null and payment_key='rendimiento:'||pay.source_rendimiento_id));
  for i in 1..coalesce((b->>'roulette_spins')::integer,0) loop
   insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency)
    values(pay.cliente_id,'benefits:'||pay.id||':'||i,'configured_purchase',(b->>'roulette_level')::smallint,pay.id,pay.importe,pay.moneda);
  end loop;
 end if;
 summary:='Beneficios de compra confirmados: '||coalesce(b->>'coins','0')||' Coins; '||coalesce(b->>'free_minutes','0')||' minutos FREE; '||coalesce(b->>'oracle_credits','0')||' tiradas Oráculo; '||coalesce(b->>'roulette_spins','0')||' giros.';
 select jsonb_build_object('free',minutos_free_pendientes,'normal',minutos_normales_pendientes,'coins',puntos,'free_after',minutos_free_pendientes,'normal_after',minutos_normales_pendientes,'coins_after',puntos) into balances from public.crm_clientes where id=pay.cliente_id;
 update public.cliente_notificaciones set mensaje=summary,meta=coalesce(meta,'{}')||jsonb_build_object('configured_benefits',resolution,'balances',balances)
  where cliente_id=pay.cliente_id and meta->>'payment_id'=pay.id::text and tipo='purchase_benefits';
 insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data)
 values(pay.cliente_id::text,summary,'Sistema','configured_purchase_benefits',resolution||jsonb_build_object('payment_id',pay.id));
 return result||jsonb_build_object('configured_benefits',resolution,'balances',coalesce(result->'balances','{}')||balances);
end $function$;


CREATE OR REPLACE FUNCTION public.tc_enforce_ruleta_spin_level_from_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb := to_jsonb(new);
  v_amount numeric := null;
  v_expected smallint := null;
  v_ref text;
  v_purchase_id uuid := null;
begin
  -- Los giros explícitos de rango/bono conservan exactamente el nivel configurado.
  if coalesce(new.source,'') in ('rank_package_matrix','rank_daily_bonus','customer_purchase_diamond') then
    return new;
  end if;

  -- Nivel Especial queda fuera de la regla automática por importe.
  if new.nivel = 4 then return new; end if;

  v_ref := coalesce(new.payment_key, '');

  begin
    if v_ref like 'crm_pago:%' then
      select p.importe into v_amount
      from public.crm_cliente_pagos p
      where p.id = substring(v_ref from length('crm_pago:') + 1)::uuid;
    elsif v_ref like 'rendimiento:%' then
      select r.importe into v_amount
      from public.rendimiento_llamadas r
      where r.id = substring(v_ref from length('rendimiento:') + 1)::uuid;
    end if;
  exception when others then
    v_amount := null;
  end;

  if v_amount is null and nullif(v_row->>'purchase_id','') is not null then
    begin
      v_purchase_id := (v_row->>'purchase_id')::uuid;
      select p.importe into v_amount
      from public.crm_cliente_pagos p
      where p.id = v_purchase_id;
    exception when others then
      v_amount := null;
    end;
  end if;

  if v_amount is null then return new; end if;
  v_expected := public.tc_ruleta_level_for_amount(v_amount);
  if v_expected is null then return null; end if;

  new.nivel := v_expected;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_confirmar_compra_ruleta_v3(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.crm_cliente_pagos%rowtype; cid uuid:=(p->>'cliente_id')::uuid;
  ref text:=nullif(p->>'payment_ref',''); amount numeric:=round((p->>'amount')::numeric,2);
  curr text:=upper(p->>'currency'); f integer:=coalesce((p->>'free')::integer,0); n integer:=coalesce((p->>'normal')::integer,0);
  ctx jsonb; result jsonb;
begin
  if ref is null or cid is null or amount is null or amount<=0 or curr not in ('EUR','USD') or curr is null or f<0 or n<0 then raise exception 'INVALID_PURCHASE'; end if;
  -- Siempre mismo orden de bloqueos que el motor y las reclamaciones.
  perform 1 from public.crm_clientes where id=cid for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('purchase:'||ref));
  select * into v from public.crm_cliente_pagos where referencia_externa=ref for update;
  if found then
    if v.cliente_id<>cid or v.importe<>amount or upper(v.moneda)<>curr then raise exception 'PAYMENT_REFERENCE_CONFLICT'; end if;
    if v.estado='completed' then return jsonb_build_object('duplicated',true,'payment',to_jsonb(v)); end if;
    if v.benefits_processed_at is not null or v.estado not in ('pending','processing') then raise exception 'PAYMENT_STATE_CONFLICT'; end if;
  end if;
  ctx:=jsonb_build_object('coins',greatest(coalesce((p->>'points')::integer,0),0),
    'oracle_credits',greatest(coalesce((p->>'oracle_credits')::integer,0),0),
    'special_spins',case when (p->>'roulette_level')::integer=4 then greatest(coalesce((p->>'roulette_spins')::integer,0),0) else 0 end,
    'pack_id',p->>'pack_id','source','purchase_rpc',
    'reward_policy_version',p->'reward_policy_version','pricing_mode',p->>'pricing_mode',
    'purchase_classification',p->>'purchase_classification','package_level',p->'package_level','benefits_started_at',p->>'benefits_started_at',
    'rewards_eligible',p->'rewards_eligible');
  if v.id is null then
    insert into public.crm_cliente_pagos(cliente_id,importe,moneda,metodo,estado,referencia_externa,notas,
      pack_id,pack_name,paid_minutes,bonus_minutes,stripe_session_id,payment_intent,created_by_user_id,created_by_role,benefits_context)
    values(cid,amount,curr,p->>'metodo','completed',ref,p->>'notas',p->>'pack_id',p->>'pack_name',n,f,
      p->>'stripe_session_id',p->>'payment_intent',nullif(p->>'created_by_user_id','')::uuid,p->>'created_by_role',ctx) returning * into v;
  else
    update public.crm_cliente_pagos set estado='completed',paid_minutes=n,bonus_minutes=f,benefits_context=ctx where id=v.id returning * into v;
  end if;
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+f,
    minutos_normales_pendientes=coalesce(minutos_normales_pendientes,0)+n,updated_at=now() where id=cid;
  result:=public.tc_apply_purchase_benefits(v.id);
  return jsonb_build_object('duplicated',false,'payment',to_jsonb(v),'benefits',result,'creditedMinutes',jsonb_build_object('free',f,'normal',n));
end $function$;


CREATE OR REPLACE FUNCTION public.crm_free_pass_status(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_first timestamptz;
  v_program public.tc_customer_benefit_policy;
  v_last_grant timestamptz;
  v_cooldown boolean:=false;
  v_minutes integer;
  v_last timestamptz;
  v_eligible boolean;
  v_rank text;
  v_rank_eligible boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer := 0;
  v_policy public.crm_free_pass_policy%rowtype;
begin
  select * into v_program from public.tc_customer_benefit_policy where id;
  if v_program.activated_at is null then return public.crm_free_pass_status_before_202611(p_cliente_id); end if;
  select * into strict v_policy
  from public.crm_free_pass_policy
  where id;

  -- Preserve the historical confirmed-purchase and original cycle rules.
  -- El primer pago conserva el calendario de ciclos existente.
  select min(t), max(t)
  into v_first, v_last
  from (
    select p.created_at as t
    from public.crm_cliente_pagos p
    where p.cliente_id = p_cliente_id
      and p.estado = 'completed'
      and p.importe > 0

    union all

    select coalesce(r.fecha_hora, r.created_at)
    from public.rendimiento_llamadas r
    where r.cliente_id = p_cliente_id::text
      and r.cliente_compra_minutos
      and r.importe > 0
      and not coalesce(r.misma_compra, false)
      and not exists (
        select 1
        from public.crm_cliente_pagos p
        where p.source_rendimiento_id = r.id
      )
  ) purchases
  where t <= now();

  v_rank := public.tc_client_rank_state(p_cliente_id)->>'effective';
  v_rank_eligible := coalesce(v_rank in ('plata', 'oro', 'diamante'), false);
  v_eligible := v_last > now()-interval '30 days' and v_rank_eligible;
  v_minutes:=coalesce((v_program.ranks->v_rank->>'pass_minutes')::int,0);
  select max(created_at) into v_last_grant from public.crm_free_pass_uses where cliente_id=p_cliente_id;
  v_cooldown:=coalesce(v_last_grant+interval '30 days'>now(),false);

  if v_first is not null then
    v_start := v_first
      + floor(
          extract(epoch from (now() - v_first))
          / (v_policy.cycle_days * 86400)
        ) * make_interval(days => v_policy.cycle_days);
    v_end := v_start + make_interval(days => v_policy.cycle_days);

    select count(*)
    into v_used
    from public.crm_free_pass_uses
    where cliente_id = p_cliente_id
      and cycle_start = v_start;
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'effective_rank', v_rank,
    'rank_eligible', v_rank_eligible,
    'eligibility_reason', case
      when not v_rank_eligible then 'RANK_NOT_ELIGIBLE'
      when v_first is null then 'NO_CONFIRMED_PURCHASE'
      when v_last<=now()-interval '30 days' then 'NO_RECENT_PURCHASE'
      when v_cooldown then 'PASS_COOLDOWN'
      else null
    end,
    'last_purchase_at', v_last,
    'eligible_until', v_last+interval '30 days',
    'total', 1,
    'available', case
      when not v_eligible or v_cooldown then 0
      else greatest(0, 1 - v_used)
    end,
    'used', v_used,
    'minutes', v_minutes,
    'policy_version',v_program.version,
    'last_granted_at',v_last_grant,
    'purchase_window_days',30,
    'cycle_days', v_policy.cycle_days,
    'cycle_start', v_start,
    'renews_at', greatest(v_end,v_last_grant+interval '30 days')
  );
end
$function$;


CREATE OR REPLACE FUNCTION public.tc_new_tarotista_gift_offer(p_cliente_id uuid, p_tarotista_worker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r text; n integer; credit integer:=0; reason text; w public.workers%rowtype;
 rel public.crm_new_tarotista_releases%rowtype; cfg jsonb; used public.crm_new_tarotista_gift_uses;
begin
 if not exists(select 1 from public.crm_clientes where id=p_cliente_id) then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 select rank_minutes into cfg from public.crm_new_tarotista_gift_policy where id;
 -- Keep the global rank state unchanged; this benefit gives null rank an explicit key.
 r:=coalesce(nullif(public.tc_client_rank_state(p_cliente_id)->>'effective',''),'sin_rango');
 n:=case when r in ('sin_rango','bronce','plata','oro','diamante') then coalesce((cfg->>r)::integer,0) else 0 end;
 select * into w from public.workers where id=p_tarotista_worker_id;
 select * into rel from public.crm_new_tarotista_releases where tarotista_worker_id=p_tarotista_worker_id;
 select coalesce(e.minutes,0) into credit from public.tc_client_benefit_events e
  where e.cliente_id=p_cliente_id and e.delivery_key='diamond-new-tarotista:'||p_tarotista_worker_id::text||':'||p_cliente_id::text;
 credit:=coalesce(credit,0);
 select * into used from public.crm_new_tarotista_gift_uses where cliente_id=p_cliente_id and tarotista_worker_id=p_tarotista_worker_id;
 reason:=case
  when rel.tarotista_worker_id is null or not rel.enabled then 'GIFT_NOT_AVAILABLE'
  when w.id is null or w.role is distinct from 'tarotista' or w.is_active is distinct from true then 'TAROTISTA_INACTIVE'
  when exists(select 1 from public.crm_new_tarotista_gift_uses u where u.cliente_id=p_cliente_id and u.tarotista_worker_id=p_tarotista_worker_id) then 'ALREADY_USED'
  when n<=0 then 'RANK_NOT_ELIGIBLE'
  else null end;
 return jsonb_build_object('tarotista_worker_id',p_tarotista_worker_id,'tarotista_name',w.display_name,
  'effective_rank',r,'eligible',reason is null,'reason',reason,
  'eligibility_key',p_tarotista_worker_id,'grant_minutes',n,
  'consume_minutes',n,'previous_credit_minutes',credit,
  'benefit_type','new_tarotista_introduction','source_id',p_tarotista_worker_id,
  'used_minutes',coalesce(used.minutes,0),'used_at',used.created_at,
  'remaining_minutes',case when used.id is not null then 0 when reason is null then n else 0 end,
  'benefit_event_id',used.benefit_event_id,'call_id',used.rendimiento_id,
  'historical_granted_minutes',used.granted_minutes,'expires_at',null);
end $function$;


CREATE OR REPLACE FUNCTION public.cliente_canjear_coins_minutos_v1(p_cliente_id uuid, p_recompensa_id uuid, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client public.crm_clientes%rowtype;
  v_reward public.recompensas%rowtype;
  v_existing public.cliente_puntos_historial%rowtype;
  v_cost integer;
  v_minutes integer;
  v_match text[];
  v_next_points integer;
  v_next_free integer;
begin
  if p_cliente_id is null or p_recompensa_id is null or p_operation_id is null then
    raise exception 'CANJE_DATOS_INVALIDOS';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coin-redemption:' || p_operation_id::text, 0));

  select * into v_existing
  from public.cliente_puntos_historial
  where operation_id = p_operation_id;
  if found then
    if v_existing.cliente_id <> p_cliente_id
       or coalesce(v_existing.meta->>'source', '') <> 'client_coin_redemption'
       or coalesce(v_existing.meta->>'reward_id', '') <> p_recompensa_id::text then
      raise exception 'CANJE_OPERATION_CONFLICT';
    end if;
    select * into strict v_client from public.crm_clientes where id = p_cliente_id;
    return jsonb_build_object('duplicated', true, 'cliente', to_jsonb(v_client));
  end if;

  select * into v_reward
  from public.recompensas
  where id = p_recompensa_id and activo is true;
  if not found then raise exception 'RECOMPENSA_NO_ENCONTRADA'; end if;

  select * into v_client
  from public.crm_clientes
  where id = p_cliente_id
  for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;

  v_cost := coalesce(v_reward.puntos_coste, 0);
  v_minutes := coalesce(v_reward.minutos_otorgados, 0);
  if v_minutes <= 0 then
    v_match := regexp_match(lower(coalesce(v_reward.nombre, '')), '([0-9]+)[[:space:]]*(min|minuto|minutos|free)');
    if v_match is not null then v_minutes := (v_match[1])::integer; end if;
  end if;

  if v_cost <= 0 then raise exception 'RECOMPENSA_SIN_COSTE_VALIDO'; end if;
  if v_minutes <= 0 then raise exception 'RECOMPENSA_SIN_MINUTOS_VALIDOS'; end if;
  if coalesce(v_client.puntos, 0) < v_cost then raise exception 'PUNTOS_INSUFICIENTES'; end if;

  v_next_points := coalesce(v_client.puntos, 0) - v_cost;
  v_next_free := coalesce(v_client.minutos_free_pendientes, 0) + v_minutes;

  update public.crm_clientes
     set puntos = v_next_points,
         minutos_free_pendientes = v_next_free,
         updated_at = now()
   where id = p_cliente_id
   returning * into v_client;

  insert into public.cliente_puntos_historial(
    cliente_id, tipo, puntos, descripcion, operation_id, saldo_despues, meta
  ) values (
    p_cliente_id, 'canjeado', v_cost,
    'Canjeado ' || coalesce(v_reward.nombre, 'recompensa') || ' por ' || v_minutes || ' minutos free.',
    p_operation_id, v_next_points,
    jsonb_build_object('reward_id', p_recompensa_id, 'minutes_free', v_minutes, 'source', 'client_coin_redemption')
  );

  insert into public.crm_client_notes(
    cliente_id, texto, author_user_id, author_name, author_email, is_pinned,
    event_type, event_data
  ) values (
    p_cliente_id::text,
    'Cliente canjea ' || v_cost || ' Coins por ' || v_minutes
      || ' minutos FREE. Total FREE pendiente: ' || v_next_free || '.',
    null, 'Sistema · Canje Coins', null, false, 'system_coin_redemption',
    jsonb_build_object('operation_id', p_operation_id, 'reward_id', p_recompensa_id,
      'coins', v_cost, 'minutes_free', v_minutes, 'free_balance_after', v_next_free)
  );

  perform public.tc_touch_roulette_signal(p_cliente_id);
  return jsonb_build_object(
    'duplicated', false, 'cliente', to_jsonb(v_client), 'recompensa', to_jsonb(v_reward),
    'minutos_free_sumados', v_minutes, 'minutos_free_pendientes', v_next_free
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.tc_claim_rank_bonus(p_cliente_id uuid, p_promotion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s jsonb; cfg public.tc_rank_daily_bonus_config; d date; ev uuid; i integer; spin_id uuid; spin_ids jsonb:='[]'::jsonb; next_at timestamptz;
begin
  if exists(select 1 from public.tc_customer_benefit_policy where id and activated_at is not null) then raise exception 'BONUS_NOT_ACTIVE'; end if;
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
end $function$;


CREATE OR REPLACE FUNCTION public.tc_available_rank_bonuses(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s jsonb; cfg public.tc_rank_daily_bonus_config; d date; used boolean; next_at timestamptz;
begin
  if exists(select 1 from public.tc_customer_benefit_policy where id and activated_at is not null) then return '[]'::jsonb; end if;
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
end $function$;



CREATE OR REPLACE FUNCTION public.cliente_ruleta_resumen_ultra_v1(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb:='{}'; r jsonb:=public.tc_client_rank_state(p_cliente_id); campaign jsonb;
  diamond boolean:=false; lvl integer; cnt integer; nextid uuid; total integer:=0; catalog jsonb;
begin
  select to_jsonb(c) into campaign from public.tc_client_roulette_campaigns c where c.id=public.tc_client_roulette_active_campaign_id();
  diamond:=coalesce((campaign->>'diamond_enabled')::boolean,false) and campaign->>'diamond_rank'=r->>'effective'
    and coalesce((r->'config'->>'is_active')::boolean,false) and coalesce((r->'config'->>'roulette_enabled')::boolean,false);
  if exists(select 1 from public.tc_customer_benefit_policy where id and activated_at is not null) then
    diamond:=coalesce((campaign->>'diamond_enabled')::boolean,false) and
      (r->>'effective'='diamante' or exists(select 1 from public.cliente_ruleta_giros where cliente_id=p_cliente_id and nivel=5 and estado='pending' and (expires_at is null or expires_at>now())));
  end if;
  for lvl in 1..5 loop
    select count(*),(array_agg(id order by created_at,id))[1] into cnt,nextid from public.cliente_ruleta_giros g
    where g.cliente_id=p_cliente_id and estado='pending' and (g.expires_at is null or g.expires_at>now()) and nivel=lvl and (lvl<>5 or diamond)
      and (lvl=5 or g.required_rank is null or (g.required_rank=r->>'effective' and coalesce((r->'config'->>'is_active')::boolean,false) and coalesce((r->'config'->>'roulette_enabled')::boolean,false)));
    result:=result||jsonb_build_object('level_'||lvl||'_spins',cnt,'next_spin_'||lvl,nextid,'next_spin_expires_at_'||lvl,(select expires_at from public.cliente_ruleta_giros where id=nextid));
    total:=total+cnt;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('meta',q.metadata,'probability',q.probability)),'[]'::jsonb) into catalog from (
    select rw.*,round(100*weight/nullif(sum(weight) over(partition by nivel),0),4) as probability
    from public.tc_client_roulette_rewards rw where campaign_id=(campaign->>'id')::uuid and is_active and weight>0 and (nivel<>5 or diamond)
  ) q;
  return result||jsonb_build_object('cliente_id',p_cliente_id,'available_spins',total,'next_level',1,
    'server_now',clock_timestamp(),'diamond_access',coalesce(diamond,false),'rank_state',r,'campaign',campaign,'catalogue',catalog,
    'bands',coalesce((select jsonb_agg(to_jsonb(b) order by currency,min_amount) from public.tc_client_purchase_bands b where is_active),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h)) from (select id as spin_id,nivel as level,reward_type,reward_value,reward_label,reward_rarity as rarity,used_at,created_at,result_status as status from public.cliente_ruleta_giros where cliente_id=p_cliente_id and estado='used' order by used_at desc limit 50) h),'[]'::jsonb),
    'entitlements',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('meta',e.metadata)) from public.tc_client_roulette_entitlements e where cliente_id=p_cliente_id and status in ('pending','active')),'[]'::jsonb));
end $function$;


CREATE OR REPLACE FUNCTION public.cliente_girar_ruleta_ultra_v1(p_cliente_id uuid, p_spin_id uuid, p_level smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spin public.cliente_ruleta_giros%rowtype;
  v_campaign uuid;
  v_reward public.tc_client_roulette_rewards%rowtype;
  v_total_weight numeric := 0;
  v_ticket numeric := 0;
  v_acc numeric := 0;
  v_row record;
  v_before numeric := 0;
  v_after numeric := 0;
  v_entitlement uuid := null;
  v_meta jsonb := '{}'::jsonb;
  v_daily integer;
  v_days integer;
  v_rank text;
  v_duration integer;
  v_result_status text := 'credited';
  v_has_balance boolean := false;
  v_payment_id uuid := null;
  v_payment_candidate_ids uuid[];
  v_payment_call_id uuid := null;
  v_payment_key_id uuid := null;
  v_payment_key_match text[];
  v_payment_resolution text := 'unlinked';
begin
  if p_level not in (1,2,3,4,5) then raise exception 'INVALID_LEVEL'; end if;

  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  select * into v_spin
  from public.cliente_ruleta_giros
  where id=p_spin_id and cliente_id=p_cliente_id and nivel=p_level
  for update;

  if v_spin.id is null then raise exception 'INVALID_SPIN'; end if;
  if v_spin.estado='used' then
    return public.cliente_ruleta_resumen_ultra_v1(p_cliente_id)||jsonb_build_object(
      'spin_id',v_spin.id,'spin_level',p_level,'reward_id',v_spin.reward_id,'reward_type',v_spin.reward_type,
      'reward_value',v_spin.reward_value,'reward_label',v_spin.reward_label,'reward_rarity',v_spin.reward_rarity,
      'reward_meta',v_spin.reward_meta,'balance_before',coalesce(v_spin.balance_antes,0),
      'balance_after',coalesce(v_spin.balance_despues,0),'special',v_spin.premio_especial,'replayed',true);
  end if;
  if v_spin.estado<>'pending' then raise exception 'INVALID_SPIN'; end if;

  if v_spin.expires_at is not null and v_spin.expires_at<=clock_timestamp() then raise exception 'SPIN_EXPIRED'; end if;
  -- Ownership was checked above; an already granted Diamond spin survives a rank change.
  if p_level<>5 then perform public.tc_assert_roulette_access(p_cliente_id,p_level,v_spin.required_rank); end if;
  v_campaign := public.tc_client_roulette_active_campaign_id();
  if v_campaign is null then raise exception 'ROULETTE_NO_ACTIVE_CAMPAIGN'; end if;

  select coalesce(sum(weight),0) into v_total_weight
  from public.tc_client_roulette_rewards
  where campaign_id=v_campaign and nivel=p_level and is_active=true and weight>0;

  if v_total_weight<=0 then raise exception 'ROULETTE_NO_REWARDS'; end if;
  v_ticket := random()*v_total_weight;

  for v_row in
    select * from public.tc_client_roulette_rewards
    where campaign_id=v_campaign and nivel=p_level and is_active=true and weight>0
    order by sort_order,created_at,id
  loop
    v_acc := v_acc+v_row.weight;
    if v_ticket<=v_acc then
      select * into v_reward from public.tc_client_roulette_rewards where id=v_row.id;
      exit;
    end if;
  end loop;

  if v_reward.id is null then
    select * into v_reward
    from public.tc_client_roulette_rewards
    where campaign_id=v_campaign and nivel=p_level and is_active=true and weight>0
    order by sort_order desc,created_at desc
    limit 1;
  end if;

  v_meta := coalesce(v_reward.metadata,'{}'::jsonb);

  update public.cliente_ruleta_giros
  set estado='used',
      used_at=now(),
      campaign_id=v_campaign,
      reward_id=v_reward.id::text,
      reward_type=v_reward.reward_type,
      reward_value=round(v_reward.reward_value)::integer,
      reward_label=v_reward.name,
      reward_rarity=v_reward.rarity,
      reward_meta=v_meta,
      reward_snapshot=to_jsonb(v_reward),
      result_status='processing',
      premio_tipo=v_reward.reward_type,
      premio_valor=round(v_reward.reward_value)::integer,
      premio_id=v_reward.id::text,
      premio_especial=v_reward.special,
      premio_minutos=case when v_reward.reward_type='minutes' then round(v_reward.reward_value)::integer else premio_minutos end
  where id=v_spin.id and estado='pending';

  if not found then raise exception 'INVALID_SPIN'; end if;

  if v_reward.reward_type='minutes' then
    select coalesce(minutos_free_pendientes,0) into v_before
    from public.crm_clientes
    where id=p_cliente_id
    for update;

    update public.crm_clientes
    set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+round(v_reward.reward_value)::integer,
        updated_at=now()
    where id=p_cliente_id;

    v_after := v_before+round(v_reward.reward_value)::integer;
    v_has_balance := true;

  elsif v_reward.reward_type='coins' then
    select coalesce(puntos,0) into v_before
    from public.crm_clientes
    where id=p_cliente_id
    for update;

    update public.crm_clientes
    set puntos=coalesce(puntos,0)+round(v_reward.reward_value)::integer,
        updated_at=now()
    where id=p_cliente_id;

    v_after := v_before+round(v_reward.reward_value)::integer;
    v_has_balance := true;

    insert into public.cliente_puntos_historial(
      cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta
    ) values (
      p_cliente_id,
      'ganado',
      round(v_reward.reward_value)::integer,
      'Premio Ruleta Celestial · '||v_reward.name,
      v_spin.id,
      round(v_after)::integer,
      jsonb_build_object(
        'source','ruleta_ultra',
        'spin_id',v_spin.id,
        'campaign_id',v_campaign,
        'reward_id',v_reward.id,
        'reward_type',v_reward.reward_type,
        'reward_rarity',v_reward.rarity,
        'level',p_level
      )
    );

  elsif v_reward.reward_type='oracle_credits' then
    insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,notes,meta)
    values(p_cliente_id,round(v_reward.reward_value)::integer,'purchase','roulette:'||v_spin.id,
      'Premio de ruleta · '||v_reward.name,jsonb_build_object('spin_id',v_spin.id,'reward_id',v_reward.id))
    on conflict(reference) do nothing;
  elsif v_reward.reward_type='rank' then
    v_rank := lower(coalesce(v_meta->>'rank','plata'));
    v_duration := greatest(0,coalesce(nullif(v_meta->>'duration_days','')::integer,30));

    insert into public.tc_client_roulette_entitlements(
      cliente_id,spin_id,reward_id,campaign_id,reward_name,reward_type,
      fulfillment_mode,status,total_claims,claims_used,expires_at,metadata
    ) values (
      p_cliente_id,v_spin.id,v_reward.id,v_campaign,v_reward.name,v_reward.reward_type,
      v_reward.fulfillment_mode,'pending',0,0,
      case when v_duration>0 then now()+(v_duration||' days')::interval else null end,
      v_meta
    ) returning id into v_entitlement;

    begin
      execute 'select public.set_client_rank_override(
        p_client_id := $1, p_assigned_rank := $2, p_intervention_type := $3,
        p_starts_at := $4, p_ends_at := $5, p_reason := $6, p_notes := $7, p_created_by := $8
      )' using
        p_cliente_id,
        v_rank,
        case when v_duration>0 then 'temporary' else 'permanent' end,
        now(),
        case when v_duration>0 then now()+(v_duration||' days')::interval else null end,
        'Premio Super Ruleta · Nivel Especial',
        v_reward.name,
        null;

      update public.tc_client_roulette_entitlements
      set status='completed',updated_at=now()
      where id=v_entitlement;
    exception when others then
      v_result_status := 'pending_fulfillment';
    end;

  elsif v_reward.reward_type='streak_minutes' then
    v_daily := greatest(1,coalesce(nullif(v_meta->>'daily_minutes','')::integer,round(v_reward.reward_value)::integer,10));
    v_days := greatest(1,coalesce(nullif(v_meta->>'days_total','')::integer,7));

    insert into public.tc_client_roulette_entitlements(
      cliente_id,spin_id,reward_id,campaign_id,reward_name,reward_type,
      fulfillment_mode,status,total_claims,claims_used,next_claim_at,expires_at,metadata
    ) values (
      p_cliente_id,v_spin.id,v_reward.id,v_campaign,v_reward.name,v_reward.reward_type,
      'claim','active',v_days,0,now(),now()+((v_days+2)||' days')::interval,
      v_meta||jsonb_build_object('daily_minutes',v_daily,'days_total',v_days)
    ) returning id into v_entitlement;

    v_result_status := 'active_benefit';

  else
    insert into public.tc_client_roulette_entitlements(
      cliente_id,spin_id,reward_id,campaign_id,reward_name,reward_type,
      fulfillment_mode,status,total_claims,claims_used,expires_at,metadata
    ) values (
      p_cliente_id,v_spin.id,v_reward.id,v_campaign,v_reward.name,v_reward.reward_type,
      v_reward.fulfillment_mode,'pending',0,0,
      case when (v_meta?'expires_days') then now()+((v_meta->>'expires_days')||' days')::interval else null end,
      v_meta
    ) returning id into v_entitlement;

    v_result_status := 'pending_fulfillment';
  end if;

  update public.cliente_ruleta_giros
  set result_status=v_result_status,
      balance_antes=case when v_has_balance then v_before else null end,
      balance_despues=case when v_has_balance then v_after else null end
  where id=v_spin.id;

  insert into public.cliente_notificaciones(
    cliente_id,tipo,titulo,mensaje,meta,leida,created_at
  ) values (
    p_cliente_id,
    'ruleta_ultra',
    'Premio Ruleta Celestial',
    'Has ganado '||v_reward.name||'. '||
      case
        when v_result_status='credited' then 'Ya está acreditado en tu cuenta.'
        when v_result_status='active_benefit' then 'Tu beneficio ya está activo.'
        else 'Tu premio especial ha quedado registrado.'
      end,
    jsonb_build_object(
      'spin_id',v_spin.id,
      'level',p_level,
      'campaign_id',v_campaign,
      'reward_id',v_reward.id,
      'reward_type',v_reward.reward_type,
      'reward_value',round(v_reward.reward_value)::integer,
      'reward_label',v_reward.name,
      'reward_rarity',v_reward.rarity,
      'result_status',v_result_status,
      'balance_before',case when v_has_balance then v_before else null end,
      'balance_after',case when v_has_balance then v_after else null end
    ),
    false,
    now()
  );

  insert into public.crm_client_notes(
    cliente_id,texto,author_user_id,author_name,author_email,is_pinned,
    ruleta_spin_id,event_type,event_data
  ) values (
    p_cliente_id::text,
    '🎰 Ruleta Celestial · Nivel '||p_level||' · '||v_reward.name||
      ' · Rareza '||v_reward.rarity||' · Estado '||v_result_status||
      case
        when v_has_balance and v_reward.reward_type='minutes'
          then ' · Saldo FREE: '||v_before||' → '||v_after||'.'
        when v_has_balance and v_reward.reward_type='coins'
          then ' · Coins: '||v_before||' → '||v_after||'.'
        else '.'
      end,
    null,
    'Sistema',
    null,
    false,
    v_spin.id,
    'ruleta_reward',
    jsonb_build_object(
      'spin_id',v_spin.id,
      'level',p_level,
      'campaign_id',v_campaign,
      'reward_id',v_reward.id,
      'reward_type',v_reward.reward_type,
      'reward_value',round(v_reward.reward_value)::integer,
      'reward_label',v_reward.name,
      'reward_rarity',v_reward.rarity,
      'result_status',v_result_status,
      'balance_before',case when v_has_balance then v_before else null end,
      'balance_after',case when v_has_balance then v_after else null end
    )
  );

  insert into public.tc_client_roulette_audit(
    campaign_id,reward_id,spin_id,cliente_id,action,snapshot
  ) values (
    v_campaign,v_reward.id,v_spin.id,p_cliente_id,'spin_awarded',
    jsonb_build_object(
      'level',p_level,
      'reward',to_jsonb(v_reward),
      'status',v_result_status,
      'balance_before',case when v_has_balance then v_before else null end,
      'balance_after',case when v_has_balance then v_after else null end
    )
  );

  -- Keep the original spin reference; only the audit FK is normalized.
  select p.id into v_payment_id
  from public.crm_cliente_pagos p
  where p.id=v_spin.purchase_id and p.cliente_id=p_cliente_id
  for key share;

  if v_payment_id is not null then
    v_payment_resolution := 'purchase_id';
  elsif v_spin.source in ('rendimiento_llamadas','crm_cliente_pagos') then
    v_payment_key_match := regexp_match(coalesce(v_spin.payment_key,''),
      '^(rendimiento|crm_pago):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i');

    if v_spin.source='rendimiento_llamadas' then
      if lower(v_payment_key_match[1])='rendimiento' then
        v_payment_call_id := v_payment_key_match[2]::uuid;
      end if;
      if v_spin.purchase_id is not null and v_payment_call_id is not null
         and v_spin.purchase_id<>v_payment_call_id then
        v_payment_resolution := 'conflicting_origin';
        v_payment_call_id := null;
      else
        v_payment_call_id := coalesce(v_spin.purchase_id,v_payment_call_id);
      end if;
    elsif lower(v_payment_key_match[1])='rendimiento' then
      v_payment_call_id := v_payment_key_match[2]::uuid;
    elsif lower(v_payment_key_match[1])='crm_pago' then
      v_payment_key_id := v_payment_key_match[2]::uuid;
    end if;

    if v_payment_call_id is not null then
      select array_agg(candidate.id) into v_payment_candidate_ids
      from (
        select p.id from public.crm_cliente_pagos p
        where p.cliente_id=p_cliente_id and p.estado='completed'
          and p.source_rendimiento_id=v_payment_call_id
        for key share
      ) candidate;
      if cardinality(v_payment_candidate_ids)=1 then
        v_payment_id := v_payment_candidate_ids[1];
        v_payment_resolution := 'source_rendimiento_id';
      elsif cardinality(v_payment_candidate_ids)>1 then
        v_payment_resolution := 'ambiguous_payment';
      end if;
    elsif v_payment_key_id is not null then
      select p.id into v_payment_id
      from public.crm_cliente_pagos p
      where p.id=v_payment_key_id and p.cliente_id=p_cliente_id and p.estado='completed'
      for key share;
      if v_payment_id is not null then v_payment_resolution := 'payment_key'; end if;
    end if;
  end if;

  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,coins,minutes,oracle_credits,spin_id,snapshot)
  values(p_cliente_id,v_payment_id,public.tc_client_rank_state(p_cliente_id)->>'effective',
    'roulette_result:'||v_spin.id,'roulette_result',
    case when v_reward.reward_type='coins' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='minutes' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='oracle_credits' then round(v_reward.reward_value)::integer else 0 end,
    v_spin.id,to_jsonb(v_reward)||jsonb_build_object('payment_provenance',jsonb_build_object(
      'purchase_id',v_spin.purchase_id,'payment_key',v_spin.payment_key,'source',v_spin.source,
      'payment_id',v_payment_id,'resolution',v_payment_resolution
    )));
  perform public.tc_touch_roulette_signal(p_cliente_id);

  return coalesce(public.cliente_ruleta_resumen_ultra_v1(p_cliente_id),'{}'::jsonb)
    || jsonb_build_object(
      'spin_id',v_spin.id,
      'spin_level',p_level,
      'reward_id',v_reward.id,
      'reward_type',v_reward.reward_type,
      'reward_value',round(v_reward.reward_value)::integer,
      'reward_label',v_reward.name,
      'reward_description',v_reward.description,
      'reward_rarity',v_reward.rarity,
      'reward_meta',v_meta,
      'balance_before',case when v_has_balance then v_before else 0 end,
      'balance_after',case when v_has_balance then v_after else 0 end,
      'special',v_reward.special,
      'fulfillment_mode',v_reward.fulfillment_mode,
      'entitlement_id',v_entitlement
    );
end;
$function$;


CREATE OR REPLACE FUNCTION public.tc_client_state_snapshot(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.crm_clientes%rowtype;
  r jsonb;
  oracle_balance integer := 0;
  l1 integer := 0;
  l2 integer := 0;
  l3 integer := 0;
  l4 integer := 0;
  l5 integer := 0;
  signal_at timestamptz;
begin
  select * into c from public.crm_clientes where id=p_cliente_id;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;

  r := public.tc_client_rank_state(p_cliente_id);
  oracle_balance := greatest(0,coalesce(public.get_cliente_oracle_balance(p_cliente_id),0));

  select
    count(*) filter (where nivel=1),
    count(*) filter (where nivel=2),
    count(*) filter (where nivel=3),
    count(*) filter (where nivel=4),
    count(*) filter (where nivel=5)
  into l1,l2,l3,l4,l5
  from public.cliente_ruleta_giros
  where cliente_id=p_cliente_id and estado='pending' and (expires_at is null or expires_at>now());

  select s.updated_at into signal_at
  from public.cliente_ruleta_signal s
  where s.cliente_id=p_cliente_id;

  return jsonb_build_object(
    'cliente_id',c.id,
    'auth_user_id',c.auth_user_id,
    'coins',greatest(0,coalesce(c.puntos,0)),
    'minutes_free',greatest(0,coalesce(c.minutos_free_pendientes,0)),
    'minutes_normal',greatest(0,coalesce(c.minutos_normales_pendientes,0)),
    'minutes_total',greatest(0,coalesce(c.minutos_free_pendientes,0))+greatest(0,coalesce(c.minutos_normales_pendientes,0)),
    'oracle_credits',oracle_balance,
    'effective_rank',nullif(r->>'effective',''),
    'automatic_rank',nullif(r->>'automatic',''),
    'rank_state',r,
    'spins',jsonb_build_object('level_1',l1,'level_2',l2,'level_3',l3,'special',l4,'diamond',l5,'total',l1+l2+l3+l4+l5),
    'client_updated_at',c.updated_at,
    'signal_updated_at',signal_at,
    'refreshed_at',clock_timestamp()
  );
end $function$;


CREATE OR REPLACE FUNCTION public.cliente_ruleta_resumen_v2(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('cliente_id',p_cliente_id,
 'available_spins',count(*),'level_1_spins',count(*) filter(where nivel=1),'level_2_spins',count(*) filter(where nivel=2),
 'next_level',coalesce((array_agg(nivel order by created_at,id))[1],1),
 'next_spin_1',(array_agg(id order by created_at,id) filter(where nivel=1))[1],
 'next_spin_2',(array_agg(id order by created_at,id) filter(where nivel=2))[1],
 'level_2_from',(select level_2_from from public.cliente_ruleta_config where id),
 'catalogue', (select jsonb_agg(to_jsonb(c)||jsonb_build_object('probability',100.0*c.weight/t.total) order by c.nivel,c.reward_type,c.reward_value)
 from public.cliente_ruleta_catalogo c join(select nivel,sum(weight) total from public.cliente_ruleta_catalogo where active group by nivel)t using(nivel) where c.active))
 from public.cliente_ruleta_giros where cliente_id=p_cliente_id and estado='pending' and (expires_at is null or expires_at>now())
$function$;


CREATE OR REPLACE FUNCTION public.cliente_ruleta_resumen_v3(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base jsonb;
begin
  v_base := public.cliente_ruleta_resumen_v2(p_cliente_id);
  if v_base is null then
    raise exception 'RULETA_V2_SUMMARY_NOT_FOUND';
  end if;
  return v_base || jsonb_build_object('catalogue', public.tc_ruleta_catalogo_v3(p_cliente_id));
end;
$function$;


CREATE OR REPLACE FUNCTION public.cliente_ruleta_resumen_v4(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
 'cliente_id',p_cliente_id,'available_spins',count(*),
 'level_1_spins',count(*) filter(where nivel=1),'level_2_spins',count(*) filter(where nivel=2),
 'level_3_spins',count(*) filter(where nivel=3),
 'next_level',coalesce((array_agg(nivel order by created_at,id))[1],1),
 'next_spin_1',(array_agg(id order by created_at,id) filter(where nivel=1))[1],
 'next_spin_2',(array_agg(id order by created_at,id) filter(where nivel=2))[1],
 'next_spin_3',(array_agg(id order by created_at,id) filter(where nivel=3))[1],
 'level_2_from',(select level_2_from from public.cliente_ruleta_config where id),
 'level_3_from',(select level_3_from from public.cliente_ruleta_config where id),
 'catalogue',public.tc_ruleta_catalogo_v4(p_cliente_id)
)
from public.cliente_ruleta_giros where cliente_id=p_cliente_id and estado='pending' and (expires_at is null or expires_at>now())
$function$;




create or replace function public.tc_assign_rank_raffle(p_cliente_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.raffles; rank_key text; n integer; entry_id uuid; count_added integer:=0;
begin
 if not exists(select 1 from public.tc_customer_benefit_policy where id and activated_at is not null) then return 0; end if;
 rank_key:=public.tc_client_rank_state(p_cliente_id)->>'effective';
 if rank_key is null or rank_key not in ('oro','diamante') then return 0; end if;
 for r in select * from public.raffles where status='active' order by id for update loop
  if exists(select 1 from public.raffle_entries where raffle_id=r.id and client_id=p_cliente_id and benefit_origin='rank') then continue; end if;
  select x into n from generate_series(1,r.max_number) x where not exists(
   select 1 from public.raffle_entries e where e.raffle_id=r.id and e.raffle_number=x) order by x limit 1;
  if n is null then continue; end if; -- Full raffle: no invented number or failed payment.
  insert into public.raffle_entries(raffle_id,raffle_number,client_id,client_auth_user_id,benefit_origin)
  select r.id,n,c.id,c.auth_user_id,'rank' from public.crm_clientes c where c.id=p_cliente_id
  on conflict do nothing returning id into entry_id;
  if entry_id is not null then
   insert into public.tc_client_benefit_events(cliente_id,rank_at_event,benefit_key,benefit_type,delivery_key,snapshot)
   values(p_cliente_id,rank_key,'rank_raffle:'||r.id,'raffle','rank-raffle:'||r.id||':'||p_cliente_id,
    jsonb_build_object('raffle_id',r.id,'entry_id',entry_id,'number',n,'origin','rank','policy_version','2026-11-v1'));
   count_added:=count_added+1;
  end if;
 end loop;
 if count_added>0 then perform public.tc_touch_roulette_signal(p_cliente_id); end if;
 return count_added;
end $$;

create or replace function public.tc_sync_rank_raffles()
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; added integer:=0;
begin
 if not exists(select 1 from public.raffles where status='active') then return 0; end if;
 -- Restrict the candidate set before calling the canonical rolling-rank resolver.
 for candidate in select distinct x.id from (
  select cliente_id as id from public.crm_cliente_pagos where estado='completed' and importe>0 and created_at>=now()-interval '30 days'
  union select client_id from public.client_rank_overrides where active and assigned_rank in ('oro','diamante') and starts_at<=now() and (ends_at is null or ends_at>now())
  union select c.id from public.rendimiento_llamadas l join public.crm_clientes c on l.cliente_id=c.id::text
   where l.importe>0 and coalesce(l.fecha_hora,l.created_at)>=now()-interval '30 days'
 ) x where exists(select 1 from public.raffles r where r.status='active' and not exists(
  select 1 from public.raffle_entries e where e.raffle_id=r.id and e.client_id=x.id and e.benefit_origin='rank'))
 loop added:=added+public.tc_assign_rank_raffle(candidate.id); end loop;
 return added;
end $$;

create or replace function public.tc_customer_raffle_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='client_rank_overrides' then perform public.tc_assign_rank_raffle(new.client_id);
 elsif tg_table_name='crm_cliente_pagos' then
  if new.estado='completed' and new.benefits_processed_at is not null then perform public.tc_assign_rank_raffle(new.cliente_id); end if;
 elsif new.status='active' then perform public.tc_sync_rank_raffles();
 end if;
 return new;
end $$;
drop trigger if exists tc_customer_raffle_purchase on public.crm_cliente_pagos;
create trigger tc_customer_raffle_purchase after insert or update of benefits_processed_at on public.crm_cliente_pagos
for each row execute function public.tc_customer_raffle_event();
drop trigger if exists tc_customer_raffle_rank on public.client_rank_overrides;
create trigger tc_customer_raffle_rank after insert or update of assigned_rank,active on public.client_rank_overrides
for each row execute function public.tc_customer_raffle_event();
drop trigger if exists tc_customer_raffle_open on public.raffles;
create trigger tc_customer_raffle_open after insert or update of status on public.raffles
for each row execute function public.tc_customer_raffle_event();




create or replace function public.tc_resolve_rank_package_benefit(p_cliente_id uuid,p_rank_key_override text,p_package_source text,p_package_key text,p_config_override jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; policy public.tc_customer_benefit_policy; cfg jsonb;
begin
 r:=public.tc_resolve_rank_package_benefit_before_202611(p_cliente_id,p_rank_key_override,p_package_source,p_package_key,p_config_override);
 select * into policy from public.tc_customer_benefit_policy where id;
 if policy.activated_at is not null then
  r:=r||jsonb_build_object('regular_bonus_minutes',case when p_package_source='standard'
    then coalesce((policy.ranks->(r->>'rank_key')->>'regular_bonus_minutes')::integer,0) else 0 end);
 end if;
 if policy.activated_at is not null and r->>'rank_key'='diamante' and (r->>'package_level')::int in (1,2,3) then
  cfg:=coalesce(r->'rank_benefits','{}')||jsonb_build_object('enabled',true,'coins',policy.diamond_purchase_coins,
    'roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',1);
  r:=r||jsonb_build_object('status','ready','rank_benefits',cfg,'replaces_native_coins',true,'replaces_level_spin',true,'policy_version',policy.version);
 end if;
 return r;
end $$;




-- One-time activation. Rerunning cannot extend deadlines or change historic balances.
do $activation$
declare policy public.tc_customer_benefit_policy; campaign uuid;
begin
 select * into policy from public.tc_customer_benefit_policy where id for update;
 if policy.activated_at is not null then return; end if;
 campaign:=public.tc_client_roulette_active_campaign_id();
 if campaign is null then raise exception 'NO_ACTIVE_ROULETTE_FOR_DIAMOND'; end if;
 if not exists(select 1 from public.tc_client_roulette_rewards where campaign_id=campaign and nivel=4 and is_active and weight>0) then
  raise exception 'NO_SPECIAL_CATALOGUE_TO_PRESERVE'; end if;
 if exists(select 1 from public.tc_client_roulette_rewards where campaign_id=campaign and nivel=5) then
  raise exception 'DIAMOND_CATALOGUE_CHANGED_REVIEW_REQUIRED'; end if;
 insert into public.tc_client_roulette_rewards
 select copied.* from public.tc_client_roulette_rewards r cross join lateral jsonb_populate_record(
 null::public.tc_client_roulette_rewards,to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'nivel',5,
 'created_at',clock_timestamp(),'updated_at',clock_timestamp(),
 'metadata',coalesce(r.metadata,'{}')||jsonb_build_object('copied_from_reward_id',r.id,'policy_version',policy.version))) copied
 where r.campaign_id=campaign and r.nivel=4;
 update public.tc_client_roulette_campaigns set diamond_enabled=true,updated_at=clock_timestamp() where id=campaign;
 update public.crm_new_tarotista_gift_policy set rank_minutes=(select jsonb_object_agg(key,value->'intro_minutes') from jsonb_each(policy.ranks)) where id;
 update public.crm_free_pass_policy set passes=1,cycle_days=30 where id;
 update public.tc_rank_daily_bonus_config set enabled=false,revision=revision+1,updated_at=clock_timestamp() where rank_key='diamante';
 update public.tc_client_rank_benefits set daily_bonus_enabled=false,revision=revision+1,updated_at=clock_timestamp() where rank_key='diamante';
 update public.recompensas set puntos_coste=case minutos_otorgados when 10 then 800 when 20 then 1200 when 30 then 1800 when 60 then 3000 end
 where minutos_otorgados in (10,20,30,60);
 update public.cliente_ruleta_giros set expires_at=greatest(created_at,policy.legacy_spin_clock_started_at)+make_interval(hours=>policy.spin_lifetime_hours),
  expiry_policy=policy.version where estado='pending' and nivel in (1,2,3,5) and expires_at is null and expiry_policy is null;
 update public.tc_customer_benefit_policy set activated_at=clock_timestamp() where id and activated_at is null;
 insert into public.tc_client_benefit_audit(action,entity,entity_id,before_data,after_data)
 select 'activate','customer_benefit_policy',version,to_jsonb(policy),to_jsonb(p) from public.tc_customer_benefit_policy p where p.id;
end $activation$;
-- Function grants are explicit; neither the public API nor a caller-supplied ID can
-- invoke a privileged helper. Existing verified Next.js handlers use service_role.
do $permissions$
declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'tc_customer_%' or p.proname like '%_before_202611'
  or p.proname in ('tc_assign_rank_raffle','tc_sync_rank_raffles'))
 loop execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature); end loop;
end $permissions$;
notify pgrst,'reload schema';
commit;

