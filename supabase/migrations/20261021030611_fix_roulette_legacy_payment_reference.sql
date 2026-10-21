begin;

-- Historical call-issued spins put rendimiento_llamadas.id in purchase_id.
-- The benefit ledger FK instead requires crm_cliente_pagos.id. Resolve only
-- verifiable, same-client references; a gift/orphan may legitimately have none.
-- Patch just that ledger insertion. The installed selection, access checks,
-- client -> spin locking, rewards, replay handling, owner and ACL stay intact.
do $migration$
declare
  v_oid regprocedure := to_regprocedure('public.cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint)');
  v_definition text;
  v_declaration text := '  v_has_balance boolean := false;';
  v_original_insert text := $original$  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,coins,minutes,oracle_credits,spin_id,snapshot)
  values(p_cliente_id,v_spin.purchase_id,public.tc_client_rank_state(p_cliente_id)->>'effective',
    'roulette_result:'||v_spin.id,'roulette_result',
    case when v_reward.reward_type='coins' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='minutes' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='oracle_credits' then round(v_reward.reward_value)::integer else 0 end,
    v_spin.id,to_jsonb(v_reward));$original$;
  v_new_insert text := $replacement$  -- Keep the original spin reference; only the audit FK is normalized.
  select p.id into v_payment_id
  from public.crm_cliente_pagos p
  where p.id=v_spin.purchase_id and p.cliente_id=p_cliente_id
  for key share;

  if v_payment_id is not null then
    v_payment_resolution := 'purchase_id';
  elsif v_spin.source in ('rendimiento_llamadas','crm_cliente_pagos') then
    v_payment_key_match := regexp_match(coalesce(v_spin.payment_key,''),
      '^(rendimiento|crm_pago):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i');

    if v_spin.source='rendimiento_llamadas' then
      if lower(v_payment_key_match[1])='rendimiento' then
        v_payment_call_id := v_payment_key_match[2]::uuid;
      end if;
      if v_spin.purchase_id is not null and v_payment_call_id is not null
         and v_spin.purchase_id<>v_payment_call_id then
        v_payment_resolution := 'conflicting_origin';
        v_payment_call_id := null;
      else
        v_payment_call_id := coalesce(v_spin.purchase_id,v_payment_call_id);
      end if;
    elsif lower(v_payment_key_match[1])='rendimiento' then
      v_payment_call_id := v_payment_key_match[2]::uuid;
    elsif lower(v_payment_key_match[1])='crm_pago' then
      v_payment_key_id := v_payment_key_match[2]::uuid;
    end if;

    if v_payment_call_id is not null then
      select array_agg(candidate.id) into v_payment_candidate_ids
      from (
        select p.id from public.crm_cliente_pagos p
        where p.cliente_id=p_cliente_id and p.estado='completed'
          and p.source_rendimiento_id=v_payment_call_id
        for key share
      ) candidate;
      if cardinality(v_payment_candidate_ids)=1 then
        v_payment_id := v_payment_candidate_ids[1];
        v_payment_resolution := 'source_rendimiento_id';
      elsif cardinality(v_payment_candidate_ids)>1 then
        v_payment_resolution := 'ambiguous_payment';
      end if;
    elsif v_payment_key_id is not null then
      select p.id into v_payment_id
      from public.crm_cliente_pagos p
      where p.id=v_payment_key_id and p.cliente_id=p_cliente_id and p.estado='completed'
      for key share;
      if v_payment_id is not null then v_payment_resolution := 'payment_key'; end if;
    end if;
  end if;

  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,coins,minutes,oracle_credits,spin_id,snapshot)
  values(p_cliente_id,v_payment_id,public.tc_client_rank_state(p_cliente_id)->>'effective',
    'roulette_result:'||v_spin.id,'roulette_result',
    case when v_reward.reward_type='coins' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='minutes' then round(v_reward.reward_value)::integer else 0 end,
    case when v_reward.reward_type='oracle_credits' then round(v_reward.reward_value)::integer else 0 end,
    v_spin.id,to_jsonb(v_reward)||jsonb_build_object('payment_provenance',jsonb_build_object(
      'purchase_id',v_spin.purchase_id,'payment_key',v_spin.payment_key,'source',v_spin.source,
      'payment_id',v_payment_id,'resolution',v_payment_resolution
    )));$replacement$;
begin
  if v_oid is null then raise exception 'ROULETTE_PAYMENT_PATCH_MISSING_FUNCTION'; end if;
  -- pg_proc preserves the original editor's line endings; deployments may
  -- also check this migration out as CRLF. Compare both using LF consistently.
  v_definition := replace(pg_get_functiondef(v_oid),chr(13)||chr(10),chr(10));
  v_original_insert := replace(v_original_insert,chr(13)||chr(10),chr(10));
  v_new_insert := replace(v_new_insert,chr(13)||chr(10),chr(10));
  -- Fail closed if a future version moved/changed this block. Never replace
  -- unrelated reward code or silently apply half a patch to an unknown RPC.
  if (length(v_definition)-length(replace(v_definition,v_declaration,'')))<>length(v_declaration)
     or (length(v_definition)-length(replace(v_definition,v_original_insert,'')))<>length(v_original_insert)
     or position('v_payment_resolution' in v_definition)>0 then
    raise exception 'ROULETTE_PAYMENT_PATCH_SOURCE_MISMATCH';
  end if;
  v_definition := replace(v_definition,v_declaration,v_declaration||$declarations$
  v_payment_id uuid := null;
  v_payment_candidate_ids uuid[];
  v_payment_call_id uuid := null;
  v_payment_key_id uuid := null;
  v_payment_key_match text[];
  v_payment_resolution text := 'unlinked';$declarations$);
  v_definition := replace(v_definition,v_original_insert,v_new_insert);
  execute replace(v_definition,chr(13)||chr(10),chr(10));
end
$migration$;

notify pgrst, 'reload schema';
commit;
