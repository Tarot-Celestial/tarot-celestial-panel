-- Additive Oracle-only completion. The existing minute/CRM finalizers are unchanged.
-- CLI unavailable on this host; filename uses verified UTC 2026-10-29 00:55:16.
-- Preconditions inspected live: canonical payment/capture unique keys, Oracle
-- movement references, grant helpers and the deferred tc_purchase_benefits trigger.
create or replace function public.tc_complete_paypal_oracle(
 p_id uuid,p_order_id text,p_capture_id text,p_amount numeric,p_currency text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 a public.crm_paypal_orders;
 payment public.crm_cliente_pagos;
 payload jsonb;
 expected_amount numeric;
 expected_name text;
 credits integer;
 questions integer;
 client_auth uuid;
 payment_reference text;
 oracle_reference text;
 summary jsonb;
 note_text text;
begin
 select * into a from public.crm_paypal_orders where id=p_id for update;
 if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
 if a.checkout_kind is distinct from 'client_purchase' or a.purchaser_auth_user_id is null or a.worker_id is not null then
  raise exception 'PAYPAL_CHECKOUT_KIND_MISMATCH';
 end if;
 if nullif(btrim(a.order_id),'') is null or p_order_id is distinct from a.order_id
    or p_amount is distinct from a.amount or p_currency is distinct from a.currency
    or a.currency is distinct from 'EUR' or nullif(btrim(coalesce(p_capture_id,'')),'') is null
    or (a.capture_id is not null and a.capture_id is distinct from p_capture_id) then
  raise exception 'PAYPAL_CAPTURE_MISMATCH';
 end if;

 select x.price,x.title,x.credits,x.questions into expected_amount,expected_name,credits,questions
 from (values
  ('oracle_2',1::numeric,'Pack Oráculo',2,0),
  ('destino_3',2::numeric,'Pack Destino',3,0),
  ('oracle_questions_3',2::numeric,'Preguntas al Oráculo',0,3)
 ) x(pack,price,title,credits,questions) where x.pack=a.pack_id;
 payload:=a.purchase_payload;
 if expected_amount is null or a.amount is distinct from expected_amount or a.pack_name is distinct from expected_name
    or jsonb_typeof(payload) is distinct from 'object' then
  raise exception 'PAYPAL_ORACLE_SNAPSHOT_INVALID';
 end if;
 -- Exact, versioned server snapshot: unknown benefit fields cannot be silently
 -- ignored or coerced into an unrelated minute/coin/roulette purchase.
 if not(payload @> jsonb_build_object(
    'purchase_kind','oracle','pack_id',a.pack_id,'pack_name',expected_name,
    'normal',0,'free',0,'total_minutes',0,'points',0,
    'oracle_credits',credits,'oracle_questions',questions,'roulette_level',null,
    'roulette_spins',0,'package_level',null,'reward_policy_version',1,
    'pricing_mode','oracle','purchase_classification','nada','rewards_eligible',false,'created_by_role','cliente'))
    or exists(select 1 from jsonb_object_keys(payload) k where k not in (
      'purchase_kind','pack_id','pack_name','normal','free','total_minutes','points',
      'oracle_credits','oracle_questions','roulette_level','roulette_spins','package_level',
      'reward_policy_version','pricing_mode','purchase_classification','rewards_eligible',
      'created_by_role','notas','paypal_account','paypal_merchant_id'))
    or (payload ? 'notas' and (jsonb_typeof(payload->'notas') is distinct from 'string' or length(payload->>'notas')>2000))
    or (payload ? 'paypal_account') is distinct from (payload ? 'paypal_merchant_id')
    or (payload ? 'paypal_account' and (payload->>'paypal_account' is distinct from 'client_business_v1'
      or jsonb_typeof(payload->'paypal_merchant_id') is distinct from 'string'
      or length(btrim(payload->>'paypal_merchant_id')) not between 1 and 128)) then
  raise exception 'PAYPAL_ORACLE_SNAPSHOT_INVALID';
 end if;

 payment_reference:='paypal-client:'||a.order_id;
 oracle_reference:='paypal-oracle:'||a.order_id;
 summary:=jsonb_build_object('purchase_kind','oracle','normal',0,'free',0,'rank_free_minutes',0,
   'total_minutes',0,'coins',0,'oracle_credits',credits,'oracle_questions',questions,'spins','[]'::jsonb);
 -- The attempt row serializes callbacks. The capture lock also serializes two
 -- different Oracle attempts that claim the same capture; existing order-table
 -- UNIQUE keys remain the final protection against other checkout finalizers.
 perform pg_advisory_xact_lock(hashtextextended('paypal-oracle-capture:'||p_capture_id,0));
 if exists(select 1 from public.crm_paypal_orders o where o.id<>a.id
    and (o.order_id=a.order_id or o.capture_id=p_capture_id)) then
  raise exception 'PAYPAL_CAPTURE_REUSED';
 end if;
 if exists(select 1 from public.crm_cliente_pagos p
    where (p.referencia_externa=payment_reference or p.paypal_order_id=a.order_id or p.paypal_capture_id=p_capture_id)
      and (a.payment_id is null or p.id<>a.payment_id)) then
  raise exception 'PAYPAL_CAPTURE_REUSED';
 end if;

 if a.status='completed' then
  if a.capture_id is distinct from p_capture_id or a.payment_id is null then raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
  select * into payment from public.crm_cliente_pagos where id=a.payment_id;
  if not found or payment.cliente_id is distinct from a.cliente_id or payment.estado is distinct from 'completed'
    or payment.importe is distinct from a.amount or payment.moneda is distinct from a.currency
    or payment.pack_id is distinct from a.pack_id or payment.pack_name is distinct from a.pack_name
    or payment.paypal_order_id is distinct from a.order_id or payment.paypal_capture_id is distinct from p_capture_id
    or payment.referencia_externa is distinct from payment_reference
    or payment.paid_minutes is distinct from 0::numeric or payment.bonus_minutes is distinct from 0::numeric
    or payment.created_by_user_id is distinct from a.purchaser_auth_user_id
    or payment.benefits_processed_at is null or payment.benefits_context->>'purchase_kind' is distinct from 'oracle' then
   raise exception 'PAYPAL_ORACLE_PURCHASE_MISMATCH';
  end if;
 else
  if a.payment_id is not null then raise exception 'PAYPAL_ORACLE_PURCHASE_MISMATCH'; end if;
  select auth_user_id into client_auth from public.crm_clientes where id=a.cliente_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  if client_auth is distinct from a.purchaser_auth_user_id then raise exception 'PAYPAL_CLIENT_IDENTITY_MISMATCH'; end if;
  if exists(select 1 from public.cliente_oracle_credit_movements where reference=oracle_reference)
     or exists(select 1 from public.cliente_oracle_question_movements where reference=oracle_reference) then
   raise exception 'PAYPAL_ORACLE_REFERENCE_CONFLICT';
  end if;
  note_text:=format('Compra web de Oráculo confirmada · PayPal. %s por %s EUR. Tiradas acreditadas: %s. Preguntas adicionales acreditadas: %s. Referencia PayPal: %s.',
    a.pack_name,a.amount,credits,questions,a.order_id);
  -- Oracle is a separate purchased product, not a minute-package benefit.
  -- Setting this marker on INSERT is essential: the existing deferred benefits
  -- trigger checks it, and both benefit/diamond RPCs also return early on it.
  -- A rewards_eligible=false flag alone is insufficient under the live policy.
  insert into public.crm_cliente_pagos(cliente_id,importe,moneda,estado,metodo,
    paypal_order_id,paypal_capture_id,referencia_externa,pack_id,pack_name,paid_minutes,bonus_minutes,
    created_by_user_id,created_by_role,notas,benefits_context,benefits_processed_at)
  values(a.cliente_id,a.amount,'EUR','completed','paypal_cliente',a.order_id,p_capture_id,
    payment_reference,a.pack_id,a.pack_name,0,0,a.purchaser_auth_user_id,'cliente',note_text,
    jsonb_build_object('purchase_kind','oracle','pricing_mode','oracle','purchase_classification','nada',
      'rewards_eligible',false,'coins',0,'oracle_credits',0,'special_spins',0,
      'oracle_purchased_credits',credits,'oracle_purchased_questions',questions,
      'paypal_attempt_id',a.id,'fulfillment_version',1),clock_timestamp()) returning * into payment;
  if credits>0 then
   perform public.grant_cliente_oracle_credits(a.cliente_id,credits,oracle_reference,a.pack_id,note_text,
     jsonb_build_object('payment_id',payment.id,'paypal_attempt_id',a.id,'paypal_order_id',a.order_id,
       'paypal_capture_id',p_capture_id,'purchase_kind','oracle','pack_id',a.pack_id));
  else
   perform public.grant_cliente_oracle_questions(a.cliente_id,questions,oracle_reference,note_text,
     jsonb_build_object('payment_id',payment.id,'paypal_attempt_id',a.id,'paypal_order_id',a.order_id,
       'paypal_capture_id',p_capture_id,'purchase_kind','oracle','pack_id',a.pack_id));
  end if;
 end if;

 -- The grant helpers intentionally ignore duplicate references. Verify their
 -- actual persisted delivery instead of treating an ignored collision as paid.
 if credits>0 then
  if not exists(select 1 from public.cliente_oracle_credit_movements m where m.reference=oracle_reference
      and m.cliente_id=a.cliente_id and m.amount=credits and m.movement_type='purchase'
      and m.pack_id=a.pack_id and m.meta->>'payment_id'=payment.id::text)
    or exists(select 1 from public.cliente_oracle_question_movements where reference=oracle_reference) then
   raise exception 'PAYPAL_ORACLE_DELIVERY_MISMATCH';
  end if;
 else
  if not exists(select 1 from public.cliente_oracle_question_movements m where m.reference=oracle_reference
      and m.cliente_id=a.cliente_id and m.amount=questions and m.movement_type='purchase'
      and m.meta->>'pack_id'=a.pack_id and m.meta->>'payment_id'=payment.id::text)
    or exists(select 1 from public.cliente_oracle_credit_movements where reference=oracle_reference) then
   raise exception 'PAYPAL_ORACLE_DELIVERY_MISMATCH';
  end if;
 end if;
 if a.status='completed' then
  return jsonb_build_object('ok',true,'duplicated',true,'payment_id',payment.id,'credited',summary);
 end if;

 insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,event_type,event_data,is_pinned)
 values(a.cliente_id::text,note_text,a.purchaser_auth_user_id,'Sistema · Compra web','client_paypal_oracle_purchase',
   jsonb_build_object('payment_id',payment.id,'paypal_attempt_id',a.id,'paypal_order_id',a.order_id,
     'paypal_capture_id',p_capture_id,'amount',a.amount,'currency',a.currency,'pack_id',a.pack_id,
     'source','cliente_panel','purchase_kind','oracle','credited',summary),false);
 insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
 values(a.cliente_id,'purchase_completed','Compra de Oráculo confirmada',
   case when credits>0 then format('Tu %s ya está disponible: hemos añadido %s tiradas premium.',a.pack_name,credits)
     else format('Hemos añadido %s preguntas adicionales para tus lecturas de Oráculo.',questions) end,
   jsonb_build_object('payment_id',payment.id,'pack_id',a.pack_id,'pack_name',a.pack_name,'purchase_kind','oracle',
     'oracle_credits',credits,'oracle_questions',questions,'total_minutes',0,'coins',0,'roulette_spins',0,
     'payment_reference',payment_reference,'currency','EUR'),false,now());
 update public.crm_paypal_orders set status='completed',remote_status='CAPTURE_COMPLETED',capture_id=p_capture_id,
   payment_id=payment.id,last_error=null,completed_at=now(),checked_at=now() where id=a.id;
 return jsonb_build_object('ok',true,'duplicated',false,'payment_id',payment.id,'credited',summary);
end $$;
revoke all on function public.tc_complete_paypal_oracle(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.tc_complete_paypal_oracle(uuid,text,text,numeric,text) to service_role;
