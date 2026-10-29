-- Exact production function bodies, read-only snapshot 2026-10-29.
-- Minimal table contract is supplied by the integration test; no live data.

CREATE OR REPLACE FUNCTION public.crm_free_pass_status(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_first timestamptz;
  v_last timestamptz;
  v_eligible boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer := 0;
  v_policy public.crm_free_pass_policy%rowtype;
begin
  select * into strict v_policy
  from public.crm_free_pass_policy
  where id;

  -- Una compra confirmada histórica habilita el beneficio.
  -- El primer pago conserva el calendario de ciclos existente.
  select min(t), max(t)
  into v_first, v_last
  from (
    select p.created_at as t
    from public.crm_cliente_pagos p
    where p.cliente_id = p_cliente_id
      and p.estado = 'completed'
      and p.importe > 0

    union all

    select coalesce(r.fecha_hora, r.created_at)
    from public.rendimiento_llamadas r
    where r.cliente_id = p_cliente_id::text
      and r.cliente_compra_minutos
      and r.importe > 0
      and not coalesce(r.misma_compra, false)
      and not exists (
        select 1
        from public.crm_cliente_pagos p
        where p.source_rendimiento_id = r.id
      )
  ) purchases
  where t <= now();

  v_eligible := v_first is not null;

  if v_first is not null then
    v_start := v_first
      + floor(
          extract(epoch from (now() - v_first))
          / (v_policy.cycle_days * 86400)
        ) * make_interval(days => v_policy.cycle_days);
    v_end := v_start + make_interval(days => v_policy.cycle_days);

    select count(*)
    into v_used
    from public.crm_free_pass_uses
    where cliente_id = p_cliente_id
      and cycle_start = v_start;
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'last_purchase_at', v_last,
    'eligible_until', null,
    'total', v_policy.passes,
    'available', case
      when not v_eligible then 0
      else greatest(0, v_policy.passes - v_used)
    end,
    'used', v_used,
    'minutes', v_policy.minutes,
    'cycle_days', v_policy.cycle_days,
    'cycle_start', v_start,
    'renews_at', v_end
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_free_pass_use(p_cliente_id uuid, p_worker_id uuid, p_request_id uuid, p_cycle_start timestamp with time zone, p_expected_used integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_status jsonb; v_worker public.workers%rowtype; v_existing public.crm_free_pass_uses%rowtype; v_free numeric; v_minutes integer;
begin
 select * into v_worker from public.workers where id=p_worker_id and role in ('admin','central') and is_active is distinct from false;
 if not found then raise exception 'FORBIDDEN'; end if;
 if p_request_id is null or p_cycle_start is null or p_expected_used is null then raise exception 'INVALID_REQUEST'; end if;
 -- Serializa saldo y consumo para esta clienta, también entre centrales.
 perform 1 from public.crm_clientes where id=p_cliente_id for update;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 select * into v_existing from public.crm_free_pass_uses where request_id=p_request_id;
 if found then
  if v_existing.cliente_id<>p_cliente_id or v_existing.worker_id<>p_worker_id then raise exception 'INVALID_REQUEST'; end if;
  return jsonb_build_object('benefits',public.crm_free_pass_status(p_cliente_id),'replayed',true);
 end if;
 v_status:=public.crm_free_pass_status(p_cliente_id);
 if not (v_status->>'eligible')::boolean then raise exception 'NO_CONFIRMED_PURCHASE'; end if;
 if (v_status->>'cycle_start')::timestamptz<>p_cycle_start or (v_status->>'used')::integer<>p_expected_used then raise exception 'PASS_STATE_CHANGED'; end if;
 if (v_status->>'available')::integer<=0 then raise exception 'NO_PASSES'; end if;
 v_minutes:=(v_status->>'minutes')::integer;
 insert into public.crm_free_pass_uses(request_id,cliente_id,cycle_start,slot,minutes,worker_id)
 values(p_request_id,p_cliente_id,p_cycle_start,p_expected_used+1,v_minutes,p_worker_id);
 update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+v_minutes,updated_at=now()
 where id=p_cliente_id returning minutos_free_pendientes into v_free;
 insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,author_email,is_pinned,event_type,event_data)
 values(p_cliente_id::text,'Pase FREE utilizado · +'||v_minutes||' minutos FREE. Pases restantes: '||((v_status->>'available')::integer-1)||'/'||(v_status->>'total')||'.',
 v_worker.user_id,v_worker.display_name,v_worker.email,false,'system_free_pass',jsonb_build_object('request_id',p_request_id,'minutes',v_minutes,'cycle_start',p_cycle_start));
 -- Reutiliza la señal privada que ya escuchan CRM y Panel Cliente.
 insert into public.cliente_ruleta_signal(cliente_id,version,updated_at) values(p_cliente_id,1,now())
 on conflict(cliente_id) do update set version=coalesce(public.cliente_ruleta_signal.version,0)+1,updated_at=excluded.updated_at;
 return jsonb_build_object('benefits',public.crm_free_pass_status(p_cliente_id),'replayed',false,'free',v_free);
end $function$;

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

REVOKE ALL ON FUNCTION public.tc_client_rank_state(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_free_pass_status(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_free_pass_use(uuid,uuid,uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tc_client_rank_state(uuid),public.crm_free_pass_status(uuid),public.crm_free_pass_use(uuid,uuid,uuid,timestamptz,integer) TO service_role;
