-- ============================================================
-- TAROT CELESTIAL · RULETA DIAMANTE POR COMPRA
-- 01 · GIRO DIAMANTE AUTOMÁTICO POR CADA COMPRA VÁLIDA
--
-- Regla funcional:
--   * Si un cliente es Diamante en el momento de una compra completed,
--     obtiene 1 giro de Ruleta Diamante.
--   * Este giro coexiste con los giros normales y con cualquier otro bonus.
--   * El giro ya ganado pertenece al cliente aunque después pierda el rango.
--     Por eso se registra con metadata de origen Diamante, pero sin bloquear
--     su uso futuro por required_rank.
--   * No se destruyen premios ni giros ya concedidos al cambiar de rango.
-- ============================================================
begin;
create extension if not exists pgcrypto;

do $$ begin
  if to_regprocedure('public.tc_client_rank_state(uuid)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: tc_client_rank_state(uuid)'; end if;
  if to_regprocedure('public.tc_touch_roulette_signal(uuid)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: tc_touch_roulette_signal(uuid)'; end if;
  if to_regclass('public.crm_cliente_pagos') is null then raise exception 'MISSING_REQUIRED_TABLE: crm_cliente_pagos'; end if;
  if to_regclass('public.cliente_ruleta_giros') is null then raise exception 'MISSING_REQUIRED_TABLE: cliente_ruleta_giros'; end if;
  if to_regclass('public.tc_client_benefit_events') is null then raise exception 'MISSING_REQUIRED_TABLE: tc_client_benefit_events'; end if;
end $$;

alter table public.tc_client_benefit_events add column if not exists delivery_key text;
create unique index if not exists uq_tc_client_benefit_delivery_key
  on public.tc_client_benefit_events(delivery_key)
  where delivery_key is not null;

create or replace function public.tc_grant_diamond_purchase_spin()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_rank jsonb;
  v_effective text;
  v_delivery_key text;
  v_spin_id uuid;
  v_event_id uuid;
begin
  if lower(coalesce(new.estado,'')) <> 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and lower(coalesce(old.estado,'')) = 'completed' then
    return new;
  end if;

  if coalesce(new.importe,0) <= 0 or new.cliente_id is null then
    return new;
  end if;

  v_rank := public.tc_client_rank_state(new.cliente_id);
  v_effective := coalesce(v_rank->>'effective','');
  if v_effective <> 'diamante' then
    return new;
  end if;

  v_delivery_key := 'diamond-purchase:' || new.id::text;

  if exists(
    select 1
    from public.tc_client_benefit_events e
    where e.delivery_key = v_delivery_key
  ) then
    return new;
  end if;

  insert into public.cliente_ruleta_giros(
    cliente_id,
    payment_key,
    source,
    nivel,
    purchase_id,
    purchase_amount,
    purchase_currency,
    estado,
    required_rank
  ) values (
    new.cliente_id,
    v_delivery_key || ':spin:1',
    'diamond_rank_purchase',
    4,
    new.id,
    new.importe,
    new.moneda,
    'pending',
    null
  ) returning id into v_spin_id;

  insert into public.tc_client_benefit_events(
    cliente_id,
    payment_id,
    rank_at_event,
    benefit_key,
    benefit_type,
    purchase_amount,
    currency,
    spin_id,
    delivery_key,
    snapshot
  ) values (
    new.cliente_id,
    new.id,
    'diamante',
    'diamond_purchase_spin',
    'roulette',
    new.importe,
    new.moneda,
    v_spin_id,
    v_delivery_key,
    jsonb_build_object(
      'source','diamond_rank_purchase',
      'spin_level',4,
      'awarded_because','valid_purchase_while_diamond',
      'retained_if_rank_lost',true,
      'rank_state',v_rank
    )
  ) returning id into v_event_id;

  perform public.tc_touch_roulette_signal(new.cliente_id);

  insert into public.cliente_notificaciones(
    cliente_id,
    tipo,
    titulo,
    mensaje,
    meta,
    leida,
    created_at
  ) values (
    new.cliente_id,
    'diamond_purchase_spin',
    'Nuevo giro de Ruleta Diamante',
    'Tu compra válida como cliente Diamante te ha concedido 1 giro de Ruleta Diamante.',
    jsonb_build_object(
      'payment_id',new.id,
      'spin_id',v_spin_id,
      'benefit_event_id',v_event_id,
      'retained_if_rank_lost',true
    ),
    false,
    now()
  );

  return new;
exception when unique_violation then
  return new;
end $$;

drop trigger if exists trg_tc_grant_diamond_purchase_spin on public.crm_cliente_pagos;
create trigger trg_tc_grant_diamond_purchase_spin
after insert or update of estado on public.crm_cliente_pagos
for each row
execute function public.tc_grant_diamond_purchase_spin();

revoke all on function public.tc_grant_diamond_purchase_spin() from public,anon,authenticated;
grant execute on function public.tc_grant_diamond_purchase_spin() to service_role;
notify pgrst,'reload schema';
commit;
