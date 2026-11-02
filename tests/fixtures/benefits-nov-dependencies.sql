CREATE OR REPLACE FUNCTION public.cliente_confirmar_compra_promocion_v1(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.cliente_payment_attempts%rowtype; snap jsonb; result jsonb;
begin
  select * into a from public.cliente_payment_attempts where id=p_attempt_id;
  if a.id is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=a.cliente_id for update;
  select * into a from public.cliente_payment_attempts where id=p_attempt_id for update;
  if a.status not in ('processing','completed') then raise exception 'PAYMENT_NOT_VERIFIED'; end if;
  snap:=a.promotion_snapshot;
  if snap->>'kind'<>'promotion_minute_pack' or (snap->>'price')::numeric<>a.amount or snap->>'currency'<>a.currency then raise exception 'PROMOTION_SNAPSHOT_INVALID'; end if;
  -- Se concede el contrato cobrado, aunque la campaña termine durante el pago.
  result:=public.cliente_confirmar_compra_ruleta_v3(jsonb_build_object(
    'cliente_id',a.cliente_id,'payment_ref',a.provider||':'||a.order_id,'amount',a.amount,'currency',a.currency,
    'metodo',a.provider||'_promotion','pack_id',a.pack_id,'pack_name',snap->>'package_name',
    'free',snap->'free_minutes','normal',snap->'paid_minutes','points',snap->'coins','oracle_credits',snap->'oracle_credits',
    'roulette_level',snap->'roulette_level','roulette_spins',snap->'roulette_spins','notas',snap->>'promotion_name','created_by_role','cliente_webhook'));
  update public.cliente_payment_attempts set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=a.id;
  return result;
end $function$;


CREATE OR REPLACE FUNCTION public.cliente_confirmar_compra_ruleta_v2(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.cliente_confirmar_compra_ruleta_v3(p)
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


CREATE OR REPLACE FUNCTION public.get_cliente_oracle_balance(p_cliente_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select greatest(0, coalesce(sum(amount), 0))::integer
  from public.cliente_oracle_credit_movements
  where cliente_id = p_cliente_id;
$function$;


CREATE OR REPLACE FUNCTION public.grant_cliente_oracle_credits(p_cliente_id uuid, p_amount integer, p_reference text, p_pack_id text, p_notes text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_amount <= 0 then raise exception 'INVALID_ORACLE_CREDIT_AMOUNT'; end if;

  insert into public.cliente_oracle_credit_movements
    (cliente_id, amount, movement_type, reference, pack_id, notes, meta)
  values
    (p_cliente_id, p_amount, 'purchase', p_reference, p_pack_id, p_notes, coalesce(p_meta, '{}'::jsonb))
  on conflict (reference) do nothing;

  return public.get_cliente_oracle_balance(p_cliente_id);
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_client_rank_override(p_assigned_rank text, p_client_id uuid, p_created_by uuid, p_ends_at timestamp with time zone, p_intervention_type text, p_notes text, p_reason text, p_starts_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_automatic_rank text;
  v_business text;
  v_existing public.client_rank_overrides%rowtype;
  v_new_id uuid;
  v_previous_effective_rank text;
  v_rolling_total numeric := 0;
  v_starts_at timestamptz := coalesce(p_starts_at, now());
begin
  if p_assigned_rank is null
     or lower(trim(p_assigned_rank)) not in ('bronce', 'plata', 'oro', 'diamante') then
    raise exception using errcode = '22023', message = 'INVALID_CLIENT_RANK';
  end if;

  if p_intervention_type is null
     or lower(trim(p_intervention_type)) not in ('temporary', 'permanent', 'penalty') then
    raise exception using errcode = '22023', message = 'INVALID_INTERVENTION_TYPE';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'RANK_OVERRIDE_REASON_REQUIRED';
  end if;

  if lower(trim(p_intervention_type)) = 'permanent' and p_ends_at is not null then
    raise exception using errcode = '22023', message = 'PERMANENT_OVERRIDE_CANNOT_END';
  end if;

  if p_ends_at is not null and p_ends_at <= v_starts_at then
    raise exception using errcode = '22023', message = 'RANK_OVERRIDE_INVALID_DATES';
  end if;

  if not exists (select 1 from public.workers where id = p_created_by) then
    raise exception using errcode = '23503', message = 'RANK_OVERRIDE_WORKER_NOT_FOUND';
  end if;

  select lower(coalesce(nullif(trim(c.origen), ''), 'celestial'))
    into v_business
  from public.crm_clientes c
  where c.id = p_client_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'RANK_OVERRIDE_CLIENT_NOT_FOUND';
  end if;

  -- Serialize interventions for the same client. This complements the partial unique
  -- index and prevents two simultaneous requests from replacing each other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));

  select coalesce(sum(source.amount), 0)
    into v_rolling_total
  from (
    select greatest(coalesce(p.importe, 0), 0)::numeric as amount
    from public.crm_cliente_pagos p
    where p.cliente_id = p_client_id
      and p.estado = 'completed'
      and p.created_at >= now() - interval '30 days'
      and p.created_at <= now()
    union all
    select greatest(coalesce(l.importe, 0), 0)::numeric as amount
    from public.rendimiento_llamadas l
    where l.cliente_id = p_client_id::text
      and coalesce(l.fecha_hora, l.created_at) >= now() - interval '30 days'
      and coalesce(l.fecha_hora, l.created_at) <= now()
  ) source;

  v_automatic_rank := case
    when v_rolling_total >= 1000 then 'diamante'
    when v_rolling_total >= 500 then 'oro'
    when v_rolling_total >= 100 then 'plata'
    when v_rolling_total > 0 then 'bronce'
    else null
  end;

  select *
    into v_existing
  from public.client_rank_overrides
  where client_id = p_client_id
    and active = true
  order by created_at desc
  limit 1
  for update;

  v_previous_effective_rank := coalesce(v_existing.assigned_rank, v_automatic_rank);

  if v_existing.id is not null then
    update public.client_rank_overrides
       set active = false,
           restored_by = p_created_by,
           restored_at = now(),
           updated_at = now()
     where id = v_existing.id;

    insert into public.client_rank_override_audit (
      override_id, client_id, business, action, automatic_rank,
      previous_effective_rank, new_effective_rank, intervention_type,
      reason, notes, starts_at, ends_at, actor_worker_id
    ) values (
      v_existing.id, p_client_id, v_existing.business, 'replaced', v_automatic_rank,
      v_existing.assigned_rank, lower(trim(p_assigned_rank)), v_existing.intervention_type,
      nullif(trim(p_reason), ''), nullif(trim(coalesce(p_notes, '')), ''),
      v_existing.starts_at, v_existing.ends_at, p_created_by
    );
  end if;

  insert into public.client_rank_overrides (
    client_id, business, assigned_rank, intervention_type, starts_at, ends_at,
    reason, notes, active, automatic_rank_at_creation,
    previous_effective_rank, created_by
  ) values (
    p_client_id,
    v_business,
    lower(trim(p_assigned_rank)),
    lower(trim(p_intervention_type)),
    v_starts_at,
    case when lower(trim(p_intervention_type)) = 'permanent' then null else p_ends_at end,
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    v_automatic_rank,
    v_previous_effective_rank,
    p_created_by
  )
  returning id into v_new_id;

  insert into public.client_rank_override_audit (
    override_id, client_id, business, action, automatic_rank,
    previous_effective_rank, new_effective_rank, intervention_type,
    reason, notes, starts_at, ends_at, actor_worker_id
  ) values (
    v_new_id, p_client_id, v_business, 'created', v_automatic_rank,
    v_previous_effective_rank, lower(trim(p_assigned_rank)), lower(trim(p_intervention_type)),
    trim(p_reason), nullif(trim(coalesce(p_notes, '')), ''),
    v_starts_at,
    case when lower(trim(p_intervention_type)) = 'permanent' then null else p_ends_at end,
    p_created_by
  );

  return v_new_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.tc_evaluate_benefits(p_rank text, p_amount numeric, p_currency text, p_promotion boolean, p_base jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r public.client_benefit_rules%rowtype; v jsonb:=coalesce(p_base,'{}'); rules jsonb:='[]'; k text; n numeric;
begin
 if p_amount<=0 or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_currency is null or p_currency not in ('EUR','USD') then raise exception 'INVALID_PURCHASE_CONTEXT'; end if;
 for r in select * from public.client_benefit_rules where active and archived_at is null and event='purchase'
  and (rank is null or rank=p_rank) and currency=p_currency
  and p_amount>min_amount and (max_amount is null or p_amount<=max_amount)
  and starts_at<=now() and (ends_at is null or ends_at>now())
  and (scope='all' or scope=case when p_promotion then 'promotion' else 'regular' end)
  order by case when mode='replace' then 0 else 1 end,priority,id
 loop
  foreach k in array array['coins','free_minutes','oracle_credits','roulette_spins'] loop
   n:=nullif(to_jsonb(r)->>k,'')::numeric;
   if k='coins' and r.coins_rate is not null then n:=floor(p_amount*r.coins_rate); end if;
   if n is not null then
    if r.mode='add' then n:=coalesce((v->>k)::numeric,0)+n; end if;
    v:=jsonb_set(v,array[k],to_jsonb(n));
    if k='roulette_spins' then
     if r.mode='add' and coalesce((v->>'roulette_level')::integer, r.roulette_level)<>r.roulette_level and n>r.roulette_spins then raise exception 'INCOMPATIBLE_ROULETTE_LEVELS'; end if;
     v:=jsonb_set(v,'{roulette_level}',to_jsonb(r.roulette_level));
    end if;
   end if;
  end loop;
  rules:=rules||jsonb_build_array(to_jsonb(r));
 end loop;
 return jsonb_build_object('base',p_base,'benefits',v,'rules',rules,'rank',p_rank,'amount',p_amount,'currency',p_currency,'promotion',p_promotion);
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


CREATE OR REPLACE FUNCTION public.tc_ruleta_catalogo_v3(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base jsonb;
  v_catalogue jsonb;
  v_fixed_total numeric := 0;
  v_normal_count integer := 0;
  v_coin_1000_count integer := 0;
  v_normal_probability numeric;
begin
  v_base := public.cliente_ruleta_resumen_v2(p_cliente_id);
  v_catalogue := v_base->'catalogue';

  if v_catalogue is null or jsonb_typeof(v_catalogue) <> 'array' then
    raise exception 'RULETA_V2_CATALOGUE_NOT_FOUND';
  end if;

  -- Premios normales a los que se reparte el porcentaje liberado:
  -- minutos de Nivel 2 que NO son premio especial.
  select count(*)
  into v_normal_count
  from jsonb_array_elements(v_catalogue) e
  where (e->>'nivel')::integer = 2
    and e->>'reward_type' = 'minutes'
    and not coalesce((e->>'special')::boolean, false);

  if v_normal_count <= 0 then
    raise exception 'RULETA_V2_LEVEL2_NORMAL_PRIZES_NOT_FOUND';
  end if;

  select count(*)
  into v_coin_1000_count
  from jsonb_array_elements(v_catalogue) e
  where (e->>'nivel')::integer = 2
    and e->>'reward_type' = 'coins'
    and (e->>'reward_value')::integer = 1000;

  if v_coin_1000_count <> 1 then
    raise exception 'RULETA_V2_1000_COINS_REWARD_NOT_FOUND';
  end if;

  -- Conservamos todos los premios fijos tal cual, salvo +1000 Coins que pasa a 10.
  select coalesce(sum(
    case
      when (e->>'nivel')::integer <> 2 then 0
      when e->>'reward_type' = 'minutes' and not coalesce((e->>'special')::boolean, false) then 0
      when e->>'reward_type' = 'coins' and (e->>'reward_value')::integer = 1000 then 10
      else (e->>'probability')::numeric
    end
  ), 0)
  into v_fixed_total
  from jsonb_array_elements(v_catalogue) e;

  v_normal_probability := (100 - v_fixed_total) / v_normal_count;

  if v_normal_probability <= 0 then
    raise exception 'RULETA_V3_INVALID_PROBABILITY_DISTRIBUTION';
  end if;

  select jsonb_agg(
    case
      when (e.value->>'nivel')::integer = 2
       and e.value->>'reward_type' = 'coins'
       and (e.value->>'reward_value')::integer = 1000
        then jsonb_set(e.value, '{probability}', to_jsonb(10::numeric), false)
      when (e.value->>'nivel')::integer = 2
       and e.value->>'reward_type' = 'minutes'
       and not coalesce((e.value->>'special')::boolean, false)
        then jsonb_set(e.value, '{probability}', to_jsonb(v_normal_probability), false)
      else e.value
    end
    order by e.ordinality
  )
  into v_catalogue
  from jsonb_array_elements(v_catalogue) with ordinality as e(value, ordinality);

  return v_catalogue;
end;
$function$;


CREATE OR REPLACE FUNCTION public.tc_ruleta_catalogo_v4(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select public.tc_ruleta_catalogo_v3(p_cliente_id) $function$;


CREATE OR REPLACE FUNCTION public.tc_ruleta_level_for_amount(p_amount numeric)
 RETURNS smallint
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  if p_amount is null or p_amount <= 0 then return null; end if;
  if p_amount < 27 then return 1; end if;
  if p_amount >= 27 and p_amount < 37 then return 2; end if;
  if p_amount >= 49 and p_amount <= 99 then return 3; end if;
  return null;
end;
$function$;


CREATE OR REPLACE FUNCTION public.tc_touch_roulette_signal(p_cliente_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_cliente_id is null then return; end if;
  insert into public.cliente_ruleta_signal(cliente_id,updated_at)
  values (p_cliente_id,now())
  on conflict (cliente_id) do update set updated_at = excluded.updated_at;
end;
$function$;

