-- Tarot Celestial · Sincronización real de premios, Coins y minutos
-- Aplicado en Supabase mediante la migración sync_client_reward_credits_and_balances.
-- Fuente única de saldos: public.crm_clientes.

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
  if p_level not in (1,2,3,4) then raise exception 'INVALID_LEVEL'; end if;

  select * into v_spin
  from public.cliente_ruleta_giros
  where id=p_spin_id and cliente_id=p_cliente_id and estado='pending' and nivel=p_level
  for update;

  if v_spin.id is null then raise exception 'INVALID_SPIN'; end if;

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

CREATE OR REPLACE FUNCTION public.crm_register_call_atomic_v8(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reference text;
  v_existing_payment public.crm_cliente_pagos%rowtype;
  v_rendimiento public.rendimiento_llamadas%rowtype;
  v_payment public.crm_cliente_pagos%rowtype;
  v_cliente public.crm_clientes%rowtype;
  v_cliente_id uuid;
  v_worker_id uuid;
  v_tarotist_id uuid;
  v_author_user_id uuid;
  v_importe numeric := 0;
  v_points numeric := 0;
  v_is_purchase boolean := false;
  v_now timestamptz := now();
  v_current_points numeric := 0;
  v_points_after numeric := 0;
  v_free_delta numeric := 0;
  v_normal_delta numeric := 0;
  v_free_before numeric := 0;
  v_normal_before numeric := 0;
  v_free_after numeric := 0;
  v_normal_after numeric := 0;
  v_benefits jsonb := '{}'::jsonb;
  v_benefit_source text := null;
  v_oracle integer := 0;
  v_spins integer := 0;
  v_level smallint := null;
  v_spin_number integer;
  v_payment_key text;
begin
  v_cliente_id := nullif(p_payload->>'cliente_id', '')::uuid;
  v_worker_id := nullif(p_payload->>'telefonista_worker_id', '')::uuid;
  v_tarotist_id := nullif(p_payload->>'tarotista_worker_id', '')::uuid;
  v_author_user_id := nullif(p_payload->>'note_author_user_id', '')::uuid;
  v_importe := greatest(coalesce(nullif(p_payload->>'importe', '')::numeric, 0), 0);
  v_points := greatest(coalesce(nullif(p_payload->>'points_to_add', '')::numeric, 0), 0);
  v_is_purchase := coalesce((p_payload->>'cliente_compra_minutos')::boolean, false) and v_importe > 0;
  v_reference := case
    when v_is_purchase then 'registrar_llamada:' || nullif(p_payload->>'operation_id', '')
    else null
  end;

  v_free_delta := coalesce(nullif(p_payload->>'free_delta', '')::numeric, 0);
  v_normal_delta := coalesce(nullif(p_payload->>'normal_delta', '')::numeric, 0);
  v_benefits := coalesce(p_payload->'purchase_benefits', '{}'::jsonb);
  v_benefit_source := nullif(v_benefits->>'source', '');
  v_oracle := greatest(coalesce(nullif(v_benefits->>'oracle_credits', '')::integer, 0), 0);
  v_spins := greatest(coalesce(nullif(v_benefits->>'roulette_spins', '')::integer, 0), 0);
  v_level := nullif(v_benefits->>'roulette_level', '')::smallint;

  if v_cliente_id is null then
    raise exception using message = 'CLIENT_ID_REQUIRED', errcode = '22023';
  end if;

  select * into v_cliente
  from public.crm_clientes
  where id = v_cliente_id
  for update;

  if not found then
    raise exception using message = 'CLIENT_NOT_FOUND', errcode = 'P0002';
  end if;

  v_free_before := coalesce(v_cliente.minutos_free_pendientes, 0);
  v_normal_before := coalesce(v_cliente.minutos_normales_pendientes, 0);
  v_free_after := v_free_before + v_free_delta;
  v_normal_after := v_normal_before + v_normal_delta;

  if v_free_after < 0 then
    raise exception using message = 'INSUFFICIENT_FREE_MINUTES', errcode = 'P0001';
  end if;
  if v_normal_after < 0 then
    raise exception using message = 'INSUFFICIENT_NORMAL_MINUTES', errcode = 'P0001';
  end if;

  if v_is_purchase and (v_reference is null or v_reference = 'registrar_llamada:') then
    raise exception using message = 'OPERATION_ID_REQUIRED', errcode = '22023';
  end if;

  if v_is_purchase then
    perform pg_advisory_xact_lock(hashtext(v_reference));
    select * into v_existing_payment
    from public.crm_cliente_pagos
    where referencia_externa = v_reference
    limit 1;

    if found then
      select * into v_rendimiento
      from public.rendimiento_llamadas
      where id = v_existing_payment.source_rendimiento_id;
      return jsonb_build_object(
        'duplicate_prevented', true,
        'payment', to_jsonb(v_existing_payment),
        'rendimiento', to_jsonb(v_rendimiento),
        'balances', jsonb_build_object(
          'free', coalesce(v_cliente.minutos_free_pendientes,0),
          'normal', coalesce(v_cliente.minutos_normales_pendientes,0),
          'coins', coalesce(v_cliente.puntos,0)
        )
      );
    end if;
  end if;

  insert into public.rendimiento_llamadas (
    fecha, fecha_hora, cliente_id, cliente_nombre,
    telefonista_worker_id, telefonista_nombre,
    tarotista_worker_id, tarotista_nombre, tarotista_manual_call,
    llamada_call, tipo_registro, cliente_compra_minutos,
    usa_7_free, usa_minutos, misma_compra, guarda_minutos,
    minutos_guardados_free, minutos_guardados_normales,
    codigo_1, minutos_1, codigo_2, minutos_2,
    resumen_codigo, tiempo, forma_pago, importe, promo, captado, recuperado
  ) values (
    (v_now at time zone 'Europe/Madrid')::date,
    v_now,
    v_cliente_id,
    nullif(p_payload->>'cliente_nombre', ''),
    v_worker_id,
    nullif(p_payload->>'telefonista_nombre', ''),
    v_tarotist_id,
    nullif(p_payload->>'tarotista_nombre', ''),
    nullif(p_payload->>'tarotista_manual_call', ''),
    coalesce((p_payload->>'llamada_call')::boolean, false),
    nullif(p_payload->>'tipo_registro', ''),
    coalesce((p_payload->>'cliente_compra_minutos')::boolean, false),
    coalesce((p_payload->>'usa_7_free')::boolean, false),
    coalesce((p_payload->>'usa_minutos')::boolean, false),
    coalesce((p_payload->>'misma_compra')::boolean, false),
    coalesce((p_payload->>'guarda_minutos')::boolean, false),
    coalesce(nullif(p_payload->>'minutos_guardados_free', '')::numeric, 0),
    coalesce(nullif(p_payload->>'minutos_guardados_normales', '')::numeric, 0),
    nullif(p_payload->>'codigo_1', ''),
    coalesce(nullif(p_payload->>'minutos_1', '')::numeric, 0),
    nullif(p_payload->>'codigo_2', ''),
    coalesce(nullif(p_payload->>'minutos_2', '')::numeric, 0),
    nullif(p_payload->>'resumen_codigo', ''),
    coalesce(nullif(p_payload->>'tiempo', '')::numeric, 0),
    nullif(p_payload->>'forma_pago', ''),
    v_importe,
    coalesce((p_payload->>'promo')::boolean, false),
    coalesce((p_payload->>'captado')::boolean, false),
    coalesce((p_payload->>'recuperado')::boolean, false)
  ) returning * into v_rendimiento;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='rendimiento_llamadas' and column_name='billing_collaborator_id'
  ) and nullif(p_payload->>'billing_collaborator_id','') is not null then
    execute 'update public.rendimiento_llamadas set billing_collaborator_id=$1 where id=$2'
      using nullif(p_payload->>'billing_collaborator_id','')::uuid, v_rendimiento.id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='rendimiento_llamadas' and column_name='source_tag_id'
  ) and nullif(p_payload->>'source_tag_id','') is not null then
    execute 'update public.rendimiento_llamadas set source_tag_id=$1 where id=$2'
      using nullif(p_payload->>'source_tag_id','')::uuid, v_rendimiento.id;
  end if;

  if v_is_purchase then
    insert into public.crm_cliente_pagos (
      cliente_id, importe, moneda, metodo, estado, notas, referencia_externa,
      created_by_user_id, created_by_role, source_rendimiento_id, created_at
    ) values (
      v_cliente_id, v_importe, 'EUR', nullif(p_payload->>'forma_pago',''),
      'completed', nullif(p_payload->>'note_text',''), v_reference,
      v_worker_id, nullif(p_payload->>'created_by_role',''),
      v_rendimiento.id, v_now
    ) returning * into v_payment;
  end if;

  -- CRÍTICO: no escribimos un snapshot viejo del navegador.
  -- Aplicamos el delta sobre la fila bloqueada, por lo que una ruleta/canje
  -- acreditado en paralelo nunca puede ser borrado por registrar una llamada.
  update public.crm_clientes
  set minutos_free_pendientes = v_free_after,
      minutos_normales_pendientes = v_normal_after,
      updated_at = v_now
  where id = v_cliente_id;

  if v_is_purchase and v_points > 0 then
    v_current_points := coalesce(v_cliente.puntos,0);
    v_points_after := v_current_points + v_points;

    update public.crm_clientes
    set puntos = v_points_after,
        updated_at = v_now
    where id = v_cliente_id;

    insert into public.cliente_puntos_historial (
      cliente_id, tipo, puntos, descripcion, operation_id, saldo_despues, meta
    ) values (
      v_cliente_id,
      'ganado',
      round(v_points)::integer,
      case
        when v_benefit_source='active_promotion'
          then 'Beneficio de compra · +'||round(v_points)::integer||' Coins'
        else format('Compra de %s€ → +%s puntos.', v_importe, round(v_points)::integer)
      end,
      v_payment.id,
      round(v_points_after)::integer,
      jsonb_build_object(
        'source', coalesce(v_benefit_source,'legacy_amount'),
        'payment_id', v_payment.id,
        'rendimiento_id', v_rendimiento.id,
        'purchase_benefits', v_benefits
      )
    );
  else
    v_points_after := coalesce(v_cliente.puntos,0);
  end if;

  if v_is_purchase and v_oracle > 0 then
    insert into public.cliente_oracle_credit_movements(
      cliente_id, amount, movement_type, reference, pack_id, notes, meta
    ) values (
      v_cliente_id,
      v_oracle,
      'purchase',
      'central_payment:'||v_payment.id::text||':oracle',
      coalesce(nullif(v_benefits->>'package_id',''),'central'),
      'Beneficio automático de compra registrado desde Central',
      jsonb_build_object(
        'source', coalesce(v_benefit_source,'central_purchase'),
        'payment_id', v_payment.id,
        'rendimiento_id', v_rendimiento.id,
        'purchase_benefits', v_benefits
      )
    )
    on conflict (reference) do nothing;
  end if;

  -- Si la compra coincide exactamente con un pack de la promoción ACTIVA,
  -- sustituimos el giro genérico del trigger por la configuración real del pack.
  if v_is_purchase and v_benefit_source='active_promotion' then
    v_payment_key := 'rendimiento:'||v_rendimiento.id::text;

    delete from public.cliente_ruleta_giros
    where cliente_id=v_cliente_id
      and estado='pending'
      and (payment_key=v_payment_key or purchase_id=v_payment.id);

    if v_spins > 0 then
      if v_level is null or v_level not in (1,2,3,4) then
        raise exception using message='PROMOTION_ROULETTE_BENEFITS_INVALID', errcode='22023';
      end if;

      for v_spin_number in 1..v_spins loop
        insert into public.cliente_ruleta_giros(
          cliente_id,payment_key,source,nivel,purchase_minutes,purchase_id,
          purchase_amount,purchase_currency,estado
        ) values (
          v_cliente_id,
          v_payment_key || case when v_spin_number=1 then '' else ':promo:'||v_spin_number::text end,
          'central_active_promotion',
          v_level,
          greatest(0,round(
            coalesce(nullif(p_payload->>'minutos_guardados_free','')::numeric,0)
            + coalesce(nullif(p_payload->>'minutos_guardados_normales','')::numeric,0)
            + coalesce(nullif(p_payload->>'minutos_1','')::numeric,0)
            + coalesce(nullif(p_payload->>'minutos_2','')::numeric,0)
          ))::integer,
          v_payment.id,
          v_importe,
          'EUR',
          'pending'
        );
      end loop;
    end if;
  end if;

  if nullif(p_payload->>'note_text','') is not null then
    insert into public.crm_client_notes(
      cliente_id,texto,author_user_id,author_name,author_email,is_pinned,
      created_at,event_type,event_data
    ) values (
      v_cliente_id::text,
      p_payload->>'note_text',
      v_author_user_id,
      nullif(p_payload->>'note_author_name',''),
      nullif(p_payload->>'note_author_email',''),
      false,
      v_now,
      case when v_is_purchase then 'purchase_registered' else 'call_activity' end,
      jsonb_build_object(
        'rendimiento_id',v_rendimiento.id,
        'payment_id',case when v_is_purchase then v_payment.id else null end,
        'free_before',v_free_before,
        'free_delta',v_free_delta,
        'free_after',v_free_after,
        'normal_before',v_normal_before,
        'normal_delta',v_normal_delta,
        'normal_after',v_normal_after,
        'coins_added',case when v_is_purchase then v_points else 0 end,
        'coins_after',v_points_after,
        'purchase_benefits',v_benefits
      )
    );
  end if;

  if v_is_purchase and (v_points>0 or v_oracle>0 or (v_benefit_source='active_promotion' and v_spins>0)) then
    insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
    values (
      v_cliente_id,
      'purchase_benefits',
      'Beneficios de tu compra acreditados',
      concat_ws(' · ',
        case when v_points>0 then '+'||round(v_points)::integer||' Coins' end,
        case when v_oracle>0 then '+'||v_oracle||' tirada'||case when v_oracle=1 then '' else 's' end||' de Oráculo' end,
        case when v_benefit_source='active_promotion' and v_spins>0 then '+'||v_spins||' giro'||case when v_spins=1 then '' else 's' end||' de ruleta' end
      ),
      jsonb_build_object(
        'payment_id',v_payment.id,
        'rendimiento_id',v_rendimiento.id,
        'purchase_benefits',v_benefits,
        'balances',jsonb_build_object(
          'free',v_free_after,'normal',v_normal_after,'coins',v_points_after
        )
      ),
      false,
      v_now
    );
  end if;

  return jsonb_build_object(
    'duplicate_prevented',false,
    'payment',case when v_is_purchase then to_jsonb(v_payment) else null end,
    'rendimiento',to_jsonb(v_rendimiento),
    'balances',jsonb_build_object(
      'free_before',v_free_before,'free_after',v_free_after,
      'normal_before',v_normal_before,'normal_after',v_normal_after,
      'coins_after',v_points_after
    ),
    'purchase_benefits',v_benefits
  );
end;
$function$;

revoke all on function public.crm_register_call_atomic_v8(jsonb) from public, anon, authenticated;
grant execute on function public.crm_register_call_atomic_v8(jsonb) to service_role;

-- Corrección detectada durante la auditoría:
-- el catálogo mostraba "20 minutos" pero acreditaba 5.
update public.tc_client_roulette_rewards
set reward_value = 20,
    updated_at = now()
where id = 'b3a291cb-f4f1-42e0-9a21-6e16ee0e8747'
  and nivel = 4
  and reward_type = 'minutes'
  and name = '20 minutos'
  and reward_value = 5;
