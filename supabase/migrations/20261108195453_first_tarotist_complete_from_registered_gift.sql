-- A recorded welcome consultation fulfils only its existing reservation.
-- The gift ledger is inserted at the end of the canonical registration RPC,
-- after the call and its minute accounting have succeeded, in one transaction.
-- No gift, minute, Coin, purchase or global first-consultation policy is changed.

alter table public.first_tarotist_reservations
  add column completion_source text,
  add column completion_gift_use_id uuid references public.crm_new_tarotista_gift_uses(id),
  add column completion_rendimiento_id uuid references public.rendimiento_llamadas(id),
  add column completion_cliente_id uuid references public.crm_clientes(id),
  add constraint first_tarotist_completion_source_check check (
    completion_source is null or (
      completion_source = 'registered_new_tarotista_gift'
      and completion_gift_use_id is not null
      and completion_rendimiento_id is not null
      and completion_cliente_id is not null
    )
  );

create unique index first_tarotist_completion_gift_idx
  on public.first_tarotist_reservations(completion_gift_use_id)
  where completion_gift_use_id is not null;
create index first_tarotist_completion_rendimiento_idx
  on public.first_tarotist_reservations(completion_rendimiento_id)
  where completion_rendimiento_id is not null;
create index first_tarotist_completion_cliente_idx
  on public.first_tarotist_reservations(completion_cliente_id)
  where completion_cliente_id is not null;
create index crm_clientes_reservation_phone_digits_idx
  on public.crm_clientes ((pg_catalog.regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')));
create index crm_clientes_reservation_normalized_phone_digits_idx
  on public.crm_clientes ((pg_catalog.regexp_replace(coalesce(telefono_normalizado, ''), '[^0-9]', '', 'g')));

create function public.tc_complete_first_tarotist_from_gift(p_gift_use_id uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $function$
declare
  gift public.crm_new_tarotista_gift_uses%rowtype;
  client public.crm_clientes%rowtype;
  reservation public.first_tarotist_reservations%rowtype;
  phone_keys text[];
  matching_ids uuid[];
  completed_id uuid;
begin
  -- Call identity is evidence, not a name supplied by the browser.
  select u.* into gift
  from public.crm_new_tarotista_gift_uses u
  join public.rendimiento_llamadas registered_call on registered_call.id = u.rendimiento_id
    and registered_call.cliente_id = u.cliente_id::text
    and registered_call.tarotista_worker_id = u.tarotista_worker_id::text
    and (coalesce(registered_call.tiempo, 0) > 0
      or coalesce(registered_call.minutos_1, 0) + coalesce(registered_call.minutos_2, 0) > 0)
  where u.id = p_gift_use_id and u.minutes > 0;
  if not found then return null; end if;

  -- Keep the canonical lock order: CRM client before reservation.
  select * into client from public.crm_clientes where id = gift.cliente_id for update;
  if not found then return null; end if;
  if exists (select 1 from public.first_tarotist_reservations r
    where r.completion_gift_use_id = gift.id) then return null; end if;
  -- Both full numbers are existing CRM aliases. Do not let a stale normalized
  -- field hide a reservation made with the phone visibly stored in the ficha.
  select array_agg(distinct normalized.phone) into phone_keys
  from (values (client.telefono), (client.telefono_normalizado)) supplied(phone)
  cross join lateral (select pg_catalog.regexp_replace(coalesce(supplied.phone, ''), '[^0-9]', '', 'g') phone) normalized
  where length(normalized.phone) >= 6;
  if phone_keys is null then return null; end if;
  -- A shared/duplicated phone must be resolved in CRM, never guessed by name.
  if exists (
    select 1 from public.crm_clientes other
    where other.id <> client.id
      and (pg_catalog.regexp_replace(coalesce(other.telefono, ''), '[^0-9]', '', 'g') = any(phone_keys)
        or pg_catalog.regexp_replace(coalesce(other.telefono_normalizado, ''), '[^0-9]', '', 'g') = any(phone_keys))
  ) then return null; end if;

  -- The canonical welcome-gift RPC belongs to Celestial. Preserve other brands,
  -- cancellations, no-shows, manual closures and bookings created after a gift.
  select array_agg(r.id) into matching_ids from public.first_tarotist_reservations r
  where r.brand = 'celestial'
    and r.tarotista_id = gift.tarotista_worker_id
    and r.client_key in (select 'phone:' || p from unnest(phone_keys) p)
    and (nullif(r.phone, '') is null
      or r.client_key = 'phone:' || pg_catalog.regexp_replace(r.phone, '[^0-9]', '', 'g'))
    and r.status in ('pendiente', 'confirmada', 'aplazada')
    and r.free_consult_used is false
    and r.completion_source is null
    and r.created_at <= gift.created_at;
  -- Two phone aliases with separate reservations are ambiguous; staff must
  -- resolve them rather than silently completing several bookings.
  if coalesce(cardinality(matching_ids), 0) <> 1 then return null; end if;
  select * into reservation from public.first_tarotist_reservations r
  where r.id = matching_ids[1] for update;
  if not found then return null; end if;

  update public.first_tarotist_reservations
  set status = 'cumplida',
      free_consult_used = true,
      free_consult_used_at = gift.created_at,
      completed_at = gift.created_at,
      updated_at = now(),
      updated_by_worker_id = gift.worker_id,
      completion_source = 'registered_new_tarotista_gift',
      completion_gift_use_id = gift.id,
      completion_rendimiento_id = gift.rendimiento_id,
      completion_cliente_id = gift.cliente_id,
      notes = concat_ws(E'\n', nullif(notes, ''),
        format('Cierre automático: consulta con nueva tarotista registrada. Registro de llamada: %s. Operación: %s.',
          gift.rendimiento_id, gift.operation_id))
  where id = reservation.id
    and brand = 'celestial'
    and tarotista_id = gift.tarotista_worker_id
    and client_key in (select 'phone:' || p from unnest(phone_keys) p)
    and (nullif(phone, '') is null
      or client_key = 'phone:' || pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g'))
    and created_at <= gift.created_at
    and status in ('pendiente', 'confirmada', 'aplazada')
    and free_consult_used is false
    and completion_source is null
  returning id into completed_id;
  return completed_id;
end;
$function$;

create function public.tc_sync_first_tarotist_after_gift()
returns trigger
language plpgsql security invoker set search_path = ''
as $function$
begin
  perform public.tc_complete_first_tarotist_from_gift(new.id);
  return new;
end;
$function$;

revoke all on function public.tc_complete_first_tarotist_from_gift(uuid),
  public.tc_sync_first_tarotist_after_gift() from public, anon, authenticated;
grant execute on function public.tc_complete_first_tarotist_from_gift(uuid),
  public.tc_sync_first_tarotist_after_gift() to service_role;

create trigger trg_first_tarotist_complete_registered_gift
after insert on public.crm_new_tarotista_gift_uses
for each row execute function public.tc_sync_first_tarotist_after_gift();

comment on column public.first_tarotist_reservations.completion_gift_use_id is
  'Audited source of automatic completion. Only recorded new-tarotista gifts; no reward is issued by reservation completion.';

-- Historical reservations are deliberately not changed by this migration.
-- A separately reviewed reconciliation may call the same guarded helper using
-- evidence from the immutable gift ledger, without replaying any registration.
