-- Roulette belongs to the purchased package, never to a second rank grant.
-- Preserve Coins, minutes, Oracle, package spin quantities, Diamond choice and all history.
-- Applies to future/unprocessed purchases only; no existing reward row is changed.
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

  -- Obsolete rank roulette settings are never advertised as extra purchase rewards.
  if v_cfg is not null then
    v_cfg := v_cfg || jsonb_build_object('roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',0);
  end if;
  if v_legacy is not null then
    v_legacy := v_legacy || jsonb_build_object('roulette_enabled',false,'roulette_spins',0);
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

revoke all on function public.tc_resolve_rank_package_benefit_before_202611(uuid, text, text, text, jsonb) from public,anon,authenticated;
grant execute on function public.tc_resolve_rank_package_benefit_before_202611(uuid, text, text, text, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.tc_customer_benefits_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select to_jsonb(p)||jsonb_build_object('redemptions',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',r.id,'minutes',r.minutos_otorgados,'coins',r.puntos_coste) order by r.minutos_otorgados),'[]') from public.recompensas r where r.activo),
 'package_benefits',(select coalesce(jsonb_agg((to_jsonb(b)-'updated_by')||jsonb_build_object('roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',0)||case when b.rank_key='diamante' and p.activated_at is not null then
 jsonb_build_object('enabled',true,'coins',p.diamond_purchase_coins,'roulette_level_1_spins',0,'roulette_level_2_spins',0,
 'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',0,'diamond_roulette_choice_available',true) else '{}'::jsonb end order by b.rank_key,b.package_level),'[]')
 from public.tc_rank_package_benefits b)) from public.tc_customer_benefit_policy p where p.id
$function$;

revoke all on function public.tc_customer_benefits_config() from public,anon,authenticated;
grant execute on function public.tc_customer_benefits_config() to service_role;

CREATE OR REPLACE FUNCTION public.tc_preview_rank_package_benefit(p_rank_key text, p_package_level smallint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_build_object(
    'rank_key',b.rank_key,'package_level',b.package_level,'enabled',b.enabled,
    'coins',b.coins,'oracle_credits',b.oracle_credits,
    'roulette_level_1_spins',0,
    'roulette_level_2_spins',0,
    'roulette_level_3_spins',0,
    'roulette_special_spins',0,
    'summary',concat_ws(' · ',
      case when b.coins>0 then '+'||b.coins||' Coins' end,
      case when b.oracle_credits>0 then '+'||b.oracle_credits||' Oráculo' end
    )
  ),'{}'::jsonb)
  from public.tc_rank_package_benefits b where b.rank_key=p_rank_key and b.package_level=p_package_level;
$function$;

revoke all on function public.tc_preview_rank_package_benefit(text, smallint) from public,anon,authenticated;
grant execute on function public.tc_preview_rank_package_benefit(text, smallint) to service_role;

CREATE OR REPLACE FUNCTION public.tc_save_rank_package_benefit(p_actor uuid, p_edit jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare oldrow public.tc_rank_package_benefits; saved public.tc_rank_package_benefits; v_level smallint;
begin
  perform public.tc_assert_benefit_admin(p_actor);
  if coalesce((p_edit->>'roulette_level_1_spins')::integer,0)<>0
    or coalesce((p_edit->>'roulette_level_2_spins')::integer,0)<>0
    or coalesce((p_edit->>'roulette_level_3_spins')::integer,0)<>0
    or coalesce((p_edit->>'roulette_special_spins')::integer,0)<>0
    or coalesce((p_edit->>'roulette_diamond_spins')::integer,0)<>0 then
    raise exception 'RANK_PURCHASE_ROULETTE_DISABLED';
  end if;
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
end $function$;

revoke all on function public.tc_save_rank_package_benefit(uuid, jsonb) from public,anon,authenticated;
grant execute on function public.tc_save_rank_package_benefit(uuid, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.tc_save_rank_benefit_config(p_actor uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.tc_client_rank_benefits%rowtype; b public.tc_client_purchase_bands%rowtype; promo public.tc_client_promotions%rowtype;
  v_id uuid; before_row jsonb; after_row jsonb; rev integer;
begin
  if not exists(select 1 from public.workers where user_id=p_actor and (role='admin' or public.tc_has_admin_access(p_actor)) and is_active is distinct from false) then raise exception 'ADMIN_REQUIRED'; end if;
  perform set_config('tc.benefit_actor',p_actor::text,true);
  if p_action='rank' then
    if coalesce((p_data->>'roulette_enabled')::boolean,false) then
      raise exception 'RANK_PURCHASE_ROULETTE_DISABLED';
    end if;
    select * into r from public.tc_client_rank_benefits where rank_key=p_data->>'rank_key' for update;
    if r.rank_key is not null and r.revision<>coalesce((p_data->>'revision')::integer,0) then raise exception 'CONFIG_CONFLICT'; end if;
    insert into public.tc_client_rank_benefits(rank_key,label,min_spend,sort_order,is_active,coins_enabled,purchase_coins,roulette_enabled,roulette_level,roulette_spins,daily_bonus_enabled,revision,updated_by)
    values(p_data->>'rank_key',p_data->>'label',(p_data->>'min_spend')::numeric,coalesce((p_data->>'sort_order')::integer,0),
      (p_data->>'is_active')::boolean,(p_data->>'coins_enabled')::boolean,(p_data->>'purchase_coins')::integer,
      (p_data->>'roulette_enabled')::boolean,(p_data->>'roulette_level')::smallint,(p_data->>'roulette_spins')::integer,
      (p_data->>'daily_bonus_enabled')::boolean,coalesce(r.revision,0)+1,p_actor)
    on conflict(rank_key) do update set label=excluded.label,min_spend=excluded.min_spend,sort_order=excluded.sort_order,is_active=excluded.is_active,
      coins_enabled=excluded.coins_enabled,purchase_coins=excluded.purchase_coins,roulette_enabled=excluded.roulette_enabled,
      roulette_level=excluded.roulette_level,roulette_spins=excluded.roulette_spins,daily_bonus_enabled=excluded.daily_bonus_enabled,
      revision=excluded.revision,updated_by=p_actor,updated_at=now() returning to_jsonb(tc_client_rank_benefits.*) into after_row;
  elsif p_action='band' then
    perform pg_advisory_xact_lock(hashtext('tc_purchase_bands'));
    v_id:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
    select * into b from public.tc_client_purchase_bands where tc_client_purchase_bands.id=v_id for update;
    if b.id is not null and b.revision<>coalesce((p_data->>'revision')::integer,0) then raise exception 'CONFIG_CONFLICT'; end if;
    insert into public.tc_client_purchase_bands(id,currency,min_amount,max_amount,roulette_level,spins,is_active,revision,updated_by)
    values(v_id,p_data->>'currency',(p_data->>'min_amount')::numeric,nullif(p_data->>'max_amount','')::numeric,(p_data->>'roulette_level')::smallint,
      (p_data->>'spins')::integer,(p_data->>'is_active')::boolean,coalesce(b.revision,0)+1,p_actor)
    on conflict(id) do update set currency=excluded.currency,min_amount=excluded.min_amount,max_amount=excluded.max_amount,
      roulette_level=excluded.roulette_level,spins=excluded.spins,is_active=excluded.is_active,revision=excluded.revision,updated_by=p_actor,updated_at=now()
    returning to_jsonb(tc_client_purchase_bands.*) into after_row;
  elsif p_action='bonus' then
    v_id:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
    select * into promo from public.tc_client_promotions where tc_client_promotions.id=v_id for update;
    if promo.id is not null and (promo.promotion_kind<>'rank_bonus' or promo.benefit_revision<>coalesce((p_data->>'benefit_revision')::integer,0)) then raise exception 'CONFIG_CONFLICT'; end if;
    if p_data->>'status' not in ('active','inactive','draft','scheduled') then raise exception 'INVALID_STATUS'; end if;
    if (p_data->>'ends_at')::timestamptz<=(p_data->>'starts_at')::timestamptz then raise exception 'INVALID_DATES'; end if;
    if coalesce((p_data->'benefit'->>'coins')::integer,0)<0 or coalesce((p_data->'benefit'->>'minutes')::integer,0)<0 or coalesce((p_data->'benefit'->>'oracle_credits')::integer,0)<0
      or coalesce((p_data->'benefit'->>'coins')::integer,0)+coalesce((p_data->'benefit'->>'minutes')::integer,0)+coalesce((p_data->'benefit'->>'oracle_credits')::integer,0)<=0 then raise exception 'BONUS_INVALID'; end if;
    before_row:=case when promo.id is not null then to_jsonb(promo) end;
    insert into public.tc_client_promotions(id,name,description,status,starts_at,ends_at,active_until_disabled,promotion_kind,authorized_rank,image_url,benefit,max_uses_per_client,benefit_revision,created_by,updated_at)
    values(v_id,p_data->>'name',p_data->>'description',p_data->>'status',nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'ends_at','')::timestamptz,
      coalesce((p_data->>'active_until_disabled')::boolean,false),'rank_bonus',p_data->>'authorized_rank',nullif(p_data->>'image_url',''),
      p_data->'benefit',coalesce((p_data->>'max_uses_per_client')::integer,1),coalesce(promo.benefit_revision,0)+1,p_actor,now())
    on conflict(id) do update set name=excluded.name,description=excluded.description,status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      active_until_disabled=excluded.active_until_disabled,authorized_rank=excluded.authorized_rank,image_url=excluded.image_url,
      benefit=excluded.benefit,max_uses_per_client=excluded.max_uses_per_client,benefit_revision=excluded.benefit_revision,updated_at=now()
    returning to_jsonb(tc_client_promotions.*) into after_row;
    insert into public.tc_client_benefit_audit(actor_user_id,action,entity,entity_id,before_data,after_data)
      values(p_actor,'bonus_saved','tc_client_promotions',v_id::text,before_row,after_row);
    insert into public.tc_client_promotion_audit(promotion_id,action,actor_user_id,snapshot) values(v_id,'rank_bonus_saved',p_actor,after_row);
  else raise exception 'INVALID_ACTION'; end if;
  return after_row;
end $function$;

revoke all on function public.tc_save_rank_benefit_config(uuid, text, jsonb) from public,anon,authenticated;
grant execute on function public.tc_save_rank_benefit_config(uuid, text, jsonb) to service_role;

notify pgrst,'reload schema';
commit;


