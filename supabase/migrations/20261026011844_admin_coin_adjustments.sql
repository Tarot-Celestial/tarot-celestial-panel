-- Additive admin-only entry point for manual Coins, independent of purchases.
-- Reuse the installed gift engine and canonical ledger without modifying either.
begin;

create table public.tc_admin_coin_adjustments (
  operation_id uuid primary key,
  cliente_id uuid not null references public.crm_clientes(id),
  actor_user_id uuid not null,
  actor_worker_id uuid not null,
  amount integer not null check (amount between 1 and 1000000),
  reason text not null check (char_length(reason) between 3 and 500 and reason=btrim(reason)),
  before_balance integer not null,
  after_balance integer not null,
  movement_id uuid not null unique references public.cliente_puntos_historial(id),
  note_id uuid not null unique references public.crm_client_notes(id),
  created_at timestamptz not null default now(),
  constraint tc_admin_coin_balance_delta check (after_balance::bigint=before_balance::bigint+amount)
);
create index tc_admin_coin_adjustments_client_date
  on public.tc_admin_coin_adjustments(cliente_id,created_at desc);
alter table public.tc_admin_coin_adjustments enable row level security;
revoke all on table public.tc_admin_coin_adjustments from public,anon,authenticated,service_role;
grant select,insert on table public.tc_admin_coin_adjustments to service_role;

create or replace function public.tc_admin_adjust_coins(
  p_operation_id uuid,
  p_cliente_id uuid,
  p_actor_user_id uuid,
  p_amount numeric,
  p_reason text
) returns jsonb
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  prior public.tc_admin_coin_adjustments%rowtype;
  actor public.workers%rowtype;
  movement public.cliente_puntos_historial%rowtype;
  gift jsonb;
  before_coins integer;
  after_coins integer;
  note_uuid uuid;
  audit_data jsonb;
  clean_reason text:=btrim(coalesce(p_reason,''));
begin
  if p_operation_id is null or p_cliente_id is null or p_actor_user_id is null then
    raise exception 'INVALID_ADJUSTMENT';
  end if;
  -- Numeric input prevents PostgreSQL from silently rounding a fractional JSON
  -- number to integer before validation at the RPC boundary.
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount<>trunc(p_amount) or p_amount<1 or p_amount>1000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if char_length(clean_reason) not between 3 and 500 then
    raise exception 'INVALID_REASON';
  end if;

  -- The server passes its verified auth user, never an actor from the browser.
  -- Resolve/lock the current worker record so a stale or revoked role cannot
  -- authorize the transaction. Keep the existing null-is-active convention.
  select * into actor from public.workers
    where user_id=p_actor_user_id and role='admin' and is_active is distinct from false
    for share;
  if not found then raise exception 'FORBIDDEN'; end if;

  -- Same operation lock as admin_gift_client_coins. This also serializes callers
  -- using the existing admin-gift entry point, preventing cross-route retries.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into prior from public.tc_admin_coin_adjustments where operation_id=p_operation_id;
  if found then
    if prior.cliente_id<>p_cliente_id or prior.actor_user_id<>p_actor_user_id
      or prior.actor_worker_id<>actor.id or prior.amount<>p_amount or prior.reason<>clean_reason then
      raise exception 'OPERATION_CONFLICT';
    end if;
    return to_jsonb(prior)||jsonb_build_object('replayed',true);
  end if;
  -- Never adopt another feature's receipt as a new manual adjustment.
  if exists(select 1 from public.cliente_puntos_historial where operation_id=p_operation_id) then
    raise exception 'OPERATION_CONFLICT';
  end if;

  select coalesce(puntos,0) into before_coins from public.crm_clientes
    where id=p_cliente_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  if before_coins::bigint+p_amount>2147483647 then raise exception 'COIN_BALANCE_LIMIT'; end if;
  after_coins:=(before_coins::bigint+p_amount)::integer;

  gift:=public.admin_gift_client_coins(p_cliente_id,actor.id,p_amount::integer,clean_reason,p_operation_id);
  select * into movement from public.cliente_puntos_historial where operation_id=p_operation_id;
  if gift is null or coalesce((gift->>'duplicated')::boolean,false)
    or movement.id is null or movement.cliente_id is distinct from p_cliente_id
    or movement.admin_worker_id is distinct from actor.id or movement.puntos is distinct from p_amount::integer
    or movement.saldo_despues is distinct from after_coins
    or gift->>'movement_id' is distinct from movement.id::text
    or (select puntos from public.crm_clientes where id=p_cliente_id) is distinct from after_coins then
    raise exception 'COIN_GIFT_CONTRACT_MISMATCH';
  end if;

  audit_data:=jsonb_build_object(
    'operation_id',p_operation_id,'cliente_id',p_cliente_id,
    'actor_user_id',p_actor_user_id,'actor_worker_id',actor.id,
    'amount',p_amount::integer,'reason',clean_reason,
    'before_balance',before_coins,'after_balance',after_coins,
    'movement_id',movement.id,'source','admin_client_balances'
  );
  insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,event_type,event_data,is_pinned)
  values(p_cliente_id::text,
    format('Coins añadidas manualmente por administración · +%s Coins · Saldo: %s → %s. Motivo: %s',p_amount::integer,before_coins,after_coins,clean_reason),
    p_actor_user_id,coalesce(nullif(btrim(actor.display_name),''),actor.email,'Admin'),
    'admin_coin_adjustment',audit_data,false)
  returning id into note_uuid;

  insert into public.tc_admin_coin_adjustments(
    operation_id,cliente_id,actor_user_id,actor_worker_id,amount,reason,
    before_balance,after_balance,movement_id,note_id
  ) values(
    p_operation_id,p_cliente_id,p_actor_user_id,actor.id,p_amount::integer,clean_reason,
    before_coins,after_coins,movement.id,note_uuid
  ) returning * into prior;

  -- The existing crm_clientes state trigger refreshes the shared client signal
  -- when puntos changes. No second signal write, purchase or spin is created.
  return to_jsonb(prior)||jsonb_build_object('replayed',false);
end $function$;

revoke all on function public.tc_admin_adjust_coins(uuid,uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.tc_admin_adjust_coins(uuid,uuid,uuid,numeric,text) to service_role;

comment on table public.tc_admin_coin_adjustments is
  'Append-only audit for admin manual Coins additions; preserves canonical gift ledger and CRM notes.';
comment on function public.tc_admin_adjust_coins(uuid,uuid,uuid,numeric,text) is
  'Service-only manual Coins addition with verified admin, canonical client lock, payload-bound idempotency and atomic audit.';

commit;
