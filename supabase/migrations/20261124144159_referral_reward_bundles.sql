begin;

alter table public.client_referral_rewards add column reward_items jsonb;

-- Normalize the catalog definition before it can enter a balance or ledger.
-- Each balance or rank can be granted once per bundle, and each roulette level
-- can appear once with its own quantity.
create function public.tc_referral_reward_items(p_items jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare
  v_item jsonb;
  v_type text;
  v_amount integer;
  v_level integer;
  v_rank text;
  v_days integer;
  v_key text;
  v_seen text[] := '{}';
  v_items jsonb := '[]';
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'REFERRAL_INVALID_REWARD';
  end if;
  if jsonb_array_length(p_items) not between 1 and 10 then
    raise exception 'REFERRAL_INVALID_REWARD';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_type := v_item->>'reward_type';
    if v_type is null or v_type not in ('free_minutes','normal_minutes','coins','oracle','roulette','rank')
      or coalesce(v_item->>'amount','') !~ '^[1-9][0-9]{0,6}$' then
      raise exception 'REFERRAL_INVALID_REWARD';
    end if;
    v_amount := (v_item->>'amount')::integer;
    if v_amount > (case v_type when 'coins' then 1000000 when 'free_minutes' then 10000
      when 'normal_minutes' then 10000 when 'rank' then 1 else 100 end) then
      raise exception 'REFERRAL_INVALID_REWARD';
    end if;

    v_level := null;
    v_rank := null;
    v_days := null;
    v_key := v_type;
    if v_type='roulette' then
      if coalesce(v_item->>'roulette_level','') !~ '^[1-5]$' then
        raise exception 'REFERRAL_INVALID_REWARD';
      end if;
      v_level := (v_item->>'roulette_level')::integer;
      v_key := 'roulette:'||v_level;
    elsif v_type='rank' then
      v_rank := v_item->>'rank_key';
      if v_rank is null or v_rank not in ('oro','diamante')
        or coalesce(v_item->>'rank_days','') !~ '^[1-9][0-9]{0,2}$' then
        raise exception 'REFERRAL_INVALID_REWARD';
      end if;
      v_days := (v_item->>'rank_days')::integer;
      if v_days>365 then raise exception 'REFERRAL_INVALID_REWARD'; end if;
    end if;

    if v_key=any(v_seen) then raise exception 'REFERRAL_INVALID_REWARD'; end if;
    v_seen := array_append(v_seen,v_key);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'reward_type',v_type,'amount',v_amount,'roulette_level',v_level,'rank_key',v_rank,'rank_days',v_days
    ));
  end loop;
  return v_items;
end;
$$;

revoke all on function public.tc_referral_reward_items(jsonb) from public,anon,authenticated;
grant execute on function public.tc_referral_reward_items(jsonb) to service_role;

alter table public.client_referral_rewards add constraint client_referral_reward_items_valid
  check (reward_items is null or (
    reward_items=public.tc_referral_reward_items(reward_items) and
    reward_items->0=jsonb_build_object('reward_type',reward_type,'amount',amount,
      'roulette_level',roulette_level,'rank_key',rank_key,'rank_days',rank_days)
  ));

