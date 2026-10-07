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
      if v_existing_payment.cliente_id<>v_cliente_id or v_existing_payment.importe<>v_importe then raise exception 'PAYMENT_REFERENCE_CONFLICT'; end if;
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

  if v_is_purchase then
    update public.crm_cliente_pagos set benefits_context=jsonb_build_object(
      'coins',v_points,'oracle_credits',v_oracle,
      'special_spins',case when coalesce((p_payload->>'super_promo_ruleta')::boolean,false) then 1 when v_level=4 then v_spins else 0 end,
      'source',v_benefit_source,'promotion',v_benefits
    ) where id=v_payment.id;
    perform public.tc_apply_purchase_benefits(v_payment.id);
  end if;
  select coalesce(puntos,0) into v_points_after from public.crm_clientes where id=v_cliente_id;

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
$function$
