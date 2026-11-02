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

CREATE OR REPLACE FUNCTION public.tc_register_new_tarotista_gift(p_user uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 actor public.workers%rowtype; tarotista public.workers%rowtype; c public.crm_clientes%rowtype;
 op uuid; client_id uuid; tarotista_id uuid; request jsonb; previous public.crm_new_tarotista_gift_uses%rowtype;
 offer jsonb; r text; minutes integer; granted integer; credit_event uuid; event_id uuid;
 payload jsonb; result jsonb; final_receipt jsonb; receipt jsonb; accounting jsonb; before_free numeric; before_normal numeric;
 after_free numeric; after_normal numeric; note_text text;
begin
 select * into actor from public.workers where user_id=p_user and role in ('central','admin') and is_active is true;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_RANK_FREE_REQUEST'; end if;
 op:=nullif(p_payload->>'operation_id','')::uuid;
 client_id:=nullif(p_payload->>'cliente_id','')::uuid;
 tarotista_id:=nullif(p_payload->>'tarotista_worker_id','')::uuid;
 if op is null or client_id is null or tarotista_id is null
    or p_payload->>'rank_free_eligibility_key' is distinct from tarotista_id::text
    or coalesce(p_payload->>'rank_free_expected_rank','') not in ('sin_rango','bronce','plata','oro','diamante')
    or coalesce(p_payload->>'rank_free_expected_minutes','') !~ '^[1-9][0-9]?$'
    or coalesce((p_payload->>'cliente_compra_minutos')::boolean,false)
    or coalesce((p_payload->>'usa_7_free')::boolean,false)
    or coalesce((p_payload->>'captado')::boolean,false)
    or coalesce((p_payload->>'recuperado')::boolean,false)
    or coalesce((p_payload->>'importe')::numeric,0)<>0
    or nullif(p_payload->>'tarotista_manual_call','') is not null
    or nullif(p_payload->>'collaborator_source','') is not null
    or nullif(p_payload->>'existing_payment_id','') is not null
    or nullif(p_payload->>'paypal_collection_order_id','') is not null
    or coalesce(p_payload->>'clasificacion','nada')<>'nada'
 then raise exception 'INVALID_RANK_FREE_REQUEST'; end if;
 request:=jsonb_build_object('client',client_id,'worker',actor.id,'tarotista',tarotista_id,
  'expected_rank',p_payload->>'rank_free_expected_rank','expected_minutes',(p_payload->>'rank_free_expected_minutes')::integer,
  'eligibility_key',p_payload->>'rank_free_eligibility_key','policy','new_tarotista_once_v1');
 -- Same first lock as the canonical minute RPC. Replay precedes current-rank checks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(op::text,0));
 select * into previous from public.crm_new_tarotista_gift_uses where operation_id=op;
 if found then
  if previous.request<>request then raise exception 'PAYMENT_OPERATION_CONFLICT'; end if;
  return previous.result||jsonb_build_object('duplicate_prevented',true);
 end if;
 if exists(select 1 from public.crm_call_operations where operation_id=op) then raise exception 'PAYMENT_OPERATION_CONFLICT'; end if;
 select * into c from public.crm_clientes where id=client_id for update;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 if exists(select 1 from public.crm_new_tarotista_gift_uses where cliente_id=client_id and tarotista_worker_id=tarotista_id) then raise exception 'ALREADY_USED'; end if;
 offer:=public.tc_new_tarotista_gift_offer(client_id,tarotista_id);
 if offer->>'reason' is not null then raise exception '%',offer->>'reason'; end if;
 r:=offer->>'effective_rank';minutes:=(offer->>'consume_minutes')::integer;
 if r is distinct from p_payload->>'rank_free_expected_rank'
    or minutes is distinct from (p_payload->>'rank_free_expected_minutes')::integer then raise exception 'RANK_CHANGED'; end if;
 select * into tarotista from public.workers where id=tarotista_id and role='tarotista' and is_active is true;
 if not found then raise exception 'TAROTISTA_INACTIVE'; end if;
 select e.id into credit_event from public.tc_client_benefit_events e
  where e.cliente_id=client_id and e.delivery_key='diamond-new-tarotista:'||tarotista_id::text||':'||client_id::text and coalesce(e.minutes,0)>0;
 -- The old Diamond event is audit context only. This is a distinct once-per-pair
 -- allowance: grant and consume N now without depending on the existing wallet.
 granted:=minutes;
 before_free:=coalesce(c.minutos_free_pendientes,0);before_normal:=coalesce(c.minutos_normales_pendientes,0);
 insert into public.tc_client_benefit_events(cliente_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,snapshot)
 values(client_id,r,'new_tarotista_consultation','minutes',granted,'new-tarotista-call:'||tarotista_id::text||':'||client_id::text,
  jsonb_build_object('source','new_tarotista_once_v1','operation_id',op,'tarotista_worker_id',tarotista_id,'rank',r,
   'grant_minutes',granted,'consume_minutes',minutes,'previous_credit_event_id',credit_event,'free_before',before_free)) returning id into event_id;
 if granted>0 then
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+granted,updated_at=now() where id=client_id;
 end if;
 payload:=jsonb_build_object('operation_id',op,'cliente_id',client_id,'cliente_nombre',concat_ws(' ',c.nombre,c.apellido),
  'telefonista_worker_id',actor.id,'telefonista_nombre',actor.display_name,'tarotista_worker_id',tarotista_id,'tarotista_nombre',tarotista.display_name,
  'tipo_registro','minutos','cliente_compra_minutos',false,'usa_7_free',false,'usa_minutos',true,
  'misma_compra',false,'guarda_minutos',false,'codigo_1','FREE','minutos_1',minutes,'codigo_2',null,'minutos_2',0,
  'resumen_codigo',minutes||' free','tiempo',minutes,'importe',0,'captado',false,'recuperado',false,'promo',false,
  'note_text','Consulta de bienvenida con nueva tarotista.','note_author_user_id',actor.user_id,'note_author_name',actor.display_name,
  'note_author_email',actor.email,'created_by_role',actor.role);
 result:=public.tc_register_call_minutes(payload);
 if result#>>'{rendimiento,id}' is null or coalesce((result->>'duplicate_prevented')::boolean,false) then raise exception 'CALL_REGISTER_FAILED'; end if;
 select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
 into after_free,after_normal from public.crm_clientes where id=client_id;
 if after_free<>before_free+granted-minutes or after_normal<>before_normal then raise exception 'MINUTE_ACCOUNTING_MISMATCH'; end if;
 receipt:=jsonb_build_object('effective_rank',r,'minutes',minutes,'policy_key','new_tarotista_once_v1',
  'tarotista_worker_id',tarotista_id,'tarotista_name',tarotista.display_name,'benefit_event_id',event_id,
  'grant_minutes',granted,'consume_minutes',minutes,'previous_credit_event_id',credit_event);
 accounting:=coalesce(result->'minute_accounting','{}'::jsonb)||jsonb_build_object('source','new_tarotista_once_v1',
  'free_before',before_free,'normal_before',before_normal,'rank_free_granted',granted,'used_free',minutes,'used_normal',0,
  'free_after',after_free,'normal_after',after_normal,'previous_credit_event_id',credit_event);
 note_text:=format('Consulta con nueva tarotista: %s. Rango %s: %s minutos FREE. Acreditados ahora: %s; consumidos: %s. Saldo anterior: %s FREE + %s normales. Saldo final: %s FREE + %s normales.',
  tarotista.display_name,r,minutes,granted,minutes,before_free,before_normal,after_free,after_normal);
 update public.crm_client_notes set texto=note_text,
  event_data=coalesce(event_data,'{}'::jsonb)||jsonb_build_object('rank_free',receipt,'minute_accounting',accounting,
   'free_before',before_free,'free_delta',after_free-before_free,'free_after',after_free,
   'normal_before',before_normal,'normal_delta',0,'normal_after',after_normal)
  where cliente_id=client_id::text and event_data->>'rendimiento_id'=result#>>'{rendimiento,id}';
 result:=result||jsonb_build_object('rank_free',receipt,'minute_accounting',accounting,
  'balances',jsonb_build_object('free_before',before_free,'normal_before',before_normal,'free_after',after_free,'normal_after',after_normal,
   'free_delta',after_free-before_free,'normal_delta',0,'total_after',after_free+after_normal));
 -- Finish the receipt created by the inner call in this same transaction.
 final_receipt:=result;
 update public.crm_call_operations set result=final_receipt where operation_id=op;
 update public.tc_client_benefit_events set snapshot=snapshot||jsonb_build_object('rendimiento_id',result#>>'{rendimiento,id}','free_after',after_free,'normal_after',after_normal) where id=event_id;
 insert into public.crm_new_tarotista_gift_uses(operation_id,cliente_id,tarotista_worker_id,worker_id,effective_rank,minutes,granted_minutes,
 previous_credit_event_id,benefit_event_id,rendimiento_id,request,result)
 values(op,client_id,tarotista_id,actor.id,r,minutes,granted,credit_event,event_id,(result#>>'{rendimiento,id}')::uuid,request,result);
 return result;
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
