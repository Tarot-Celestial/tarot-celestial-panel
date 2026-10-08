-- Tarot Celestial · Operación CRM y notas sin saltos, 08/10/2026
-- CORRECCIÓN ACOTADA:
-- 1. No conceder +15 FREE Diamante por compras introducidas manualmente en «Registrar llamada».
--    Los beneficios reales de compras externas confirmadas NO se alteran.
-- 2. No mostrar «Bonos» en nuevas notas de compra/llamada.
-- 3. Corregir únicamente la operación validada de anonymus #112 (84/40 -> 69/40)
--    si la fila sigue EXACTAMENTE en su estado auditado. No toca otros clientes.
-- IMPORTANTE: ejecución transaccional e idempotente, no crea otra compra ni otra llamada.
begin;

-- Mantener la regla Diamante para compras externas verdaderamente confirmadas;
-- excluir las altas manuales de llamada, que no deben añadir premios invisibles.
create or replace function public.tc_grant_diamond_purchase_minutes(p_payment_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.crm_cliente_pagos%rowtype; s jsonb; ev uuid;
begin
  select * into p from public.crm_cliente_pagos where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=p.cliente_id for update;
  select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
  if p.estado is distinct from 'completed' or coalesce(p.importe,0)<=0
      or p.benefits_processed_at is not null then return 0; end if;
  -- Registrar llamada gestiona minutos reales; no añade 15 FREE implícitos.
  if coalesce(p.referencia_externa,'') like 'registrar_llamada:%' then return 0; end if;
  s := public.tc_client_rank_state(p.cliente_id);
  if coalesce(s->>'effective','')<>'diamante' then return 0; end if;
  insert into public.tc_client_benefit_events(
    cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,
    purchase_amount,currency,minutes,delivery_key,snapshot)
  values(p.cliente_id,p.id,'diamante','diamond_purchase_minutes','minutes',
    p.importe,p.moneda,15,'diamond-minutes:'||p.id::text,
    jsonb_build_object('free_minutes',15,'rank_state',s,'rule','diamond_each_completed_purchase'))
  on conflict(payment_id,benefit_key) do nothing returning id into ev;
  if ev is null then return 0; end if;
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+15,
    updated_at=clock_timestamp() where id=p.cliente_id;
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p.cliente_id,'rank_purchase_minutes','Tus 15 minutos Diamante ya están disponibles',
    'Hemos añadido 15 minutos FREE adicionales por tu compra confirmada.',
    jsonb_build_object('payment_id',p.id,'benefit_event_id',ev,'free_minutes',15),false,now());
  perform public.tc_touch_roulette_signal(p.cliente_id);
  return 15;
end $$;

