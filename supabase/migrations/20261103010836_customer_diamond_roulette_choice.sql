-- New purchases: Diamond keeps 300 total Coins and chooses either the purchase
-- level wheel (default/Nada) or one Diamond spin. Promo/manual remain ineligible.
-- Existing processed purchases, balances, spins, histories and catalogues are preserved.
CREATE OR REPLACE FUNCTION public.tc_apply_purchase_benefits(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.crm_cliente_pagos; policy public.tc_customer_benefit_policy; state jsonb; cfg jsonb; reward_policy jsonb;
 level smallint; source text; key text; result jsonb; minutes integer:=0; coins integer:=0; oracle integer:=0;
 event_id uuid; spin uuid; v_effective_rank text; wheel_choice text; wheel_level smallint;
 spin_count integer; spin_index integer; spin_ids jsonb:='[]'::jsonb; quote jsonb;
begin
 select * into p from public.crm_cliente_pagos where id=p_payment_id;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 perform 1 from public.crm_clientes where id=p.cliente_id for update;
 select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
 if p.benefits_processed_at is not null then
  select snapshot into result from public.tc_client_benefit_events where payment_id=p.id and benefit_key='purchase_processed';
  return coalesce(result,'{}')||jsonb_build_object('duplicate_prevented',true);
 end if;
 if p.estado is distinct from 'completed' or coalesce(p.importe,0)<=0 then return '{}'::jsonb; end if;
 if not public.tc_customer_payment_is_current(p.id) then
  update public.crm_cliente_pagos set customer_benefit_version='legacy' where id=p.id;
  return public.tc_apply_purchase_benefits_before_202611(p.id);
 end if;
 select * into policy from public.tc_customer_benefit_policy where id;
 update public.crm_cliente_pagos set customer_benefit_version=policy.version where id=p.id;
 state:=public.tc_client_rank_state(p.cliente_id); v_effective_rank:=state->>'effective';
 reward_policy:=public.tc_purchase_reward_policy(p.id);
 source:=case when p.pack_id like 'promo:%' then 'promotion' else 'standard' end;
 key:=case when source='promotion' then substring(p.pack_id from 7) else p.pack_id end;
 select package_level into level from public.tc_purchase_package_levels where package_source=source and package_key=key;
 if level is null and p.source_rendimiento_id is not null and reward_policy->>'pricing_mode'='regular' then
  level:=(public.tc_purchase_benefit_quote(p.importe,p.moneda)->>'roulette_level')::smallint;
 end if;
 wheel_choice:=coalesce(p.benefits_context->>'purchase_classification','nada');
 if wheel_choice='ruleta_diamante' then
  if v_effective_rank is distinct from 'diamante' then raise exception 'DIAMOND_ROULETTE_REQUIRES_DIAMOND'; end if;
  if reward_policy->>'pricing_mode' is distinct from 'regular' or level is null or level not in (1,2,3) then
   raise exception 'DIAMOND_ROULETTE_REQUIRES_REGULAR_PURCHASE';
  end if;
 end if;
 if v_effective_rank='diamante' and level in (1,2,3) and reward_policy->>'pricing_mode'='regular' then
  quote:=public.tc_purchase_benefit_quote(p.importe,p.moneda);
  wheel_level:=case when wheel_choice='ruleta_diamante' then 5 else level end;
  spin_count:=case when wheel_choice='ruleta_diamante' then 1 else greatest(coalesce((quote->>'roulette_spins')::integer,1),1) end;
  -- Total replacement, never 300 plus native/matrix coins or two wheel grants.
  coins:=policy.diamond_purchase_coins;
  select to_jsonb(b) into cfg from public.tc_rank_package_benefits b where b.rank_key=v_effective_rank and b.package_level=level;
  oracle:=greatest(coalesce((p.benefits_context->>'oracle_credits')::int,0),0)
   +case when coalesce((cfg->>'enabled')::boolean,false) then greatest(coalesce((cfg->>'oracle_credits')::int,0),0) else 0 end;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,
   coins,oracle_credits,package_level,delivery_key,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'rank_package:'||level,'rank_package',coins,oracle,level,'rank-package:'||p.id,p.importe,p.moneda,
   jsonb_build_object('policy_version',policy.version,'coins_total',coins,'rank_state',state,'package_level',level,'reward_policy',reward_policy,'roulette_choice',wheel_choice,'roulette_level',wheel_level,'roulette_spins',spin_count))
  returning id into event_id;
  update public.crm_clientes set puntos=coalesce(puntos,0)+coins,updated_at=now() where id=p.cliente_id;
  insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta)
  select p.cliente_id,'ganado',coins,'Compra Diamante · 300 Coins totales',event_id,c.puntos::int,
   jsonb_build_object('payment_id',p.id,'benefit_event_id',event_id,'policy_version',policy.version)
  from public.crm_clientes c where c.id=p.cliente_id;
  if oracle>0 then perform public.grant_cliente_oracle_credits(p.cliente_id,oracle,'rank-package:'||p.id||':oracle',
   'rank_package','Beneficio de compra',jsonb_build_object('payment_id',p.id,'benefit_event_id',event_id)); end if;
  for spin_index in 1..spin_count loop
   insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado)
   values(p.cliente_id,'benefit:'||p.id||':purchase_roulette:'||spin_index,
    case when wheel_level=5 then 'customer_purchase_diamond' else 'customer_purchase_level' end,
    wheel_level,p.id,p.importe,p.moneda,'pending') returning id into spin;
   spin_ids:=spin_ids||jsonb_build_array(spin);
   insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,spin_id,purchase_amount,currency,snapshot)
   values(p.cliente_id,p.id,v_effective_rank,'purchase_roulette:'||spin_index,'roulette',spin,p.importe,p.moneda,
    jsonb_build_object('level',wheel_level,'roulette_choice',wheel_choice,'policy_version',policy.version));
  end loop;
  result:=jsonb_build_object('policy_version',policy.version,'rank',v_effective_rank,'coins',coins,'oracle_credits',oracle,
   'roulette_choice',wheel_choice,'roulette_level',wheel_level,'roulette_spins',spin_count,
   'rank_package_matrix',jsonb_build_object('delivered',jsonb_build_object('coins',coins,'oracle_credits',oracle,
    'spin_ids',spin_ids,'roulette_diamond_spins',case when wheel_level=5 then 1 else 0 end)));
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'purchase_processed','processed',p.importe,p.moneda,result);
  update public.crm_cliente_pagos set benefits_processed_at=now() where id=p.id;
 else
  -- Keep verified native/matrix quantities for all other customer ranks.
  result:=public.tc_apply_purchase_benefits_before_202611(p.id);
 end if;
 if reward_policy->>'pricing_mode'='regular' then
  minutes:=coalesce((policy.ranks->v_effective_rank->>'regular_bonus_minutes')::int,0);
 end if;
 if minutes>0 then
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,v_effective_rank,'regular_purchase_minutes','minutes',minutes,'regular-minutes:'||p.id,p.importe,p.moneda,
   jsonb_build_object('policy_version',policy.version,'rank_state',state,'pricing_mode','regular'))
  on conflict(payment_id,benefit_key) do nothing returning id into event_id;
  if event_id is not null then
   update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+minutes,updated_at=now() where id=p.cliente_id;
   insert into public.crm_client_notes(cliente_id,texto,author_name,event_type,event_data)
   values(p.cliente_id::text,'Compra regular: +'||minutes||' minutos FREE de rango.','Sistema','regular_purchase_minutes',
    jsonb_build_object('payment_id',p.id,'benefit_event_id',event_id,'minutes',minutes,'policy_version',policy.version));
  end if;
 end if;
 result:=coalesce(result,'{}')||jsonb_build_object('regular_bonus_minutes',minutes,'policy_version',policy.version);
 update public.tc_client_benefit_events set snapshot=snapshot||result where payment_id=p.id and benefit_key='purchase_processed';
 perform public.tc_touch_roulette_signal(p.cliente_id);
 return result;
