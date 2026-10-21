-- Production RPC captured on 2026-10-21 before the payment provenance fix.
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
begin
  if p_level not in (1,2,3,4,5) then raise exception 'INVALID_LEVEL'; end if;

  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  select * into v_spin
  from public.cliente_ruleta_giros
  where id=p_spin_id and cliente_id=p_cliente_id and nivel=p_level
  for update;

  if v_spin.id is null then raise exception 'INVALID_SPIN'; end if;
  perform public.tc_assert_roulette_access(p_cliente_id,p_level,v_spin.required_rank);
  if v_spin.estado='used' then
    return public.cliente_ruleta_resumen_ultra_v1(p_cliente_id)||jsonb_build_object(
      'spin_id',v_spin.id,'spin_level',p_level,'reward_id',v_spin.reward_id,'reward_type',v_spin.reward_type,
      'reward_value',v_spin.reward_value,'reward_label',v_spin.reward_label,'reward_rarity',v_spin.reward_rarity,
      'reward_meta',v_spin.reward_meta,'balance_before',coalesce(v_spin.balance_antes,0),
      'balance_after',coalesce(v_spin.balance_despues,0),'special',v_spin.premio_especial,'replayed',true);
  end if;
  if v_spin.estado<>'pending' then raise exception 'INVALID_SPIN'; end if;

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

  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,coins,minutes,oracle_credits,spin_id,snapshot)
  values(p_cliente_id,v_spin.purchase_id,public.tc_client_rank_state(p_cliente_id)->>'effective',
    'roulette_result:'||v_spin.id,'roulette_result',
    case when v_reward.reward_type='coins' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='minutes' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='oracle_credits' then round(v_reward.reward_value)::integer else 0 end,
    v_spin.id,to_jsonb(v_reward));
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
$function$

;
