CREATE OR REPLACE FUNCTION public.set_client_rank_override(p_assigned_rank text, p_client_id uuid, p_created_by uuid, p_ends_at timestamp with time zone, p_intervention_type text, p_notes text, p_reason text, p_starts_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_automatic_rank text;
  v_business text;
  v_existing public.client_rank_overrides%rowtype;
  v_new_id uuid;
  v_previous_effective_rank text;
  v_rolling_total numeric := 0;
  v_starts_at timestamptz := coalesce(p_starts_at, now());
begin
  if p_assigned_rank is null
     or lower(trim(p_assigned_rank)) not in ('bronce', 'plata', 'oro', 'diamante') then
    raise exception using errcode = '22023', message = 'INVALID_CLIENT_RANK';
  end if;

  if p_intervention_type is null
     or lower(trim(p_intervention_type)) not in ('temporary', 'permanent', 'penalty') then
    raise exception using errcode = '22023', message = 'INVALID_INTERVENTION_TYPE';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'RANK_OVERRIDE_REASON_REQUIRED';
  end if;

  if lower(trim(p_intervention_type)) = 'permanent' and p_ends_at is not null then
    raise exception using errcode = '22023', message = 'PERMANENT_OVERRIDE_CANNOT_END';
  end if;

  if p_ends_at is not null and p_ends_at <= v_starts_at then
    raise exception using errcode = '22023', message = 'RANK_OVERRIDE_INVALID_DATES';
  end if;

  if not exists (select 1 from public.workers where id = p_created_by) then
    raise exception using errcode = '23503', message = 'RANK_OVERRIDE_WORKER_NOT_FOUND';
  end if;

  select lower(coalesce(nullif(trim(c.origen), ''), 'celestial'))
    into v_business
  from public.crm_clientes c
  where c.id = p_client_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'RANK_OVERRIDE_CLIENT_NOT_FOUND';
  end if;

  -- Serialize interventions for the same client. This complements the partial unique
  -- index and prevents two simultaneous requests from replacing each other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));

  select coalesce(sum(source.amount), 0)
    into v_rolling_total
  from (
    select greatest(coalesce(p.importe, 0), 0)::numeric as amount
    from public.crm_cliente_pagos p
    where p.cliente_id = p_client_id
      and p.estado = 'completed'
      and p.created_at >= now() - interval '30 days'
      and p.created_at <= now()
    union all
    select greatest(coalesce(l.importe, 0), 0)::numeric as amount
    from public.rendimiento_llamadas l
    where l.cliente_id = p_client_id::text
      and coalesce(l.fecha_hora, l.created_at) >= now() - interval '30 days'
      and coalesce(l.fecha_hora, l.created_at) <= now()
  ) source;

  v_automatic_rank := case
    when v_rolling_total >= 1000 then 'diamante'
    when v_rolling_total >= 500 then 'oro'
    when v_rolling_total >= 100 then 'plata'
    when v_rolling_total > 0 then 'bronce'
    else null
  end;

  select *
    into v_existing
  from public.client_rank_overrides
  where client_id = p_client_id
    and active = true
  order by created_at desc
  limit 1
  for update;

  v_previous_effective_rank := coalesce(v_existing.assigned_rank, v_automatic_rank);

  if v_existing.id is not null then
    update public.client_rank_overrides
       set active = false,
           restored_by = p_created_by,
           restored_at = now(),
           updated_at = now()
     where id = v_existing.id;

    insert into public.client_rank_override_audit (
      override_id, client_id, business, action, automatic_rank,
      previous_effective_rank, new_effective_rank, intervention_type,
      reason, notes, starts_at, ends_at, actor_worker_id
    ) values (
      v_existing.id, p_client_id, v_existing.business, 'replaced', v_automatic_rank,
      v_existing.assigned_rank, lower(trim(p_assigned_rank)), v_existing.intervention_type,
      nullif(trim(p_reason), ''), nullif(trim(coalesce(p_notes, '')), ''),
      v_existing.starts_at, v_existing.ends_at, p_created_by
    );
  end if;

  insert into public.client_rank_overrides (
    client_id, business, assigned_rank, intervention_type, starts_at, ends_at,
    reason, notes, active, automatic_rank_at_creation,
    previous_effective_rank, created_by
  ) values (
    p_client_id,
    v_business,
    lower(trim(p_assigned_rank)),
    lower(trim(p_intervention_type)),
    v_starts_at,
    case when lower(trim(p_intervention_type)) = 'permanent' then null else p_ends_at end,
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    v_automatic_rank,
    v_previous_effective_rank,
    p_created_by
  )
  returning id into v_new_id;

  insert into public.client_rank_override_audit (
    override_id, client_id, business, action, automatic_rank,
    previous_effective_rank, new_effective_rank, intervention_type,
    reason, notes, starts_at, ends_at, actor_worker_id
  ) values (
    v_new_id, p_client_id, v_business, 'created', v_automatic_rank,
    v_previous_effective_rank, lower(trim(p_assigned_rank)), lower(trim(p_intervention_type)),
    trim(p_reason), nullif(trim(coalesce(p_notes, '')), ''),
    v_starts_at,
    case when lower(trim(p_intervention_type)) = 'permanent' then null else p_ends_at end,
    p_created_by
  );

  return v_new_id;
end;
$function$;

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
