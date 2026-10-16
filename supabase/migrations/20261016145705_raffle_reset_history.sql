-- Only the verified server may call this function. Existing raffle data is never deleted.
create or replace function public.tc_raffle_manage(
  p_raffle uuid, p_worker uuid, p_action text, p_data jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_raffle public.raffles%rowtype;
  v_next public.raffles%rowtype;
  v_entry public.raffle_entries%rowtype;
  v_client public.crm_clientes%rowtype;
  v_request uuid;
  v_number integer;
  v_receipt jsonb;
begin
  if not exists (
    select 1 from public.workers w where w.id = p_worker
      and w.role in ('central', 'admin') and w.is_active is not false
  ) then
    raise exception using errcode = '42501', message = 'No tienes permiso para gestionar sorteos.';
  end if;
  if p_action is null or p_action not in ('reset', 'assign', 'extend')
    or p_raffle is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Solicitud de sorteo inválida.';
  end if;

  -- Same first lock as tc_raffle_action: selection, assignment and reset serialize.
  select * into v_raffle from public.raffles where id = p_raffle for update;
  if not found then raise exception 'No encontramos este sorteo. Actualiza el panel.'; end if;

  if p_action = 'reset' then
    if p_data->'confirmed' is distinct from 'true'::jsonb
      or coalesce(p_data->>'request_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Confirma el reinicio del sorteo antes de continuar.';
    end if;
    v_request := (p_data->>'request_id')::uuid;
    select a.payload into v_receipt from public.raffle_selection_audit a
      where a.entity_id = p_raffle and a.worker_id = p_worker
        and a.action_type = 'raffle_restarted'
        and a.payload->>'request_id' = v_request::text
      order by a.created_at desc limit 1;
    if found then
      select * into v_next from public.raffles where id = (v_receipt->>'new_raffle_id')::uuid;
      if not found then raise exception 'No se pudo recuperar el reinicio. Actualiza el panel.'; end if;
      return jsonb_build_object('raffle', to_jsonb(v_next), 'already_reset', true);
    end if;
  end if;

  if v_raffle.status <> 'active' then
    raise exception 'Este sorteo ya está archivado. Actualiza el panel para ver el sorteo actual.';
  end if;

  if p_action = 'reset' then
    if exists (select 1 from public.raffle_prizes where raffle_id = p_raffle
      and selected_at is not null and confirmed_at is null) then
      raise exception 'Hay un ganador pendiente. Confírmalo o cancela su selección antes de reiniciar.';
    end if;
    update public.raffles set status = 'closed', updated_at = now() where id = p_raffle;
    insert into public.raffles(title, status, max_number, created_by_worker_id, allow_repeat_winners)
      values ('Sorteo · ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'),
        'active', 40, p_worker, false) returning * into v_next;
    insert into public.raffle_selection_audit(worker_id, action_type, entity_type, entity_id, payload)
      values (p_worker, 'raffle_restarted', 'raffle_selection', p_raffle,
        jsonb_build_object('request_id', v_request, 'new_raffle_id', v_next.id,
          'previous_title', v_raffle.title, 'new_title', v_next.title, 'max_number', 40));
    return jsonb_build_object('raffle', to_jsonb(v_next), 'already_reset', false);
  elsif p_action = 'extend' then
    if v_raffle.max_number >= 10000 then raise exception 'Se alcanzó el máximo de 10.000 números.'; end if;
    update public.raffles set max_number = max_number + 40, updated_at = now()
      where id = p_raffle returning * into v_next;
    return jsonb_build_object('max_number', v_next.max_number);
  end if;

  if jsonb_typeof(p_data->'raffle_number') is distinct from 'number'
    or coalesce(p_data->>'raffle_number', '') !~ '^[0-9]{1,5}$'
    or coalesce(p_data->>'client_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Número o cliente inválido.';
  end if;
  v_number := (p_data->>'raffle_number')::integer;
  if v_number < 1 or v_number > v_raffle.max_number then raise exception 'Número de sorteo inválido.'; end if;
  select * into v_client from public.crm_clientes where id = (p_data->>'client_id')::uuid;
  if not found then raise exception 'No encontramos la ficha del cliente.'; end if;
  insert into public.raffle_entries(raffle_id, raffle_number, client_id, client_auth_user_id, assigned_by_worker_id)
    values (p_raffle, v_number, v_client.id, v_client.auth_user_id, p_worker) returning * into v_entry;
  return jsonb_build_object('entry', to_jsonb(v_entry) || jsonb_build_object('client',
    jsonb_build_object('id', v_client.id, 'nombre', v_client.nombre, 'apellido', v_client.apellido,
      'telefono', v_client.telefono, 'telefono_normalizado', v_client.telefono_normalizado, 'email', v_client.email)));
end;
$$;

revoke all on function public.tc_raffle_manage(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tc_raffle_manage(uuid, uuid, text, jsonb) to service_role;
