-- Read-only production function snapshots (2026-10-29), no production records.
-- Unchanged minute accounting, call creation, first-contact and Diamond gift paths.
CREATE OR REPLACE FUNCTION public.tc_client_rank_state(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
  v_count integer;
  v_auto text;
  v_override jsonb;
  v_cfg jsonb;
  v_next jsonb;
begin
  with purchases as (
    select p.importe::numeric as amount
    from public.crm_cliente_pagos p
    where p.cliente_id = p_cliente_id
      and p.estado = 'completed'
      and p.importe > 0
      and p.created_at between now() - interval '30 days' and now()

    union all

    select l.importe::numeric
    from public.rendimiento_llamadas l
    where pg_catalog.btrim(coalesce(l.cliente_id, '')) = p_cliente_id::text
      and l.importe > 0
      and coalesce(l.fecha_hora, l.created_at)
          between now() - interval '30 days' and now()
      and not exists (
        select 1
        from public.crm_cliente_pagos p
        where p.source_rendimiento_id = l.id
      )
  )
  select coalesce(sum(amount), 0), count(*)
    into v_total, v_count
  from purchases;

  select rank_key
    into v_auto
  from public.tc_client_rank_benefits
  where min_spend <= v_total
  order by min_spend desc, sort_order desc
  limit 1;

  select jsonb_build_object(
           'id', o.id,
           'rank', o.assigned_rank,
           'intervention_type', o.intervention_type,
           'starts_at', o.starts_at,
           'ends_at', o.ends_at,
           'reason', o.reason,
           'notes', o.notes
         )
    into v_override
  from public.client_rank_overrides o
  join public.tc_client_rank_benefits r
    on r.rank_key = o.assigned_rank
  where o.client_id = p_cliente_id
    and o.active
    and o.starts_at <= now()
    and (o.ends_at is null or o.ends_at > now())
  order by o.created_at desc, o.id desc
  limit 1;

  select to_jsonb(r)
    into v_cfg
  from public.tc_client_rank_benefits r
  where r.rank_key = coalesce(v_override->>'rank', v_auto);

  select to_jsonb(r)
    into v_next
  from public.tc_client_rank_benefits r
  where r.min_spend > coalesce((v_cfg->>'min_spend')::numeric, 0)
  order by r.min_spend
  limit 1;

  return jsonb_build_object(
    'automatic', v_auto,
    'effective', coalesce(v_override->>'rank', v_auto),
    'override', v_override,
    'total', round(v_total, 2),
    'compras', v_count,
    'config', v_cfg,
    'next', v_next
  );
end
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
      created_by_user_id, created_by_role, source_rendimiento_id, created_at, pack_id, pack_name
    ) values (
      v_cliente_id, v_importe, 'EUR', nullif(p_payload->>'forma_pago',''),
      'completed', nullif(p_payload->>'note_text',''), v_reference,
      v_worker_id, nullif(p_payload->>'created_by_role',''),
      v_rendimiento.id, v_now, nullif(p_payload->>'verified_collection_pack_id',''), nullif(p_payload->>'verified_collection_pack_name','')
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
      'source',v_benefit_source,'promotion',v_benefits,
      'reward_policy_version',1,'pricing_mode',p_payload->>'pricing_mode',
      'purchase_classification',coalesce(p_payload->>'purchase_classification',case
        when coalesce((p_payload->>'super_promo_ruleta')::boolean,false) then 'super_promo_ruleta'
        when coalesce((p_payload->>'promo')::boolean,false) then 'promo'
        when coalesce((p_payload->>'recuperado')::boolean,false) then 'recuperado'
        when coalesce((p_payload->>'captado')::boolean,false) then 'captado' else 'nada' end),
      'package_level',p_payload->'package_level','rewards_eligible',p_payload->'rewards_eligible',
      'paypal_collection_order_id',p_payload->>'paypal_collection_order_id',
      'paypal_collection_source',p_payload->>'paypal_collection_source'
    ) where id=v_payment.id;
    perform public.tc_apply_purchase_benefits(v_payment.id);
    select * into v_payment from public.crm_cliente_pagos where id=v_payment.id;
    select coalesce(sum(coins),0),coalesce(sum(oracle_credits),0)::integer into v_points,v_oracle
      from public.tc_client_benefit_events where payment_id=v_payment.id;
    v_benefits:=v_benefits||jsonb_build_object('coins',v_points,'oracle_credits',v_oracle,
      'roulette_spins',(select count(*) from public.cliente_ruleta_giros where purchase_id=v_payment.id),
      'spins',(select coalesce(jsonb_agg(jsonb_build_object('level',nivel,'count',n) order by nivel),'[]'::jsonb)
        from (select nivel,count(*) n from public.cliente_ruleta_giros where purchase_id=v_payment.id group by nivel) s),
      'reward_policy',public.tc_purchase_reward_policy(v_payment.id));
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
$function$;

