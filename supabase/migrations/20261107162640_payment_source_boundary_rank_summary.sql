-- Keep Central payment links receipt-only; client web purchases credit once.
-- This migration changes function definitions only. It does not replay or debit history.
BEGIN;

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
    coalesce(sum(case when benefit_key in ('regular_purchase_minutes','diamond_purchase_minutes') then minutes else 0 end),0)::integer
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
end $function$
;

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
  payload jsonb := p_payload - 'separate_payment_confirmed';
  result jsonb;
  call_uuid uuid;
  payment_count bigint;
  collection_uuid uuid:=nullif(p_payload->>'paypal_collection_order_id','')::uuid;
  collection_source text:=nullif(p_payload->>'paypal_collection_source','');
  collection public.crm_paypal_orders%rowtype;
  credited_web_ids jsonb;
  confirmed_web_ids jsonb;
  is_purchase_replay boolean := false;
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
        if coalesce(payload->>'expected_paypal_environment','') not in ('live','sandbox') then
          raise exception 'PAYPAL_COLLECTION_INVALID';
        end if;
        -- A committed retry must remain idempotent even if another web payment arrived.
        select exists (
          select 1 from public.crm_cliente_pagos p
          where p.referencia_externa='registrar_llamada:'||operation_uuid::text
            and p.cliente_id=client_uuid and p.estado='completed'
            and p.metodo='paypal_manual' and p.importe=(payload->>'importe')::numeric
        ) into is_purchase_replay;
        if not is_purchase_replay then
          -- Client lock also serializes web crediting. Recheck exactly what staff saw.
          select coalesce(jsonb_agg(to_jsonb(id::text) order by id::text),'[]'::jsonb)
            into credited_web_ids
            from (
              select distinct p.id from public.crm_cliente_pagos p
              join public.crm_paypal_orders o on o.payment_id=p.id
              where p.cliente_id=client_uuid and o.cliente_id=client_uuid
                and o.checkout_kind='client_purchase' and o.status='completed'
                and o.environment=payload->>'expected_paypal_environment'
                and o.currency='EUR' and p.moneda='EUR' and p.estado='completed'
                and p.source_rendimiento_id is null
                and p.importe=(payload->>'importe')::numeric
                and o.amount=(payload->>'importe')::numeric
            ) credited;
          if jsonb_typeof(coalesce(payload->'confirmed_web_payment_ids','[]'::jsonb)) is distinct from 'array' then
            raise exception 'PAYPAL_WEB_PURCHASE_CONFIRMATION_INVALID';
          end if;
          if exists (
            select 1 from jsonb_array_elements(coalesce(payload->'confirmed_web_payment_ids','[]'::jsonb)) v
            where jsonb_typeof(v) is distinct from 'string'
              or v#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          ) then raise exception 'PAYPAL_WEB_PURCHASE_CONFIRMATION_INVALID'; end if;
          select coalesce(jsonb_agg(to_jsonb(lower(value)) order by lower(value)),'[]'::jsonb)
            into confirmed_web_ids
            from jsonb_array_elements_text(coalesce(payload->'confirmed_web_payment_ids','[]'::jsonb));
          if confirmed_web_ids <> credited_web_ids then
            if confirmed_web_ids='[]'::jsonb then
              raise exception 'PAYPAL_WEB_PURCHASE_CONFIRMATION_REQUIRED';
            end if;
            raise exception 'PAYPAL_WEB_PURCHASE_CONFIRMATION_CHANGED';
          end if;
        end if;
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
    result := public.crm_register_call_atomic_v8(payload);
    if collection_source='external' and not coalesce((result->>'duplicate_prevented')::boolean,false)
      and nullif(result#>>'{payment,id}','') is not null then
      -- Keep the acknowledgement on the payment for later reconciliation.
      update public.crm_cliente_pagos
        set benefits_context=coalesce(benefits_context,'{}'::jsonb)||jsonb_build_object(
          'confirmed_web_payment_ids',coalesce(confirmed_web_ids,'[]'::jsonb))
        where id=(result#>>'{payment,id}')::uuid;
    end if;
    return result;
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
end $function$
;

-- Preserve the server-only boundary for these payment entry points.
REVOKE ALL ON FUNCTION public.tc_complete_paypal_client(uuid,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tc_complete_paypal_client(uuid,text,text,numeric,text) TO service_role;
REVOKE ALL ON FUNCTION public.tc_register_call_with_payment(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tc_register_call_with_payment(jsonb) TO service_role;
COMMIT;
