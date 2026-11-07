-- Promo minute purchases grant no Oracle benefits, whether native or from the rank matrix.
-- Normal purchases, Super Promo and separately paid Oracle products retain their current grants.
-- No existing balance, purchase, movement or history is changed.
begin;

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
  -- Promotional minute purchases never grant Oracle benefits. Direct paid Oracle uses its separate finalizer.
  oc:=case when v_policy->>'pricing_mode'='promotion' then 0
    else greatest(coalesce((ctx->>'oracle_credits')::integer,0),0) end;
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
      0 /* A rank never grants a second purchase spin. */)
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
revoke all on function public.tc_apply_purchase_benefits_before_202611(uuid) from public,anon,authenticated;
grant execute on function public.tc_apply_purchase_benefits_before_202611(uuid) to service_role;

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
    -- Coins and Oracle credits still follow the configured rank/package matrix.
    -- Roulette is granted exactly once by the purchase engine, never by rank.
    v_n1 := 0; v_n2 := 0; v_n3 := 0; v_special := 0;
  end if;

  if not coalesce((v_policy->>'coins_eligible')::boolean,false) then v_coins:=0; end if;
  if v_policy->>'pricing_mode'='promotion' then v_oracle:=0; end if;
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

  -- No rank spin rows are created; the purchase engine owns those grants.

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
revoke all on function public.tc_apply_rank_package_benefits_before_202611(uuid) from public,anon,authenticated;
grant execute on function public.tc_apply_rank_package_benefits_before_202611(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tc_resolve_rank_package_benefit(p_cliente_id uuid, p_rank_key_override text, p_package_source text, p_package_key text, p_config_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; policy public.tc_customer_benefit_policy; cfg jsonb;
begin
 r:=public.tc_resolve_rank_package_benefit_before_202611(p_cliente_id,p_rank_key_override,p_package_source,p_package_key,p_config_override);
 select * into policy from public.tc_customer_benefit_policy where id;
 if policy.activated_at is not null then
  r:=r||jsonb_build_object('regular_bonus_minutes',case when p_package_source='standard'
    then coalesce((policy.ranks->(r->>'rank_key')->>'regular_bonus_minutes')::integer,0) else 0 end);
 end if;
 if policy.activated_at is not null and p_package_source='standard' and r->>'rank_key'='diamante' and (r->>'package_level')::int in (1,2,3) then
  cfg:=coalesce(r->'rank_benefits','{}')||jsonb_build_object('enabled',true,'coins',policy.diamond_purchase_coins,
    'roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',0,'diamond_roulette_choice_available',true);
  r:=r||jsonb_build_object('status','ready','rank_benefits',cfg,'replaces_native_coins',true,'replaces_level_spin',false,'diamond_roulette_choice_available',true,'policy_version',policy.version);
 end if;
 if p_package_source='promotion' then
  cfg:=coalesce(r->'rank_benefits','{}')||jsonb_build_object('coins',0,'oracle_credits',0,
    'roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,
    'roulette_special_spins',0,'roulette_diamond_spins',0);
  r:=r||jsonb_build_object('rank_benefits',cfg,'replaces_native_coins',false,'replaces_level_spin',false);
 end if;
 return r;
end $function$;
revoke all on function public.tc_resolve_rank_package_benefit(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.tc_resolve_rank_package_benefit(uuid,text,text,text,jsonb) to service_role;

commit;