end $function$;


CREATE OR REPLACE FUNCTION public.tc_resolve_rank_package_benefit(p_cliente_id uuid, p_rank_key_override text, p_package_source text, p_package_key text, p_config_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; policy public.tc_customer_benefit_policy; cfg jsonb;
begin
 r:=public.tc_resolve_rank_package_benefit_before_202611(p_cliente_id,p_rank_key_override,p_package_source,p_package_key,p_config_override);
 select * into policy from public.tc_customer_benefit_policy where id;
 if policy.activated_at is not null then
  r:=r||jsonb_build_object('regular_bonus_minutes',case when p_package_source='standard'
    then coalesce((policy.ranks->(r->>'rank_key')->>'regular_bonus_minutes')::integer,0) else 0 end);
 end if;
 if policy.activated_at is not null and p_package_source='standard' and r->>'rank_key'='diamante' and (r->>'package_level')::int in (1,2,3) then
  cfg:=coalesce(r->'rank_benefits','{}')||jsonb_build_object('enabled',true,'coins',policy.diamond_purchase_coins,
    'roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',0,'diamond_roulette_choice_available',true);
  r:=r||jsonb_build_object('status','ready','rank_benefits',cfg,'replaces_native_coins',true,'replaces_level_spin',false,'diamond_roulette_choice_available',true,'policy_version',policy.version);
 end if;
 if p_package_source='promotion' then
  cfg:=coalesce(r->'rank_benefits','{}')||jsonb_build_object('coins',0,
    'roulette_level_1_spins',0,'roulette_level_2_spins',0,'roulette_level_3_spins',0,
    'roulette_special_spins',0,'roulette_diamond_spins',0);
  r:=r||jsonb_build_object('rank_benefits',cfg,'replaces_native_coins',false,'replaces_level_spin',false);
 end if;
 return r;
end $function$;

revoke all on function public.tc_apply_purchase_benefits(uuid) from public,anon,authenticated;
grant execute on function public.tc_apply_purchase_benefits(uuid) to service_role;
revoke all on function public.tc_resolve_rank_package_benefit(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.tc_resolve_rank_package_benefit(uuid,text,text,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.tc_customer_benefits_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select to_jsonb(p)||jsonb_build_object('redemptions',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',r.id,'minutes',r.minutos_otorgados,'coins',r.puntos_coste) order by r.minutos_otorgados),'[]') from public.recompensas r where r.activo),
 'package_benefits',(select coalesce(jsonb_agg((to_jsonb(b)-'updated_by')||case when b.rank_key='diamante' and p.activated_at is not null then
 jsonb_build_object('enabled',true,'coins',p.diamond_purchase_coins,'roulette_level_1_spins',0,'roulette_level_2_spins',0,
 'roulette_level_3_spins',0,'roulette_special_spins',0,'roulette_diamond_spins',0,'diamond_roulette_choice_available',true) else '{}'::jsonb end order by b.rank_key,b.package_level),'[]')
 from public.tc_rank_package_benefits b)) from public.tc_customer_benefit_policy p where p.id
$function$;
