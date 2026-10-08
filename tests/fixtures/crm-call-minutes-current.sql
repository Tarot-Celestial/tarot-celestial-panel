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
      'billing_collaborator_id','source_tag_id','importe','forma_pago','promo','recuperado','super_promo_ruleta');
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