-- Las notas no deben incluir el concepto «Bonos» ni si es 0 ni si existe otro beneficio.
-- La lógica y el historial de otros beneficios NO se eliminan por ocultarlo en esta nota.
do $migration$
declare fn regprocedure; ddl text; needle text := '  update public.crm_client_notes set texto=final_note';
  replacement text := '  final_note := replace(final_note, format(''Bonos: %s FREE + %s normales. '', af-bf-df, an-bn-dn), '''');' || E'\n' || needle;
begin
  foreach fn in array array['public.tc_register_call_minutes(jsonb)'::regprocedure,
                             'public.tc_register_call_minutes_v2(jsonb)'::regprocedure]
  loop
    ddl := pg_get_functiondef(fn);
    -- Evita inyectar dos veces al repetir este SQL.
    if position('final_note := replace(final_note, format(' in ddl) > 0 then continue; end if;
    if position('Bonos: ' in ddl) = 0 then continue; end if;
    if position(needle in ddl) = 0 then raise exception 'NOTES_TEMPLATE_NOT_FOUND: %',fn; end if;
    ddl := replace(ddl, needle, replacement);
    execute ddl;
  end loop;
end $migration$;

-- Compensación ÚNICA y verificable de la operación de la captura.
-- Si otro operador ha alterado el saldo, no corregirlo a ciegas.
do $correct$
declare c uuid:='25c68fc9-0512-4d0c-894b-e591a2a81376';
        pay uuid:='27df18de-3d88-4ea0-bf15-085ec8168782';
        note_id uuid:='1c4e8109-53ce-4e68-bb46-d3da8c7f82f3';
        ev uuid;
        previous_free numeric; previous_normal numeric;
        new_note text := 'Compra registrada por 1 vía tpv. Saldo anterior: 69 FREE + 20 normales. Compra: 20 FREE + 20 normales. Consumo: 20 FREE + 0 normales. Saldo final: 69 FREE + 40 normales. Tarotista: 1111111111111.';
begin
  perform pg_advisory_xact_lock(hashtextextended('correct-manual-diamond:'||pay::text,0));
  select e.id into ev from public.tc_client_benefit_events e
  where e.payment_id=pay and e.cliente_id=c and e.benefit_key='diamond_purchase_minutes' and e.minutes=15;
  if ev is null then
    raise notice 'Operación ya corregida o no existe; no se modifica el saldo.';
    return;
  end if;
  select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
    into previous_free,previous_normal from public.crm_clientes where id=c for update;
  if previous_free is distinct from 84 or previous_normal is distinct from 40 then
    raise exception 'BALANCE_CHANGED: no se restan minutos sin comprobar las operaciones posteriores. Actual: % FREE + % normales',previous_free,previous_normal;
  end if;
  if not exists(select 1 from public.crm_client_notes n where n.id=note_id and n.cliente_id=c::text
    and n.texto like '%Saldo anterior: 69 FREE + 20 normales.%') then
    raise exception 'EXPECTED_PURCHASE_NOTE_NOT_FOUND';
  end if;
  update public.crm_clientes set minutos_free_pendientes=69, updated_at=clock_timestamp() where id=c;
  -- El evento mantiene trazabilidad, pero su cantidad neta de regalo queda en cero.
  update public.tc_client_benefit_events
  set minutes=0,
      snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object(
        'adjusted_to_zero',true,'previously_awarded_minutes',15,
        'adjustment_reason','Compra manual CRM: bono Diamante no solicitado; regularización de saldo',
        'adjustment_at',clock_timestamp())
  where id=ev;
  update public.crm_client_notes
  set texto=new_note,
      event_data=coalesce(event_data,'{}'::jsonb)||jsonb_build_object(
        'free_after',69,'normal_after',40,'corrected_manual_diamond_bonus',15,
        'minute_accounting',coalesce(event_data->'minute_accounting','{}'::jsonb)||jsonb_build_object(
          'free_after',69,'normal_after',40,'bonus_free',0,'bonus_normal',0))
  where id=note_id and cliente_id=c::text;
  update public.crm_cliente_pagos set notas=new_note where id=pay and cliente_id=c;
  update public.crm_call_operations
  set result = result || jsonb_build_object(
    'balances', coalesce(result->'balances','{}'::jsonb)||jsonb_build_object('free_after',69,'normal_after',40,'total_after',109,'free_delta',0,'normal_delta',20),
    'minute_accounting',coalesce(result->'minute_accounting','{}'::jsonb)||jsonb_build_object('free_after',69,'normal_after',40,'bonus_free',0,'bonus_normal',0))
  where operation_id='c5f4b9a7-83d8-44a3-8caa-809e1d483354'::uuid and cliente_id=c;
  -- Corrige la notificación histórica: no seguirá anunciando un regalo revertido.
  update public.cliente_notificaciones
  set titulo='Ajuste de minutos de la compra',
      mensaje='Se ha corregido el saldo de tu compra manual. Consulta tus minutos actuales.',
      meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('corrected',true,'previous_bonus_minutes',15)
  where cliente_id=c and meta->>'benefit_event_id'=ev::text;
  perform public.tc_touch_roulette_signal(c);
end $correct$;

notify pgrst,'reload schema';
commit;
