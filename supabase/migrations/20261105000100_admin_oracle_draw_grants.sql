begin;

create or replace function public.tc_admin_grant_oracle_draws(
  p_operation_id uuid,
  p_cliente_id uuid,
  p_actor_user_id uuid,
  p_amount numeric,
  p_reason text
) returns jsonb
language plpgsql security invoker
set search_path = ''
as $function$
declare
  actor public.workers%rowtype;
  movement public.cliente_oracle_credit_movements%rowtype;
  grant_reference text := 'admin:oracle:tiradas:' || p_operation_id::text;
  clean_reason text := btrim(coalesce(p_reason, ''));
  balance_before integer;
  balance_after integer;
  receipt jsonb;
begin
  if p_operation_id is null or p_cliente_id is null or p_actor_user_id is null then
    raise exception 'INVALID_ADJUSTMENT';
  end if;
  if p_amount is null or p_amount <> trunc(p_amount) or p_amount not between 1 and 100 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if char_length(clean_reason) not between 3 and 500 then raise exception 'INVALID_REASON'; end if;

  select * into actor from public.workers
    where user_id = p_actor_user_id and role = 'admin' and is_active is distinct from false for share;
  if not found then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended(grant_reference, 0));
  select * into movement from public.cliente_oracle_credit_movements where reference = grant_reference;
  if found then
    if movement.cliente_id <> p_cliente_id or movement.amount <> p_amount
      or movement.movement_type <> 'adjustment' or movement.notes is distinct from clean_reason
      or movement.meta->>'source' is distinct from 'admin_client_balances'
      or movement.meta->>'actor_user_id' is distinct from p_actor_user_id::text
      or movement.meta->>'actor_worker_id' is distinct from actor.id::text then
      raise exception 'OPERATION_CONFLICT';
    end if;
    return movement.meta || jsonb_build_object('movement_id',movement.id,'created_at',movement.created_at,'replayed',true);
  end if;

  -- Same per-customer lock as consume_cliente_oracle_credit. The parent-row
  -- FOR UPDATE also serializes inserts from purchase grants via their client FK.
  perform pg_advisory_xact_lock(hashtext(p_cliente_id::text));
  perform 1 from public.crm_clientes where id = p_cliente_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  balance_before := public.get_cliente_oracle_balance(p_cliente_id);
  if balance_before::bigint + p_amount > 2147483647 then raise exception 'ORACLE_BALANCE_LIMIT'; end if;
  balance_after := balance_before + p_amount::integer;
  receipt := jsonb_build_object(
    'source','admin_client_balances','operation_id',p_operation_id,'cliente_id',p_cliente_id,
    'actor_user_id',p_actor_user_id,'actor_worker_id',actor.id,
    'actor_name',coalesce(nullif(btrim(actor.display_name),''),'Administración'),
    'reason',clean_reason,'amount',p_amount::integer,
    'before_balance',balance_before,'after_balance',balance_after
  );
  insert into public.cliente_oracle_credit_movements
    (cliente_id,amount,movement_type,reference,notes,meta,created_at)
  values (p_cliente_id,p_amount::integer,'adjustment',grant_reference,clean_reason,receipt,clock_timestamp())
  returning * into movement;
  if public.get_cliente_oracle_balance(p_cliente_id) is distinct from balance_after then
    raise exception 'ORACLE_GRANT_CONTRACT_MISMATCH';
  end if;
  return receipt || jsonb_build_object('movement_id',movement.id,'created_at',movement.created_at,'replayed',false);
end;
$function$;

revoke all on function public.tc_admin_grant_oracle_draws(uuid,uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.tc_admin_grant_oracle_draws(uuid,uuid,uuid,numeric,text) to service_role;

commit;