create or replace function public.tc_save_referral_reward(
  p_reward_id uuid,p_expected_version integer,p_data jsonb,
  p_actor_worker_id uuid,p_actor_user_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.client_referral_rewards%rowtype; v_new public.client_referral_rewards%rowtype;
  v_event public.client_referral_reward_events%rowtype; v_request jsonb;
  v_items jsonb;
  v_primary jsonb;
begin
  if not exists(select 1 from public.workers where id=p_actor_worker_id and user_id=p_actor_user_id
    and is_active is distinct from false and (role='admin' or public.tc_worker_has_admin_access(id)))
  then raise exception 'REFERRAL_FORBIDDEN'; end if;
  if p_reward_id is null or p_operation_id is null or jsonb_typeof(p_data) is distinct from 'object'
    or coalesce(p_data->>'referrals_required','') !~ '^[1-9][0-9]{0,3}$'
    or jsonb_typeof(p_data->'enabled') is distinct from 'boolean'
  then raise exception 'REFERRAL_INVALID_REWARD'; end if;
  if p_data ? 'reward_items' then
    v_items := public.tc_referral_reward_items(p_data->'reward_items');
  else
    -- Old clients provide a single benefit at the top level.
    v_items := public.tc_referral_reward_items(jsonb_build_array(p_data));
  end if;
  v_primary := v_items->0;
  v_request:=jsonb_build_object('reward_id',p_reward_id,'expected_version',p_expected_version,
    'data',p_data,'actor_user_id',p_actor_user_id);
  perform pg_advisory_xact_lock(hashtextextended('referral-operation:'||p_operation_id,0));
  select * into v_event from public.client_referral_reward_events where operation_id=p_operation_id;
  if found then
    if v_event.request is distinct from v_request or v_event.actor_worker_id<>p_actor_worker_id then raise exception 'REFERRAL_OPERATION_REUSED'; end if;
    return v_event.after_state;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-catalog:'||p_reward_id,0));
  select * into v_old from public.client_referral_rewards where id=p_reward_id for update;
  if (v_old.id is null and coalesce(p_expected_version,0)<>0)
    or (v_old.id is not null and v_old.version is distinct from p_expected_version) then raise exception 'REFERRAL_REWARD_CHANGED'; end if;
  -- An admin tab opened before bundles existed can only display the first item.
  if not (p_data ? 'reward_items') and jsonb_array_length(v_old.reward_items)>1 then
    raise exception 'REFERRAL_REWARD_CHANGED';
  end if;
  insert into public.client_referral_rewards(
    id,title,referrals_required,reward_type,amount,roulette_level,rank_key,rank_days,
    reward_items,enabled,created_by,updated_by
  ) values (
    p_reward_id,btrim(coalesce(p_data->>'title','')),(p_data->>'referrals_required')::integer,
    v_primary->>'reward_type',(v_primary->>'amount')::integer,(v_primary->>'roulette_level')::integer,
    v_primary->>'rank_key',(v_primary->>'rank_days')::integer,v_items,
    (p_data->>'enabled')::boolean,p_actor_worker_id,p_actor_worker_id
  )
  on conflict(id) do update set title=excluded.title,referrals_required=excluded.referrals_required,
    reward_type=excluded.reward_type,amount=excluded.amount,roulette_level=excluded.roulette_level,
    rank_key=excluded.rank_key,rank_days=excluded.rank_days,reward_items=excluded.reward_items,enabled=excluded.enabled,
    updated_by=p_actor_worker_id,version=client_referral_rewards.version+1,updated_at=clock_timestamp()
  returning * into v_new;
  insert into public.client_referral_reward_events(operation_id,reward_id,actor_worker_id,request,before_state,after_state)
    values(p_operation_id,p_reward_id,p_actor_worker_id,v_request,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return to_jsonb(v_new);
end;
$$;

create or replace function public.tc_claim_referral_reward(
  p_cliente_id uuid,p_auth_user_id uuid,p_reward_id uuid,p_expected_version integer,p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_client public.crm_clientes%rowtype; v_reward public.client_referral_rewards%rowtype;
  v_prior public.client_referral_claims%rowtype; v_refs uuid[]; v_ref_clients uuid[]; v_receipt jsonb;
  v_before integer; v_after integer; v_rank_state jsonb; v_rank_id uuid; v_rank_end timestamptz;
  v_spin_ids uuid[]; v_message text; v_total bigint;
  v_items jsonb; v_item record; v_item_receipt jsonb; v_delivered jsonb:='[]'::jsonb;
  v_consumed integer;
begin
  if p_cliente_id is null or p_auth_user_id is null or p_reward_id is null or p_operation_id is null then raise exception 'REFERRAL_INVALID_INPUT'; end if;
  if not exists(select 1 from public.crm_clientes where id=p_cliente_id and auth_user_id=p_auth_user_id)
    or (select count(*) from public.crm_clientes where auth_user_id=p_auth_user_id)<>1 then raise exception 'REFERRAL_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-claim:'||p_operation_id,0));
  select * into v_prior from public.client_referral_claims where id=p_operation_id;
  if found then
    if v_prior.cliente_id<>p_cliente_id or v_prior.auth_user_id<>p_auth_user_id or v_prior.reward_id<>p_reward_id
      or v_prior.reward_version is distinct from p_expected_version then raise exception 'REFERRAL_OPERATION_REUSED'; end if;
    return v_prior.receipt||jsonb_build_object('replayed',true);
  end if;
  -- Existing rank and oracle writers use these client advisory keys before balances.
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text,0));
  perform pg_advisory_xact_lock(hashtext(p_cliente_id::text));
  select * into v_client from public.crm_clientes where id=p_cliente_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'REFERRAL_FORBIDDEN'; end if;
  select * into v_reward from public.client_referral_rewards where id=p_reward_id for share;
  if not found or not v_reward.enabled then raise exception 'REFERRAL_REWARD_UNAVAILABLE'; end if;
  if v_reward.version is distinct from p_expected_version then raise exception 'REFERRAL_REWARD_CHANGED'; end if;
  select array_agg(s.id order by s.created_at,s.id),array_agg(s.referred_id order by s.created_at,s.id)
    into v_refs,v_ref_clients from (
      select r.id,r.referred_id,r.created_at from public.client_referrals r
      where r.referrer_id=p_cliente_id and r.claimed_by is null and public.tc_referral_paid_total(r.referred_id)>10
      order by r.created_at,r.id limit v_reward.referrals_required for update
    ) s;
  if coalesce(cardinality(v_refs),0)<>v_reward.referrals_required then raise exception 'REFERRAL_NOT_ENOUGH'; end if;
  -- Freeze only the purchase evidence selected for this claim. Refund/edit writers
  -- must finish before the eligibility recheck; later refunds never undo a receipt.
  perform 1 from public.crm_cliente_pagos where cliente_id=any(v_ref_clients) order by id for share;
  perform 1 from public.rendimiento_llamadas where btrim(coalesce(cliente_id,''))=any(select x::text from unnest(v_ref_clients) x) order by id for share;
  if exists(select 1 from unnest(v_ref_clients) c where public.tc_referral_paid_total(c)<=10) then raise exception 'REFERRAL_NOT_ENOUGH'; end if;
  v_items:=coalesce(v_reward.reward_items, public.tc_referral_reward_items(jsonb_build_array(to_jsonb(v_reward))));
  insert into public.client_referral_claims(id,cliente_id,auth_user_id,reward_id,reward_version,reward_snapshot,referral_ids)
    values(p_operation_id,p_cliente_id,p_auth_user_id,p_reward_id,v_reward.version,to_jsonb(v_reward)||jsonb_build_object('reward_items',v_items),v_refs);
  v_message:='Premio de referidos · '||v_reward.title;
  v_receipt:=jsonb_build_object('claim_id',p_operation_id,'reward_id',v_reward.id,'title',v_reward.title,
    'reward_type',v_reward.reward_type,'amount',v_reward.amount,'referrals_used',v_reward.referrals_required,
    'created_at',clock_timestamp());
  for v_item in
    select * from jsonb_to_recordset(v_items) as benefit(
      reward_type text, amount integer, roulette_level integer, rank_key text, rank_days integer
    )
  loop
    v_item_receipt:=to_jsonb(v_item);
    if v_item.reward_type='rank' then
      v_rank_state:=public.tc_client_rank_state(p_cliente_id);
      if exists(select 1 from public.client_rank_overrides where client_id=p_cliente_id and active and (ends_at is null or ends_at>now()))
        or coalesce(array_position(array['bronce','plata','oro','diamante'],v_rank_state->>'effective'),0)
          >=array_position(array['bronce','plata','oro','diamante'],v_item.rank_key)
      then raise exception 'REFERRAL_RANK_CONFLICT'; end if;
    end if;
    if v_item.reward_type in ('free_minutes','normal_minutes','coins') then
      v_before:=case v_item.reward_type when 'free_minutes' then coalesce(v_client.minutos_free_pendientes,0)
        when 'normal_minutes' then coalesce(v_client.minutos_normales_pendientes,0) else coalesce(v_client.puntos,0) end;
      v_total:=v_before::bigint+v_item.amount;
      if v_total>2147483647 then raise exception 'REFERRAL_BALANCE_LIMIT'; end if;
      v_after:=v_total::integer;
      if v_item.reward_type='free_minutes' then update public.crm_clientes set minutos_free_pendientes=v_after,updated_at=now() where id=p_cliente_id;
      elsif v_item.reward_type='normal_minutes' then update public.crm_clientes set minutos_normales_pendientes=v_after,updated_at=now() where id=p_cliente_id;
      else
        update public.crm_clientes set puntos=v_after,updated_at=now() where id=p_cliente_id;
        insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta)
          values(p_cliente_id,'ganado',v_item.amount,v_message,p_operation_id,v_after,
            jsonb_build_object('source','referral_reward','claim_id',p_operation_id,'reward_id',p_reward_id));
      end if;
      v_item_receipt:=v_item_receipt||jsonb_build_object('before_balance',v_before,'after_balance',v_after);
    elsif v_item.reward_type='oracle' then
      v_before:=public.get_cliente_oracle_balance(p_cliente_id);
      if v_before::bigint+v_item.amount>2147483647 then raise exception 'REFERRAL_BALANCE_LIMIT'; end if;
      insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,notes,meta)
        values(p_cliente_id,v_item.amount,'adjustment','referral:'||p_operation_id,v_message,
          jsonb_build_object('source','referral_reward','claim_id',p_operation_id,'reward_id',p_reward_id));
      v_after:=public.get_cliente_oracle_balance(p_cliente_id);
      if v_after<>v_before+v_item.amount then raise exception 'REFERRAL_DELIVERY_MISMATCH'; end if;
      v_item_receipt:=v_item_receipt||jsonb_build_object('before_balance',v_before,'after_balance',v_after);
    elsif v_item.reward_type='roulette' then
      with added as (
        insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank)
        select p_cliente_id,'referral:'||p_operation_id||':'||v_item.roulette_level||':'||i,'referral_reward',v_item.roulette_level,'pending',
          case when v_item.roulette_level=5 then 'diamante' else null end from generate_series(1,v_item.amount) i returning id
      ) select array_agg(id) into v_spin_ids from added;
      v_item_receipt:=v_item_receipt||jsonb_build_object('roulette_level',v_item.roulette_level,'spin_ids',v_spin_ids);
    elsif v_item.reward_type='rank' then
      v_rank_end:=now()+make_interval(days=>v_item.rank_days);
      v_rank_id:=public.set_client_rank_override(v_item.rank_key,p_cliente_id,v_reward.created_by,v_rank_end,'temporary',
        'referral:'||p_operation_id,v_message,now());
      v_item_receipt:=v_item_receipt||jsonb_build_object('rank_key',v_item.rank_key,'rank_days',v_item.rank_days,'rank_ends_at',v_rank_end,'rank_override_id',v_rank_id);
    end if;
    v_delivered:=v_delivered||jsonb_build_array(v_item_receipt);
  end loop;
  -- Keep the original top-level receipt contract for single-benefit consumers.
  v_receipt:=v_receipt||(v_delivered->0)||jsonb_build_object('reward_items',v_delivered);
  update public.client_referrals set claimed_by=p_operation_id where id=any(v_refs) and claimed_by is null;
  get diagnostics v_consumed = row_count;
  if v_consumed<>v_reward.referrals_required then raise exception 'REFERRAL_NOT_ENOUGH'; end if;
  update public.client_referral_claims set receipt=v_receipt where id=p_operation_id;
  insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data,is_pinned)
    values(p_cliente_id::text,v_message||'. Reclamado con '||v_reward.referrals_required||' referido(s).','Sistema','referral_reward_claimed',v_receipt,false);
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,leida,meta,created_at)
    values(p_cliente_id,'referral_reward','Premio de referidos reclamado',v_reward.title||'. Tu premio ya está disponible.',false,v_receipt,now());
  perform public.tc_touch_roulette_signal(p_cliente_id);
  return v_receipt||jsonb_build_object('replayed',false);
end;
$$;

notify pgrst,'reload schema';
commit;