CREATE OR REPLACE FUNCTION public.tc_register_call_minutes(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  op uuid := (p_payload->>'operation_id')::uuid;
  client_uuid uuid := (p_payload->>'cliente_id')::uuid;
  worker_uuid uuid := (p_payload->>'telefonista_worker_id')::uuid;
  prior public.crm_call_operations%rowtype;
  request jsonb;
  payload jsonb := p_payload;
  result jsonb;
  buying boolean := coalesce((p_payload->>'cliente_compra_minutos')::boolean,false);
  use_pass boolean := coalesce((p_payload->>'usa_7_free')::boolean,false);
  saving boolean := coalesce((p_payload->>'guarda_minutos')::boolean,false);
  m1 numeric := coalesce((p_payload->>'minutos_1')::numeric,0);
  m2 numeric := coalesce((p_payload->>'minutos_2')::numeric,0);
  saved_free numeric := coalesce((p_payload->>'minutos_guardados_free')::numeric,0);
  saved_normal numeric := coalesce((p_payload->>'minutos_guardados_normales')::numeric,0);
  used_free numeric;
  used_normal numeric;
  df numeric;
  dn numeric;
  bf numeric;
  bn numeric;
  af numeric;
  an numeric;
  accounting jsonb;
  final_note text;
begin
  if op is null or client_uuid is null or worker_uuid is null then raise exception 'OPERATION_ID_INVALID'; end if;
  if m1 < 0 or m2 < 0 or saved_free < 0 or saved_normal < 0
    or m1::text in ('NaN','Infinity','-Infinity') or m2::text in ('NaN','Infinity','-Infinity')
    or saved_free::text in ('NaN','Infinity','-Infinity') or saved_normal::text in ('NaN','Infinity','-Infinity')
    or (m1 > 0 and coalesce(payload->>'codigo_1','') not in ('FREE','RUEDA','CLIENTE','REPITE','CALL'))
    or (m2 > 0 and coalesce(payload->>'codigo_2','') not in ('FREE','RUEDA','CLIENTE','REPITE','CALL')) then
    raise exception 'INVALID_CALL_MINUTES';
  end if;
  if not buying and not use_pass and payload->>'tipo_registro' is distinct from 'minutos' then raise exception 'INVALID_CALL_MINUTES'; end if;
  if m1+m2=0 and not use_pass and not (buying and saving and saved_free+saved_normal>0) then raise exception 'INVALID_CALL_MINUTES'; end if;
  used_free := case when use_pass and not buying then 7 else
    (case when payload->>'codigo_1'='FREE' then m1 else 0 end)+
    (case when payload->>'codigo_2'='FREE' then m2 else 0 end) end;
  used_normal := case when use_pass and not buying then 0 else m1+m2-used_free end;
  -- Restore original meaning: saved fields are the REMAINDER of the new purchase.
  -- For already credited minutes, subtract actual consumption instead.
  df := case when buying then case when saving then saved_free else 0 end else -used_free end;
  dn := case when buying then case when saving then saved_normal else 0 end else -used_normal end;
  payload := payload || jsonb_build_object('minute_accounting_version',3,'free_delta',df,'normal_delta',dn,'tiempo',used_free+used_normal);
  select jsonb_object_agg(key,value) into request from jsonb_each(payload)
    where key in ('minute_accounting_version','cliente_id','telefonista_worker_id','existing_payment_id','cliente_compra_minutos','tipo_registro',
      'usa_7_free','usa_minutos','misma_compra','guarda_minutos','minutos_guardados_free','minutos_guardados_normales',
      'codigo_1','minutos_1','codigo_2','minutos_2','tarotista_worker_id','tarotista_manual_call','tarotista_nombre',
      'billing_collaborator_id','source_tag_id','importe','forma_pago','promo','recuperado','super_promo_ruleta','captado','purchase_classification','pricing_mode','paypal_collection_order_id','paypal_collection_source','expected_paypal_environment');
  perform pg_advisory_xact_lock(hashtextextended(op::text,0));
  select * into prior from public.crm_call_operations where operation_id=op;
  if found then
    if prior.cliente_id<>client_uuid or prior.worker_id<>worker_uuid or prior.request<>request then
      raise exception 'PAYMENT_OPERATION_CONFLICT';
    end if;
    return prior.result || jsonb_build_object('duplicate_prevented',true);
  end if;
  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into bf,bn from public.crm_clientes where id=client_uuid for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
  -- Existing adapter validates completed payment ownership. v8 validates real balances.
  result := public.tc_register_call_with_payment(payload);
  if result#>>'{rendimiento,id}' is null or result->>'ok'='false' then raise exception 'CALL_REGISTER_FAILED'; end if;
  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into af,an from public.crm_clientes where id=client_uuid;
  if not buying and not coalesce((result->>'duplicate_prevented')::boolean,false)
    and (af<>bf+df or an<>bn+dn) then raise exception 'MINUTE_ACCOUNTING_MISMATCH'; end if;
  result := result || jsonb_build_object('balances',jsonb_build_object(
    'free_before',bf,'normal_before',bn,'free_after',af,'normal_after',an,
    'free_delta',af-bf,'normal_delta',an-bn,'total_after',af+an));
  accounting := jsonb_build_object('version',3,'free_before',bf,'normal_before',bn,
    'purchase_free',case when buying then used_free + case when saving then saved_free else 0 end else 0 end,
    'purchase_normal',case when buying then used_normal + case when saving then saved_normal else 0 end else 0 end,
    'saved_free',case when buying and saving then saved_free else 0 end,'saved_normal',case when buying and saving then saved_normal else 0 end,
    'used_free',used_free,'used_normal',used_normal,'bonus_free',af-bf-df,'bonus_normal',an-bn-dn,
    'free_after',af,'normal_after',an);
  final_note := case when buying then format('Compra registrada por %s vía %s. ',payload->>'importe',payload->>'forma_pago') else 'Llamada registrada. ' end
    || format('Saldo anterior: %s FREE + %s normales. Compra: %s FREE + %s normales. Consumo: %s FREE + %s normales. Bonos: %s FREE + %s normales. Saldo final: %s FREE + %s normales. Tarotista: %s.',
    bf,bn,accounting->>'purchase_free',accounting->>'purchase_normal',used_free,used_normal,af-bf-df,an-bn-dn,af,an,coalesce(payload->>'tarotista_nombre','sin indicar'));
  final_note := replace(final_note, format('Bonos: %s FREE + %s normales. ', af-bf-df, an-bn-dn), '');
  update public.crm_client_notes set texto=final_note,event_data=coalesce(event_data,'{}'::jsonb)||jsonb_build_object('minute_accounting',accounting,'free_after',af,'normal_after',an)
    where cliente_id=client_uuid::text and event_data->>'rendimiento_id'=result#>>'{rendimiento,id}';
  if buying then
    update public.crm_cliente_pagos set notas=final_note where id=(result#>>'{payment,id}')::uuid;
    update public.rendimiento_llamadas set minutos_guardados_free=case when saving then saved_free else 0 end,
      minutos_guardados_normales=case when saving then saved_normal else 0 end where id=(result#>>'{rendimiento,id}')::uuid;
  end if;
  result := result || jsonb_build_object('minute_accounting',accounting);
  insert into public.crm_call_operations(operation_id,cliente_id,worker_id,request,result)
    values(op,client_uuid,worker_uuid,request,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.capture_client_on_first_valid_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client_id uuid;
  v_worker_id uuid;
begin
  if pg_catalog.btrim(coalesce(new.cliente_id, ''))
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or pg_catalog.btrim(coalesce(new.telefonista_worker_id, ''))
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;

  if not (
    coalesce(new.tiempo, 0) > 0
    or coalesce(new.cliente_compra_minutos, false)
    or coalesce(new.usa_7_free, false)
    or coalesce(new.usa_minutos, false)
  ) then
    return new;
  end if;

  v_client_id := pg_catalog.btrim(new.cliente_id)::uuid;
  v_worker_id := pg_catalog.btrim(new.telefonista_worker_id)::uuid;

  perform public.register_client_capture_contact(
    v_client_id,
    v_worker_id,
    new.id,
    coalesce(new.usa_7_free, false),
    case when coalesce(new.captado, false) then 'captado' else 'nada' end,
    'celestial'
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_client_capture_contact(p_client_id uuid, p_worker_id uuid, p_call_id uuid, p_used_initial_free boolean, p_classification text, p_business text DEFAULT 'celestial'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.crm_client_capture_assignments%rowtype;
  v_first_call_id uuid;
  v_first_contact_at timestamptz;
  v_owner_worker_id uuid;
  v_payment_id uuid;
  v_first_purchase_at timestamptz;
  v_event_id uuid;
  v_confirmed_now boolean := false;
  v_candidate_changed boolean := false;
  v_previous_responsible uuid;
  v_lead record;
  v_reason text := 'contact_registered';
begin
  if p_client_id is null or p_worker_id is null then
    raise exception 'CAPTURE_ID_REQUIRED';
  end if;

  -- Serializa todos los reintentos de una misma clienta, incluso si llegan desde
  -- navegadores o centrales diferentes al mismo tiempo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('client_capture:' || p_client_id::text, 0)
  );

  -- La propietaria es la central de la primera gestión válida registrada. FREE
  -- no es un requisito: también cuentan el uso de minutos y la compra atendida.
  select r.id, r.fecha_hora, w.id
    into v_first_call_id, v_first_contact_at, v_owner_worker_id
  from public.rendimiento_llamadas r
  join public.workers w
    on w.id::text = pg_catalog.btrim(coalesce(r.telefonista_worker_id, ''))
  where pg_catalog.btrim(coalesce(r.cliente_id, '')) = p_client_id::text
    and w.role = 'central'
    and (
      coalesce(r.tiempo, 0) > 0
      or coalesce(r.cliente_compra_minutos, false)
      or coalesce(r.usa_7_free, false)
      or coalesce(r.usa_minutos, false)
    )
  order by r.fecha_hora asc, r.created_at asc, r.id asc
  limit 1;

  insert into public.crm_client_capture_assignments (
    client_id,
    business,
    created_by_worker_id,
    candidate_worker_id,
    responsible_worker_id,
    first_contact_id,
    first_contact_at,
    status
  ) values (
    p_client_id,
    coalesce(nullif(pg_catalog.btrim(p_business), ''), 'celestial'),
    coalesce(v_owner_worker_id, p_worker_id),
    v_owner_worker_id,
    coalesce(v_owner_worker_id, p_worker_id),
    v_first_call_id,
    v_first_contact_at,
    'pending'
  )
  on conflict (client_id) do nothing;

  select * into v_row
  from public.crm_client_capture_assignments
  where client_id = p_client_id
  for update;

  v_previous_responsible := v_row.responsible_worker_id;

  if v_row.captured_by_worker_id is null
     and v_owner_worker_id is not null
     and (
       v_row.candidate_worker_id is distinct from v_owner_worker_id
       or v_row.first_contact_id is distinct from v_first_call_id
       or v_row.first_contact_at is distinct from v_first_contact_at
     ) then
    update public.crm_client_capture_assignments
       set candidate_worker_id = v_owner_worker_id,
           responsible_worker_id = v_owner_worker_id,
           first_contact_id = v_first_call_id,
           first_contact_at = v_first_contact_at,
           updated_at = pg_catalog.now()
     where client_id = p_client_id;
    v_candidate_changed := true;

    insert into public.crm_client_capture_audit (
      client_id, action, previous_responsible_worker_id,
      new_responsible_worker_id, actor_worker_id, reason, metadata
    ) values (
      p_client_id, 'first_valid_contact', v_previous_responsible,
      v_owner_worker_id, p_worker_id, 'earliest_valid_central_management',
      pg_catalog.jsonb_build_object(
        'first_call_id', v_first_call_id,
        'first_contact_at', v_first_contact_at,
        'actor_call_id', p_call_id,
        'used_initial_free', coalesce(p_used_initial_free, false)
      )
    );
  end if;

  select * into v_row
  from public.crm_client_capture_assignments
  where client_id = p_client_id
  for update;

  if pg_catalog.lower(pg_catalog.btrim(coalesce(p_classification, ''))) = 'captado' then
    select p.id, coalesce(p.created_at, pg_catalog.now())
      into v_payment_id, v_first_purchase_at
    from public.crm_cliente_pagos p
    where p.cliente_id = p_client_id
      and pg_catalog.lower(pg_catalog.btrim(coalesce(p.estado, ''))) = 'completed'
      and coalesce(p.importe, 0) > 0
    order by coalesce(p.created_at, pg_catalog.now()) asc, p.id asc
    limit 1;

    if v_payment_id is null then
      v_reason := 'first_purchase_required';
    elsif coalesce(v_row.captured_by_worker_id, v_row.candidate_worker_id) is null then
      v_reason := 'first_valid_contact_required';
    else
      v_owner_worker_id := coalesce(v_row.captured_by_worker_id, v_row.candidate_worker_id);
      v_confirmed_now := v_row.status is distinct from 'confirmed'
        or v_row.captured_by_worker_id is null;

      update public.crm_client_capture_assignments
         set captured_by_worker_id = v_owner_worker_id,
             responsible_worker_id = v_owner_worker_id,
             captured_at = coalesce(captured_at, v_first_purchase_at),
             status = 'confirmed',
             updated_at = pg_catalog.now()
       where client_id = p_client_id;

      -- Clave canónica e idempotente por clienta. El importe lo obtiene la
      -- función existente desde Admin > Sistema XP > Configuración XP.
      select e.id into v_event_id
      from public.worker_xp_events e
      where e.action_key = 'client_capture'
        and e.reference_id = 'crm_client:' || p_client_id::text
        and e.status = 'applied'
      order by e.created_at asc
      limit 1;

      if v_event_id is null then
        v_event_id := public.award_worker_xp(
          p_worker_id := v_owner_worker_id,
          p_action_key := 'client_capture',
          p_reference_id := 'crm_client:' || p_client_id::text,
          p_reference_label := 'Cliente captada',
          p_origin := 'crm_first_valid_contact_first_purchase',
          p_metadata := pg_catalog.jsonb_build_object(
            'client_id', p_client_id,
            'first_call_id', v_first_call_id,
            'first_contact_at', v_first_contact_at,
            'first_payment_id', v_payment_id,
            'first_purchase_at', v_first_purchase_at,
            'capture_actor_worker_id', p_worker_id,
            'business', coalesce(nullif(pg_catalog.btrim(p_business), ''), v_row.business)
          )
        );
      end if;

      select e.id into v_event_id
      from public.worker_xp_events e
      where e.action_key = 'client_capture'
        and e.reference_id = 'crm_client:' || p_client_id::text
        and e.status = 'applied'
      order by e.created_at asc
      limit 1;

      update public.crm_client_capture_assignments
         set xp_event_id = v_event_id
       where client_id = p_client_id;

      update public.crm_clientes
         set captured_by_worker_id = v_owner_worker_id,
             captured_at = v_first_purchase_at,
             capture_origin = 'first_valid_contact_first_purchase',
             capture_business = coalesce(nullif(pg_catalog.btrim(p_business), ''), capture_business, 'celestial'),
             lead_status = 'captado',
             updated_at = pg_catalog.now()
       where id = p_client_id;

      for v_lead in
        select l.id, l.estado
        from public.captacion_leads l
        where l.cliente_id = p_client_id
          and l.estado not in ('captado', 'cliente')
        for update
      loop
        update public.captacion_leads
           set estado = 'captado',
               contacted_at = coalesce(contacted_at, v_first_purchase_at),
               last_contact_at = pg_catalog.now(),
               last_result = 'captacion_confirmada',
               next_contact_at = pg_catalog.now(),
               closed_at = pg_catalog.now(),
               updated_at = pg_catalog.now()
         where id = v_lead.id;

        insert into public.captacion_state_events (
          lead_id, cliente_id, actor_worker_id, previous_state,
          next_state, action, source, metadata
        ) values (
          v_lead.id, p_client_id, p_worker_id, v_lead.estado,
          'captado', 'captacion_confirmada', 'capture_assignment',
          pg_catalog.jsonb_build_object(
            'captured_by_worker_id', v_owner_worker_id,
            'first_payment_id', v_payment_id,
            'xp_event_id', v_event_id
          )
        );
      end loop;

      if v_confirmed_now then
        insert into public.crm_client_capture_audit (
          client_id, action, previous_responsible_worker_id,
          new_responsible_worker_id, actor_worker_id, reason, metadata
        ) values (
          p_client_id, 'capture_confirmed', v_previous_responsible,
          v_owner_worker_id, p_worker_id, 'first_purchase_and_captured_classification',
          pg_catalog.jsonb_build_object(
            'first_call_id', v_first_call_id,
            'first_payment_id', v_payment_id,
            'xp_event_id', v_event_id
          )
        );
      end if;

      v_reason := case when v_confirmed_now then 'confirmed' else 'already_confirmed' end;
    end if;
  end if;

  select * into v_row
  from public.crm_client_capture_assignments
  where client_id = p_client_id;

  return pg_catalog.jsonb_build_object(
    'confirmed_now', v_confirmed_now,
    'reason', v_reason,
    'status', v_row.status,
    'captured_by_worker_id', v_row.captured_by_worker_id,
    'responsible_worker_id', v_row.responsible_worker_id,
    'candidate_worker_id', v_row.candidate_worker_id,
    'first_contact_id', v_row.first_contact_id,
    'first_contact_at', v_row.first_contact_at,
    'xp_event_id', v_row.xp_event_id,
    'candidate_rebuilt', v_candidate_changed
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tc_diamond_new_tarotista_gift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare announced uuid; cid uuid; s jsonb; ev uuid;
begin
  if new.role is distinct from 'tarotista' or new.is_active is false then return new; end if;
  insert into public.tc_diamond_tarotista_announcements(worker_id)
  values(new.id) on conflict(worker_id) do nothing returning worker_id into announced;
  if announced is null then return new; end if;

  for cid in select id from public.crm_clientes order by id loop
    perform 1 from public.crm_clientes where id=cid for update;
    s:=public.tc_client_rank_state(cid);
    if coalesce(s->>'effective','')<>'diamante' then continue; end if;
    ev:=null;
    insert into public.tc_client_benefit_events(
      cliente_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,snapshot)
    values(cid,'diamante','diamond_new_tarotista','minutes',15,
      'diamond-new-tarotista:'||new.id::text||':'||cid::text,
      jsonb_build_object('worker_id',new.id,'free_minutes',15,'rank_state',s))
    on conflict(delivery_key) where delivery_key is not null do nothing returning id into ev;
    if ev is null then continue; end if;
    update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+15,
      updated_at=clock_timestamp() where id=cid;
    insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
    values(cid,'gift','Una nueva tarotista, 15 minutos de regalo',
      'Por tu rango Diamante, tienes 15 minutos FREE de regalo por la incorporación de una nueva tarotista.',
      jsonb_build_object('worker_id',new.id,'benefit_event_id',ev,'free_minutes',15),false,now());
    perform public.tc_touch_roulette_signal(cid);
  end loop;
  return new;
end $function$;
