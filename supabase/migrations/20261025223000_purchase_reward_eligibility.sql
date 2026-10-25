-- Future purchases only. Preserve existing credited benefits and business XP.
-- Read-only source snapshot: production 2026-10-25; verified before replacement.
BEGIN;

CREATE OR REPLACE FUNCTION public.tc_purchase_reward_policy(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare p public.crm_cliente_pagos%rowtype; c jsonb; mode text := 'regular'; is_promo boolean:=false; is_special boolean:=false;
begin
 select * into p from public.crm_cliente_pagos where id=p_payment_id;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 c:=coalesce(p.benefits_context,'{}'::jsonb);
 if p.source_rendimiento_id is not null then
   select coalesce(promo,false),coalesce(super_promo_ruleta,false) into is_promo,is_special
    from public.rendimiento_llamadas where id=p.source_rendimiento_id;
 end if;
 -- Source evidence takes precedence over an advertised eligibility flag.
 if p.pack_id='crm_manual_amount' or p.metodo='paypal_crm_manual'
    or c->>'pricing_mode'='manual_amount'
    or exists(select 1 from public.crm_paypal_orders o where o.cliente_id=p.cliente_id
      and o.checkout_kind='crm_collection' and o.status='completed' and o.pack_id='crm_manual_amount'
      and (o.payment_id=p.id or o.id::text=c->>'paypal_collection_order_id')) then mode:='manual_amount';
 elsif p.pack_id like 'promo:%' or coalesce(is_promo,false)
    or c->>'pricing_mode'='promotion' or c->>'purchase_classification'='promo' then mode:='promotion';
 elsif coalesce(is_special,false) or c->>'purchase_classification'='super_promo_ruleta'
    or c->>'pricing_mode'='super_promo' or coalesce((c->>'special_spins')::integer,0)>0 then mode:='super_promo';
 end if;
 return jsonb_build_object('version',1,'pricing_mode',mode,'coins_eligible',mode='regular',
   'roulette_eligible',mode in ('regular','super_promo'),'reason',case mode
    when 'manual_amount' then 'Importe manual: sin Coins ni ruletas.'
    when 'promotion' then 'Tarifa promocional: sin Coins ni ruletas.'
    when 'super_promo' then 'Super Promo Ruleta: conserva su giro especial.'
    else 'Tarifa regular: beneficios según nivel y rango.' end);
end $function$;

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
    'purchase_classification',p->>'purchase_classification','package_level',p->'package_level',
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

CREATE OR REPLACE FUNCTION public.tc_register_call_with_payment(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  payment_uuid uuid := nullif(p_payload->>'existing_payment_id','')::uuid;
  client_uuid uuid := (p_payload->>'cliente_id')::uuid;
  operation_uuid uuid := (p_payload->>'operation_id')::uuid;
  worker_uuid uuid := (p_payload->>'telefonista_worker_id')::uuid;
  paid public.crm_cliente_pagos%rowtype;
  prior public.crm_payment_call_links%rowtype;
  payload jsonb := p_payload;
  result jsonb;
  call_uuid uuid;
  payment_count bigint;
  collection_uuid uuid:=nullif(p_payload->>'paypal_collection_order_id','')::uuid;
  collection_source text:=nullif(p_payload->>'paypal_collection_source','');
  collection public.crm_paypal_orders%rowtype;
begin
  -- Serializes call registrations for this client; the existing v8 still checks balances.
  perform 1 from public.crm_clientes where id = client_uuid for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;

  if collection_uuid is not null or collection_source is not null then
    if payment_uuid is not null or not coalesce((payload->>'cliente_compra_minutos')::boolean,false)
      or payload->>'forma_pago' is distinct from 'paypal_manual'
      or collection_source is null or collection_source not in ('crm_collection','external')
      or (collection_source='external' and collection_uuid is not null)
      or (collection_source='crm_collection' and collection_uuid is null) then raise exception 'PAYPAL_COLLECTION_INVALID'; end if;
  end if;
  if payment_uuid is null then
    if coalesce((payload->>'cliente_compra_minutos')::boolean,false) and payload->>'forma_pago'='paypal_manual' then
      if collection_source='external' then
        payload:=payload||jsonb_build_object('separate_payment_confirmed',true);
      end if;
      if collection_uuid is not null then
        select * into collection from public.crm_paypal_orders where id=collection_uuid for update;
        if not found or collection.cliente_id is distinct from client_uuid or collection.checkout_kind is distinct from 'crm_collection'
          or collection.status is distinct from 'completed' or nullif(collection.capture_id,'') is null
          or coalesce(payload->>'expected_paypal_environment','') not in ('live','sandbox')
          or collection.environment is distinct from payload->>'expected_paypal_environment'
          or collection.amount is distinct from (payload->>'importe')::numeric or collection.currency is distinct from 'EUR' then raise exception 'PAYPAL_COLLECTION_INVALID'; end if;
        if collection.payment_id is not null and not exists(select 1 from public.crm_cliente_pagos p where p.id=collection.payment_id
          and p.cliente_id=client_uuid and p.referencia_externa='registrar_llamada:'||operation_uuid::text) then raise exception 'PAYPAL_COLLECTION_ALREADY_REGISTERED'; end if;
        payload:=payload||jsonb_build_object('paypal_collection_source','crm_collection',
          'verified_collection_pack_id',collection.pack_id,'verified_collection_pack_name',collection.pack_name,
          'pricing_mode',case when collection.pack_id='crm_manual_amount' then 'manual_amount'
            when collection.pack_id like 'promo:%' then 'promotion' else coalesce(payload->>'pricing_mode','regular') end,
          'separate_payment_confirmed',true);
        if collection.purchase_payload ? 'oracle_credits' then
          if coalesce(collection.purchase_payload->>'oracle_credits','') !~ '^[0-9]+$' then raise exception 'PAYPAL_COLLECTION_INVALID'; end if;
          payload:=payload||jsonb_build_object('purchase_benefits',coalesce(payload->'purchase_benefits','{}'::jsonb)||
            jsonb_build_object('oracle_credits',(collection.purchase_payload->>'oracle_credits')::integer));
        end if;
        result:=public.crm_register_call_atomic_v8(payload);
        payment_uuid:=nullif(result#>>'{payment,id}','')::uuid;
        if payment_uuid is null or result->>'ok'='false' then raise exception 'CALL_REGISTER_FAILED'; end if;
        update public.crm_paypal_orders set payment_id=payment_uuid where id=collection_uuid;
        return result||jsonb_build_object('paypal_collection_order_id',collection_uuid,'collection_linked',true);
      elsif collection_source is distinct from 'external' and exists(select 1 from public.crm_paypal_orders o
        where o.cliente_id=client_uuid and o.checkout_kind='crm_collection' and o.status='completed'
          and (payload->>'expected_paypal_environment' is null or o.environment=payload->>'expected_paypal_environment')
          and o.capture_id is not null and o.payment_id is null and o.amount=(payload->>'importe')::numeric and o.currency='EUR') then
        raise exception 'PAYPAL_COLLECTION_SELECTION_REQUIRED';
      end if;
    end if;
    if coalesce((payload->>'cliente_compra_minutos')::boolean,false)
      and payload->>'forma_pago' = 'paypal_manual'
      and not coalesce((payload->>'separate_payment_confirmed')::boolean,false)
      and exists (
        select 1 from public.crm_cliente_pagos p
        join public.crm_paypal_orders o on o.payment_id = p.id
        where p.cliente_id = client_uuid and p.estado = 'completed'
          and o.status = 'completed' and (payload->>'expected_paypal_environment' is null or o.environment=payload->>'expected_paypal_environment') and p.source_rendimiento_id is null
          and p.importe = (payload->>'importe')::numeric
      ) then raise exception 'PAYPAL_PAYMENT_ALREADY_CONFIRMED';
    end if;
    return public.crm_register_call_atomic_v8(payload);
  end if;

  select * into prior from public.crm_payment_call_links where operation_id = operation_uuid;
  if found then
    if prior.payment_id <> payment_uuid or prior.cliente_id <> client_uuid or prior.worker_id <> worker_uuid then
      raise exception 'PAYMENT_OPERATION_CONFLICT';
    end if;
    return prior.result || jsonb_build_object('duplicate_prevented',true);
  end if;

  select * into paid from public.crm_cliente_pagos where id = payment_uuid for update;
  if not found or paid.cliente_id <> client_uuid or paid.estado <> 'completed' then
    raise exception 'EXISTING_PAYMENT_INVALID';
  end if;
  if not exists (select 1 from public.crm_paypal_orders o where o.payment_id = payment_uuid
      and o.cliente_id = client_uuid and o.status = 'completed' and o.capture_id is not null) then
    raise exception 'EXISTING_PAYMENT_INVALID';
  end if;
  if paid.source_rendimiento_id is not null or exists (
    select 1 from public.crm_payment_call_links where payment_id = payment_uuid
  ) then raise exception 'PAYMENT_ALREADY_LINKED'; end if;
  if coalesce((payload->>'cliente_compra_minutos')::boolean,false)
    or payload->>'tipo_registro' is distinct from 'minutos'
    or coalesce((payload->>'tiempo')::numeric,0) <= 0
    or coalesce((payload->>'free_delta')::numeric,0) > 0
    or coalesce((payload->>'normal_delta')::numeric,0) > 0
    or coalesce((payload->>'tiempo')::numeric,0) <>
      -coalesce((payload->>'free_delta')::numeric,0)-coalesce((payload->>'normal_delta')::numeric,0) then
    raise exception 'EXISTING_PAYMENT_CALL_ONLY';
  end if;

  -- Consume already credited minutes. Never re-run the purchase/rewards branch.
  payload := payload || jsonb_build_object(
    'cliente_compra_minutos',false,'importe',0,'forma_pago',null,
    'misma_compra',false,'guarda_minutos',false,'minutos_guardados_free',0,
    'minutos_guardados_normales',0,'points_to_add',0,'purchase_benefits',null,
    'note_text',coalesce(payload->>'note_text','') || ' Pago PayPal ya registrado: ' || payment_uuid::text || '. Sin nueva compra.'
  );
  select count(*) into payment_count from public.crm_cliente_pagos where cliente_id = client_uuid;
  result := public.crm_register_call_atomic_v8(payload);
  if result->>'ok' = 'false' then raise exception 'CALL_REGISTER_FAILED'; end if;
  call_uuid := nullif(result#>>'{rendimiento,id}','')::uuid;
  if call_uuid is null or (result->'payment' is not null and result->'payment' <> 'null'::jsonb)
    or payment_count <> (select count(*) from public.crm_cliente_pagos where cliente_id = client_uuid) then
    raise exception 'EXISTING_PAYMENT_CONTRACT_MISMATCH';
  end if;
  -- A replay from v8 must not attach a second payment to the same call.
  if exists (select 1 from public.crm_cliente_pagos where source_rendimiento_id = call_uuid) then
    raise exception 'PAYMENT_OPERATION_CONFLICT';
  end if;
  update public.crm_cliente_pagos set source_rendimiento_id = call_uuid where id = payment_uuid;
  result := result || jsonb_build_object('existing_payment_id',payment_uuid,'payment',null,'payment_linked',true);
  insert into public.crm_payment_call_links(payment_id,operation_id,cliente_id,worker_id,rendimiento_id,result)
    values(payment_uuid,operation_uuid,client_uuid,worker_uuid,call_uuid,result);
  return result;
end $function$;

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

CREATE OR REPLACE FUNCTION public.tc_apply_rank_package_benefits(p_payment_id uuid)
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
  v_resolution := public.tc_resolve_rank_package_benefit(
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

CREATE OR REPLACE FUNCTION public.tc_apply_purchase_benefits(p_payment_id uuid)
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
    v_matrix_result:=public.tc_apply_rank_package_benefits(p.id);
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

CREATE OR REPLACE FUNCTION public.tc_register_call_minutes_v2(p_payload jsonb)
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
  -- v2: entered purchase minutes are BEFORE current usage. Existing balances are preserved.
  -- For already credited minutes, subtract actual consumption instead.
  df := case when buying then case when saving then saved_free-used_free else 0 end else -used_free end;
  dn := case when buying then case when saving then saved_normal-used_normal else 0 end else -used_normal end;
  if buying and saving and (used_free>saved_free or used_normal>saved_normal) then raise exception 'PURCHASE_MINUTES_EXCEEDED'; end if;
  payload := payload || jsonb_build_object('minute_accounting_version',2,'free_delta',df,'normal_delta',dn,'tiempo',used_free+used_normal);
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
  accounting := jsonb_build_object('version',2,'free_before',bf,'normal_before',bn,
    'purchase_free',case when buying then case when saving then saved_free else used_free end else 0 end,
    'purchase_normal',case when buying then case when saving then saved_normal else used_normal end else 0 end,
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
    update public.rendimiento_llamadas set minutos_guardados_free=case when saving then saved_free-used_free else 0 end,
      minutos_guardados_normales=case when saving then saved_normal-used_normal else 0 end where id=(result#>>'{rendimiento,id}')::uuid;
  end if;
  result := result || jsonb_build_object('minute_accounting',accounting);
  insert into public.crm_call_operations(operation_id,cliente_id,worker_id,request,result)
    values(op,client_uuid,worker_uuid,request,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.tc_register_call_recovery(p_user uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor workers; op uuid; client_uuid uuid; at_time timestamptz:=tc_recovery_mission_now();
 request_payload jsonb; previous crm_recovery_mission_requests; recovery crm_client_recovery;
 result jsonb; receipt jsonb; payment_uuid uuid; event jsonb; converted boolean; daily_counted boolean;
 client_name text; eligible_before boolean; confirmed_payment crm_cliente_pagos;
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false
  order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null or nullif(p_payload->>'telefonista_worker_id','')::uuid is distinct from actor.id then raise exception 'FORBIDDEN'; end if;
 op:=nullif(p_payload->>'operation_id','')::uuid; client_uuid:=nullif(p_payload->>'cliente_id','')::uuid;
 if op is null or client_uuid is null then raise exception 'OPERATION_ID_INVALID'; end if;
 if not coalesce((p_payload->>'recuperado')::boolean,false) then raise exception 'INVALID_RECOVERY_CLASSIFICATION'; end if;
 if not coalesce((p_payload->>'cliente_compra_minutos')::boolean,false) or coalesce((p_payload->>'importe')::numeric,0)<=0 then raise exception 'PAYMENT_REQUIRED'; end if;
 -- Match registration's business inputs. Server-derived balances, benefits and
 -- notes can legitimately differ after a successful response was lost.
 select jsonb_object_agg(key,value) into request_payload from jsonb_each(p_payload)
 where key in ('cliente_id','telefonista_worker_id','existing_payment_id','cliente_compra_minutos','tipo_registro',
  'usa_7_free','usa_minutos','misma_compra','guarda_minutos','minutos_guardados_free','minutos_guardados_normales',
  'codigo_1','minutos_1','codigo_2','minutos_2','tarotista_worker_id','tarotista_manual_call','tarotista_nombre',
  'billing_collaborator_id','source_tag_id','importe','forma_pago','promo','recuperado','super_promo_ruleta','captado','purchase_classification','pricing_mode','paypal_collection_order_id','paypal_collection_source','expected_paypal_environment');
 request_payload:=jsonb_build_object('kind','register_recovery','worker',actor.id,'client',client_uuid,'payload',request_payload);
 -- Same first lock as tc_register_call_minutes; then the shared request lock,
 -- client/recovery rows, and finally the daily award lock inside the trigger.
 perform pg_advisory_xact_lock(hashtextextended(op::text,0));
 perform pg_advisory_xact_lock(hashtextextended('recovery-request:'||op,0));
 select * into previous from crm_recovery_mission_requests where request_id=op;
 if found then
  if previous.payload<>request_payload then raise exception 'OPERATION_CONFLICT'; end if;
  receipt:=previous.result->'recovery';
  receipt:=receipt||jsonb_build_object('xp',0,'xp_event',null,'counted',false,'duplicate_prevented',true,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
  return previous.result||jsonb_build_object('duplicate_prevented',true,'recovery',receipt);
 end if;
 perform 1 from crm_clientes where id=client_uuid for update;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 select * into recovery from crm_client_recovery where client_id=client_uuid for update;
 if recovery.client_id is null or recovery.contacted_at is null or recovery.responsible_id is null then raise exception 'CONTACT_FIRST'; end if;
 converted:=recovery.status<>'recovered';
 if converted then
  select nombre,eligible into client_name,eligible_before from tc_recovery_candidates where id=client_uuid;
  if eligible_before is distinct from true then raise exception 'NOT_ELIGIBLE'; end if;
 end if;
 result:=tc_register_call_minutes(p_payload);
 if result#>>'{rendimiento,id}' is null or result->>'ok'='false' then raise exception 'CALL_REGISTER_FAILED'; end if;
 payment_uuid:=nullif(result#>>'{payment,id}','')::uuid;
 if payment_uuid is null then raise exception 'PAYMENT_REQUIRED'; end if;
 -- Even an already recovered client must have a real, matching purchase for
 -- this new classification; a previous purchase is never silently selected.
 select * into confirmed_payment from crm_cliente_pagos where id=payment_uuid and cliente_id=client_uuid and estado='completed' and importe>0 and created_at>=recovery.contacted_at and created_at<=now() for update;
 if not found then raise exception 'PAYMENT_REQUIRED'; end if;
 if converted then
  -- Registration can add a current/source tag. Eligibility was checked while
  -- the client/recovery rows were locked BEFORE that legitimate purchase.
  -- Preserve the original payment, attribution, unique reference and history
  -- semantics without weakening tc_recovery_act for unrelated callers.
  insert into worker_xp_events as e(worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_by_worker_id)
  values(recovery.responsible_id,'client_recovery',75,'client_recovery:'||client_uuid,'Cliente recuperado: '||client_name,'client_recovery','applied',
   jsonb_build_object('client_id',client_uuid,'payment_id',payment_uuid,'confirmed_by',actor.id,'rendimiento_id',result#>>'{rendimiento,id}','eligibility_validated_at',at_time),actor.id)
  returning to_jsonb(e) into event;
  update crm_client_recovery set status='recovered',updated_at=now(),version=version+1,recovered_at=now(),payment_id=payment_uuid,purchase_amount=confirmed_payment.importe,xp=75 where client_id=client_uuid;
  insert into crm_client_recovery_history(client_id,actor_id,status,note) values(client_uuid,actor.id,'recovered','Compra confirmada al registrar llamada');
 end if;
 daily_counted:=converted and exists(select 1 from crm_recovery_daily_results where client_id=client_uuid and worker_id=recovery.responsible_id and mission_day=(at_time at time zone 'America/Guayaquil')::date);
 receipt:=jsonb_build_object('status','recovered','worker_id',recovery.responsible_id,'xp',case when converted then 75 else 0 end,
  'xp_event',event,'counted',daily_counted,'duplicate_prevented',not converted,'payment_id',payment_uuid,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
 result:=result||jsonb_build_object('recovery',receipt);
 insert into crm_recovery_mission_requests(request_id,worker_id,client_id,payload,result) values(op,actor.id,client_uuid,request_payload,result);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.tc_complete_paypal_client(p_id uuid, p_order_id text, p_capture_id text, p_amount numeric, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.crm_paypal_orders;
  payment public.crm_cliente_pagos;
  result jsonb;
  payload jsonb;
  normal_minutes integer;
  free_minutes integer;
  total_minutes integer;
  credited_coins integer;
  credited_oracle integer;
  extra_free integer;
  spin_summary jsonb;
  spin_text text;
  note_text text;
  summary jsonb;
  free_before numeric;
  normal_before numeric;
  free_after numeric;
  normal_after numeric;
begin
  select * into a from public.crm_paypal_orders where id=p_id for update;
  if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
  if a.checkout_kind is distinct from 'client_purchase' or a.purchaser_auth_user_id is null or a.worker_id is not null then
    raise exception 'PAYPAL_CHECKOUT_KIND_MISMATCH';
  end if;
  if a.order_id is null or p_order_id is distinct from a.order_id
    or p_amount is distinct from a.amount or p_currency is distinct from a.currency
    or a.currency<>'EUR' or nullif(btrim(coalesce(p_capture_id,'')),'') is null then
    raise exception 'PAYPAL_CAPTURE_MISMATCH';
  end if;
  if a.status='completed' then
    if a.capture_id is distinct from p_capture_id or a.payment_id is null then raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
    return jsonb_build_object('ok',true,'duplicated',true,'payment_id',a.payment_id);
  end if;

  -- Reject malformed snapshots before invoking the canonical crediting engine.
  -- Do not look up today's price or split: the charged checkout owns its terms.
  if jsonb_typeof(a.purchase_payload)<>'object'
    or a.purchase_payload->>'pack_id' is distinct from a.pack_id
    or a.purchase_payload->>'pack_name' is distinct from a.pack_name
    or coalesce(a.purchase_payload->>'normal','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'free','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'total_minutes','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'points','') !~ '^[0-9]+$'
    or coalesce(a.purchase_payload->>'oracle_credits','') !~ '^[0-9]+$'
    or (coalesce(a.purchase_payload->>'roulette_level','') !~ '^[1-3]$'
      and not (a.pack_id like 'promo:%' and coalesce(a.purchase_payload->>'roulette_level','')='' and a.purchase_payload->>'roulette_spins'='0'))
    or coalesce(a.purchase_payload->>'roulette_spins','') !~ '^[0-9]+$' then
    raise exception 'PAYPAL_PURCHASE_SNAPSHOT_INVALID';
  end if;
  normal_minutes := (a.purchase_payload->>'normal')::integer;
  free_minutes := (a.purchase_payload->>'free')::integer;
  total_minutes := (a.purchase_payload->>'total_minutes')::integer;
  if total_minutes<=0 or normal_minutes+free_minutes<>total_minutes then
    raise exception 'PAYPAL_PURCHASE_SNAPSHOT_INVALID';
  end if;

  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into free_before,normal_before from public.crm_clientes where id=a.cliente_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;

  payload := a.purchase_payload || jsonb_build_object(
    'cliente_id',a.cliente_id,'amount',a.amount,'currency',a.currency,
    'payment_ref','paypal-client:'||a.order_id,'metodo','paypal_cliente',
    'created_by_user_id',a.purchaser_auth_user_id,'created_by_role','cliente',
    'notas',format('Compra web · panel cliente · PayPal · %s.',a.pack_name)
  );
  result := public.cliente_confirmar_compra_ruleta_v3(payload);
  if result is null or result->>'ok'='false' or nullif(result->'payment'->>'id','') is null then
    raise exception 'PURCHASE_NOT_CONFIRMED';
  end if;
  select * into payment from public.crm_cliente_pagos where id=(result->'payment'->>'id')::uuid;
  if not found or payment.cliente_id is distinct from a.cliente_id
    or payment.estado is distinct from 'completed' or payment.importe is distinct from a.amount
    or payment.moneda is distinct from a.currency or payment.pack_id is distinct from a.pack_id
    or payment.paid_minutes is distinct from normal_minutes::numeric
    or payment.bonus_minutes is distinct from free_minutes::numeric then
    raise exception 'PURCHASE_MISMATCH';
  end if;
  if (payment.paypal_order_id is not null and payment.paypal_order_id<>a.order_id)
    or (payment.paypal_capture_id is not null and payment.paypal_capture_id<>p_capture_id) then
    raise exception 'PAYPAL_CAPTURE_MISMATCH';
  end if;

  -- Read actual delivered events, including rank benefits, not advertised totals.
  select coalesce(sum(coins),0)::integer,coalesce(sum(oracle_credits),0)::integer,
    coalesce(sum(case when benefit_key='diamond_purchase_minutes' then minutes else 0 end),0)::integer
    into credited_coins,credited_oracle,extra_free
    from public.tc_client_benefit_events where payment_id=payment.id;
  select coalesce(jsonb_agg(jsonb_build_object('level',nivel,'count',n) order by nivel),'[]'::jsonb),
    coalesce(string_agg(format('%s giro(s) %s',n,case when nivel=4 then 'Especial' else 'Nivel '||nivel::text end),', ' order by nivel),'ninguno')
    into spin_summary,spin_text
    from (select nivel,count(*)::integer n from public.cliente_ruleta_giros where purchase_id=payment.id group by nivel) s;
  summary := jsonb_build_object(
    'normal',normal_minutes,'free',free_minutes,'rank_free_minutes',extra_free,
    'total_minutes',normal_minutes+free_minutes+extra_free,
    'coins',credited_coins,'oracle_credits',credited_oracle,'spins',spin_summary
  );
  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into free_after,normal_after from public.crm_clientes where id=a.cliente_id;
  summary := summary || jsonb_build_object('balances',jsonb_build_object(
    'free_before',free_before,'normal_before',normal_before,'free_after',free_after,'normal_after',normal_after));
  note_text := format('Compra web confirmada · panel cliente · PayPal. %s por %s %s. Minutos añadidos: %s normales + %s FREE. Extra FREE por rango: %s. Beneficios acreditados: %s Coins; %s tirada(s) de Oráculo; ruleta: %s. Referencia PayPal: %s.',
    a.pack_name,a.amount,a.currency,normal_minutes,free_minutes,extra_free,credited_coins,credited_oracle,spin_text,a.order_id);
  note_text := note_text || format(' Saldo anterior: %s normales + %s FREE. Saldo final: %s normales + %s FREE.',normal_before,free_before,normal_after,free_after);
  update public.crm_cliente_pagos set paypal_order_id=a.order_id,paypal_capture_id=p_capture_id,notas=note_text where id=payment.id;
  insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,event_type,event_data,is_pinned)
    values(a.cliente_id::text,note_text,a.purchaser_auth_user_id,'Sistema · Compra web','client_paypal_purchase',
      jsonb_build_object('payment_id',payment.id,'paypal_attempt_id',a.id,'paypal_order_id',a.order_id,
        'paypal_capture_id',p_capture_id,'amount',a.amount,'currency',a.currency,'pack_id',a.pack_id,
        'source','cliente_panel','credited',summary),false);
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
    values(a.cliente_id,'purchase_completed','Pago confirmado',
      format('Tu compra %s ya está activa. Hemos añadido %s minutos, %s Coins y %s tirada(s) de Oráculo. Ruleta: %s.',
        a.pack_name,total_minutes+extra_free,credited_coins,credited_oracle,spin_text),
      jsonb_build_object('payment_id',payment.id,'pack_id',a.pack_id,'pack_name',a.pack_name,
        'total_minutes',total_minutes+extra_free,'coins',credited_coins,'oracle_credits',credited_oracle,
        'roulette_level',(a.purchase_payload->>'roulette_level')::integer,
        'roulette_spins',(select count(*) from public.cliente_ruleta_giros where purchase_id=payment.id and nivel=(a.purchase_payload->>'roulette_level')::integer),
        'spins',spin_summary,'payment_reference','paypal-client:'||a.order_id,'currency',a.currency),false,now());
  update public.crm_paypal_orders
    set status='completed',remote_status='CAPTURE_COMPLETED',capture_id=p_capture_id,payment_id=payment.id,
        last_error=null,completed_at=now(),checked_at=now()
    where id=a.id;
  return jsonb_build_object('ok',true,'duplicated',false,'payment_id',payment.id,'credited',summary);
end $function$;

REVOKE ALL ON FUNCTION public.tc_purchase_reward_policy(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_purchase_reward_policy(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cliente_confirmar_compra_ruleta_v3(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_confirmar_compra_ruleta_v3(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.tc_register_call_with_payment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_register_call_with_payment(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crm_register_call_atomic_v8(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_register_call_atomic_v8(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.tc_apply_rank_package_benefits(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_apply_rank_package_benefits(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.tc_apply_purchase_benefits(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_apply_purchase_benefits(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.tc_register_call_minutes(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_register_call_minutes(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.tc_register_call_minutes_v2(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_register_call_minutes_v2(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.tc_register_call_recovery(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_register_call_recovery(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.tc_complete_paypal_client(uuid,text,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_complete_paypal_client(uuid,text,text,numeric,text) TO service_role;
COMMIT;
