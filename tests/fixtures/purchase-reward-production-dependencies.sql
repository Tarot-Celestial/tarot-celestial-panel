CREATE OR REPLACE FUNCTION public.tc_client_rank_state(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
  v_count integer;
  v_auto text;
  v_override jsonb;
  v_cfg jsonb;
  v_next jsonb;
begin
  with purchases as (
    select p.importe::numeric as amount
    from public.crm_cliente_pagos p
    where p.cliente_id = p_cliente_id
      and p.estado = 'completed'
      and p.importe > 0
      and p.created_at between now() - interval '30 days' and now()

    union all

    select l.importe::numeric
    from public.rendimiento_llamadas l
    where pg_catalog.btrim(coalesce(l.cliente_id, '')) = p_cliente_id::text
      and l.importe > 0
      and coalesce(l.fecha_hora, l.created_at)
          between now() - interval '30 days' and now()
      and not exists (
        select 1
        from public.crm_cliente_pagos p
        where p.source_rendimiento_id = l.id
      )
  )
  select coalesce(sum(amount), 0), count(*)
    into v_total, v_count
  from purchases;

  select rank_key
    into v_auto
  from public.tc_client_rank_benefits
  where min_spend <= v_total
  order by min_spend desc, sort_order desc
  limit 1;

  select jsonb_build_object(
           'id', o.id,
           'rank', o.assigned_rank,
           'intervention_type', o.intervention_type,
           'starts_at', o.starts_at,
           'ends_at', o.ends_at,
           'reason', o.reason,
           'notes', o.notes
         )
    into v_override
  from public.client_rank_overrides o
  join public.tc_client_rank_benefits r
    on r.rank_key = o.assigned_rank
  where o.client_id = p_cliente_id
    and o.active
    and o.starts_at <= now()
    and (o.ends_at is null or o.ends_at > now())
  order by o.created_at desc, o.id desc
  limit 1;

  select to_jsonb(r)
    into v_cfg
  from public.tc_client_rank_benefits r
  where r.rank_key = coalesce(v_override->>'rank', v_auto);

  select to_jsonb(r)
    into v_next
  from public.tc_client_rank_benefits r
  where r.min_spend > coalesce((v_cfg->>'min_spend')::numeric, 0)
  order by r.min_spend
  limit 1;

  return jsonb_build_object(
    'automatic', v_auto,
    'effective', coalesce(v_override->>'rank', v_auto),
    'override', v_override,
    'total', round(v_total, 2),
    'compras', v_count,
    'config', v_cfg,
    'next', v_next
  );
end
$function$;


CREATE OR REPLACE FUNCTION public.tc_purchase_benefit_quote(p_amount numeric, p_currency text, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.tc_client_purchase_bands%rowtype; r jsonb;
begin
  if p_amount>0 then
    select * into b from public.tc_client_purchase_bands where is_active and currency=upper(p_currency)
      and round(p_amount,2)>=min_amount and (max_amount is null or round(p_amount,2)<=max_amount)
      order by min_amount limit 1;
  end if;
  if p_cliente_id is not null then r:=public.tc_client_rank_state(p_cliente_id); end if;
  return jsonb_build_object('band_id',b.id,'roulette_level',b.roulette_level,'roulette_spins',coalesce(b.spins,0),'rank_state',r);
end $function$;


CREATE OR REPLACE FUNCTION public.tc_resolve_rank_package_benefit(p_cliente_id uuid, p_rank_key_override text, p_package_source text, p_package_key text, p_config_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rank_state jsonb := null;
  v_rank_key text := null;
  v_level smallint := null;
  v_assignment jsonb := null;
  v_cfg jsonb := null;
  v_legacy jsonb := null;
  v_status text := 'config_missing';
begin
  if p_package_source not in ('standard','promotion') then
    raise exception 'INVALID_PACKAGE_SOURCE';
  end if;
  if nullif(btrim(coalesce(p_package_key,'')), '') is null then
    raise exception 'INVALID_PACKAGE_KEY';
  end if;

  if p_cliente_id is not null then
    v_rank_state := public.tc_client_rank_state(p_cliente_id);
    v_rank_key := nullif(v_rank_state->>'effective','');
  else
    v_rank_key := nullif(btrim(coalesce(p_rank_key_override,'')), '');
  end if;

  select to_jsonb(x), x.package_level
    into v_assignment, v_level
  from public.tc_purchase_package_levels x
  where x.package_source = p_package_source
    and x.package_key = p_package_key
  limit 1;

  if v_rank_key is not null then
    select jsonb_build_object(
      'rank_key', r.rank_key,
      'label', r.label,
      'is_active', r.is_active,
      'coins_enabled', r.coins_enabled,
      'purchase_coins', r.purchase_coins,
      'roulette_enabled', r.roulette_enabled,
      'roulette_level', r.roulette_level,
      'roulette_spins', r.roulette_spins,
      'ritual_access', r.ritual_access,
      'daily_bonus_enabled', r.daily_bonus_enabled
    )
      into v_legacy
    from public.tc_client_rank_benefits r
    where r.rank_key = v_rank_key;
  end if;

  if v_level is null then
    v_status := 'unmapped_package';
  elsif v_rank_key is null then
    v_status := 'no_effective_rank';
  else
    if p_config_override is not null
       and p_config_override->>'rank_key' = v_rank_key
       and nullif(p_config_override->>'package_level','')::smallint = v_level then
      v_cfg := p_config_override;
    else
      select to_jsonb(b)
        into v_cfg
      from public.tc_rank_package_benefits b
      where b.rank_key = v_rank_key
        and b.package_level = v_level;
    end if;

    if v_cfg is null then
      v_status := 'config_missing';
    elsif coalesce((v_cfg->>'enabled')::boolean, false) then
      v_status := 'ready';
    else
      v_status := 'disabled';
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'rank_key', v_rank_key,
    'rank_state', v_rank_state,
    'package_source', p_package_source,
    'package_key', p_package_key,
    'package_level', v_level,
    'package_assignment', v_assignment,
    'rank_benefits', v_cfg,
    'legacy_purchase_benefits', v_legacy,
    -- Política vigente: si hay nivel administrado, la matriz sustituye los
    -- antiguos extras globales de compra del rango. Los beneficios propios
    -- del pack/promoción SIEMPRE se conservan y se acumulan.
    'legacy_general_applies', (v_level is null)
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.tc_grant_diamond_purchase_minutes(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.crm_cliente_pagos%rowtype; s jsonb; ev uuid;
begin
  select * into p from public.crm_cliente_pagos where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=p.cliente_id for update;
  select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
  if p.estado is distinct from 'completed' or coalesce(p.importe,0)<=0 or p.benefits_processed_at is not null then return 0; end if;
  if coalesce(p.referencia_externa,'') like 'registrar_llamada:%' then return 0; end if;
  s := public.tc_client_rank_state(p.cliente_id);
  if coalesce(s->>'effective','')<>'diamante' then return 0; end if;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,
    purchase_amount,currency,minutes,delivery_key,snapshot)
  values(p.cliente_id,p.id,'diamante','diamond_purchase_minutes','minutes',p.importe,p.moneda,15,
    'diamond-minutes:'||p.id::text,jsonb_build_object('free_minutes',15,'rank_state',s,'rule','diamond_each_completed_purchase'))
  on conflict(payment_id,benefit_key) do nothing returning id into ev;
  if ev is null then return 0; end if;
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+15,
    updated_at=clock_timestamp() where id=p.cliente_id;
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p.cliente_id,'rank_purchase_minutes','Tus 15 minutos Diamante ya están disponibles',
    'Hemos añadido 15 minutos FREE adicionales por tu compra confirmada.',
    jsonb_build_object('payment_id',p.id,'benefit_event_id',ev,'free_minutes',15),false,now());
  perform public.tc_touch_roulette_signal(p.cliente_id);
  return 15;
end $function$;


CREATE OR REPLACE FUNCTION public.get_cliente_oracle_balance(p_cliente_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select greatest(0, coalesce(sum(amount), 0))::integer
  from public.cliente_oracle_credit_movements
  where cliente_id = p_cliente_id;
$function$;


CREATE OR REPLACE FUNCTION public.grant_cliente_oracle_credits(p_cliente_id uuid, p_amount integer, p_reference text, p_pack_id text, p_notes text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_amount <= 0 then raise exception 'INVALID_ORACLE_CREDIT_AMOUNT'; end if;

  insert into public.cliente_oracle_credit_movements
    (cliente_id, amount, movement_type, reference, pack_id, notes, meta)
  values
    (p_cliente_id, p_amount, 'purchase', p_reference, p_pack_id, p_notes, coalesce(p_meta, '{}'::jsonb))
  on conflict (reference) do nothing;

  return public.get_cliente_oracle_balance(p_cliente_id);
end;
$function$;


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


CREATE OR REPLACE FUNCTION public.tc_purchase_benefits_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.tc_apply_purchase_benefits(new.id);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.cliente_confirmar_compra_promocion_v1(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.cliente_payment_attempts%rowtype; snap jsonb; result jsonb;
begin
  select * into a from public.cliente_payment_attempts where id=p_attempt_id;
  if a.id is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=a.cliente_id for update;
  select * into a from public.cliente_payment_attempts where id=p_attempt_id for update;
  if a.status not in ('processing','completed') then raise exception 'PAYMENT_NOT_VERIFIED'; end if;
  snap:=a.promotion_snapshot;
  if snap->>'kind'<>'promotion_minute_pack' or (snap->>'price')::numeric<>a.amount or snap->>'currency'<>a.currency then raise exception 'PROMOTION_SNAPSHOT_INVALID'; end if;
  -- Se concede el contrato cobrado, aunque la campaña termine durante el pago.
  result:=public.cliente_confirmar_compra_ruleta_v3(jsonb_build_object(
    'cliente_id',a.cliente_id,'payment_ref',a.provider||':'||a.order_id,'amount',a.amount,'currency',a.currency,
    'metodo',a.provider||'_promotion','pack_id',a.pack_id,'pack_name',snap->>'package_name',
    'free',snap->'free_minutes','normal',snap->'paid_minutes','points',snap->'coins','oracle_credits',snap->'oracle_credits',
    'roulette_level',snap->'roulette_level','roulette_spins',snap->'roulette_spins','notas',snap->>'promotion_name','created_by_role','cliente_webhook'));
  update public.cliente_payment_attempts set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=a.id;
  return result;
end $function$;