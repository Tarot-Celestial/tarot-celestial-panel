CREATE OR REPLACE FUNCTION public.admin_gift_client_coins(p_client_id uuid, p_admin_worker_id uuid, p_amount integer, p_reason text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_balance integer;
  v_existing record;
  v_movement_id text;
  v_client_name text;
begin
  if p_client_id is null or p_admin_worker_id is null or p_operation_id is null then
    raise exception 'GIFT_REQUIRED_FIELDS';
  end if;
  if p_amount < 1 or p_amount > 1000000 then
    raise exception 'COIN_AMOUNT_INVALID';
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception 'COIN_REASON_INVALID';
  end if;
  if not exists (
    select 1 from public.workers w
    where w.id = p_admin_worker_id
      and w.role = 'admin'
      and coalesce(w.is_active, true) = true
  ) then
    raise exception 'ADMIN_NOT_ALLOWED';
  end if;

  -- Serializa reintentos simultáneos de la misma operación.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select h.id, h.saldo_despues, h.cliente_id, h.puntos
    into v_existing
  from public.cliente_puntos_historial h
  where h.operation_id = p_operation_id;

  if found then
    if v_existing.cliente_id <> p_client_id or v_existing.puntos <> p_amount then
      raise exception 'OPERATION_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'duplicated', true,
      'movement_id', v_existing.id,
      'balance', coalesce(v_existing.saldo_despues, 0)
    );
  end if;

  update public.crm_clientes c
  set puntos = coalesce(c.puntos, 0) + p_amount,
      updated_at = now()
  where c.id = p_client_id
  returning coalesce(c.puntos, 0), concat_ws(' ', c.nombre, c.apellido)
    into v_balance, v_client_name;

  if not found then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  insert into public.cliente_puntos_historial (
    cliente_id, tipo, puntos, descripcion, operation_id,
    admin_worker_id, saldo_despues, meta, created_at
  ) values (
    p_client_id,
    'regalo_admin',
    p_amount,
    'Regalo de administración: ' || btrim(p_reason),
    p_operation_id,
    p_admin_worker_id,
    v_balance,
    jsonb_build_object('source', 'admin_client_web', 'reason', btrim(p_reason)),
    now()
  ) returning id::text into v_movement_id;

  insert into public.cliente_notificaciones (
    cliente_id, tipo, titulo, mensaje, leida, meta, created_at
  ) values (
    p_client_id,
    'coin_gift',
    '¡Tienes un obsequio!',
    'Has recibido +' || p_amount || ' Coins. ' || btrim(p_reason) ||
      ' Nuevo saldo: ' || v_balance || ' Coins.',
    false,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'amount', p_amount,
      'balance', v_balance,
      'reason', btrim(p_reason),
      'admin_worker_id', p_admin_worker_id
    ),
    now()
  );

  return jsonb_build_object(
    'duplicated', false,
    'movement_id', v_movement_id,
    'client_name', nullif(btrim(v_client_name), ''),
    'amount', p_amount,
    'balance', v_balance
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tc_emit_client_state_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cliente_id uuid;
begin
  if tg_table_name='crm_clientes' then
    v_cliente_id := coalesce(new.id,old.id);
  elsif tg_table_name='client_rank_overrides' then
    v_cliente_id := coalesce(new.client_id,old.client_id);
  else
    v_cliente_id := coalesce(new.cliente_id,old.cliente_id);
  end if;

  if v_cliente_id is not null then
    perform public.tc_touch_roulette_signal(v_cliente_id);
  end if;
  return coalesce(new,old);
end $function$;

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