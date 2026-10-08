begin;
do $$
declare
  c uuid := '25c68fc9-0512-4d0c-894b-e591a2a81376';
  r text := '075385c4-9cdd-4bd8-89b8-8b8c143ac617';
  e jsonb;
  previous_free numeric;
  previous_normal numeric;
begin
  select minutos_free_pendientes,minutos_normales_pendientes into previous_free,previous_normal
    from public.crm_clientes where id=c for update;
  if not found then raise exception 'Ficha de la correccion no encontrada'; end if;
  select event_data into e from public.crm_client_notes
    where cliente_id=c::text and event_data->>'rendimiento_id'=r for update;
  if e is null then raise exception 'No se encontro la nota original'; end if;
  if e->>'correction_purchase_consumed_5'='true' then return; end if;
  if e->>'payment_id' is distinct from 'e4fe44f7-8811-443f-a540-c49de9cb3727'
     or (e->>'free_delta')::numeric is distinct from 20 or (e->>'free_before')::numeric is distinct from 134
     or (e->>'free_after')::numeric is distinct from 154 or previous_free<5 then
    raise exception 'Los datos no coinciden con el caso verificado; no se modifica el saldo';
  end if;
  update public.crm_clientes set minutos_free_pendientes=previous_free-5,updated_at=now() where id=c;
  update public.crm_client_notes set event_data=event_data||jsonb_build_object('correction_purchase_consumed_5',true),
    texto=texto||' [Corregido: los 20 FREE eran anteriores al consumo; quedan 15 FREE de esta compra. Ajuste posterior de -5 FREE registrado por separado.]'
    where cliente_id=c::text and event_data->>'rendimiento_id'=r;
  insert into public.crm_client_notes(cliente_id,texto,author_name,is_pinned,created_at,event_type,event_data)
    values(c::text,format('Corrección de la compra de prueba: consumo de 5 FREE omitido. Saldo anterior: %s FREE + %s normales. Saldo final: %s FREE + %s normales. Se conservan los bonos Diamante.',previous_free,previous_normal,previous_free-5,previous_normal),
      'Sistema',false,now(),'minute_adjustment',jsonb_build_object('correction_of',r,'free_before',previous_free,'free_delta',-5,'free_after',previous_free-5,'normal_before',previous_normal,'normal_after',previous_normal));
end $$;
commit;
