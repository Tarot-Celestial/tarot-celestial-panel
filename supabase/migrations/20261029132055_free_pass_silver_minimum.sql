-- Silver and higher ranks retain the existing 3 x 7-minute cycle benefit.
-- No balance, historical use, policy amount or cycle date is rewritten.
-- Source: production RPC definitions inspected read-only on 2026-10-29.

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
  v_rank text;
  v_rank_eligible boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer := 0;
  v_policy public.crm_free_pass_policy%rowtype;
begin
  select * into strict v_policy
  from public.crm_free_pass_policy
  where id;

  -- Preserve the historical confirmed-purchase and original cycle rules.
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

  v_rank := public.tc_client_rank_state(p_cliente_id)->>'effective';
  v_rank_eligible := coalesce(v_rank in ('plata', 'oro', 'diamante'), false);
  v_eligible := v_first is not null and v_rank_eligible;

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
    'effective_rank', v_rank,
    'rank_eligible', v_rank_eligible,
    'eligibility_reason', case
      when not v_rank_eligible then 'RANK_NOT_ELIGIBLE'
      when v_first is null then 'NO_CONFIRMED_PURCHASE'
      else null
    end,
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
 if not coalesce((v_status->>'rank_eligible')::boolean,false) then raise exception 'RANK_NOT_ELIGIBLE'; end if;
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

REVOKE ALL ON FUNCTION public.crm_free_pass_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_free_pass_use(uuid,uuid,uuid,timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_free_pass_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_free_pass_use(uuid,uuid,uuid,timestamptz,integer) TO service_role;

-- Keep historical rule IDs, names and application snapshots. Only retire the
-- Bronze information and align the other pass descriptions with the RPC rule.
-- Do not reactivate an information rule that an administrator disabled.
WITH descriptions(rank, description) AS (
  VALUES
    ('bronce', 'Bronce no incluye pases FREE de 7 minutos. Este beneficio está disponible desde Plata, con una compra confirmada histórica.'),
    ('plata', '3 pases de 7 minutos cada 30 días, con una compra confirmada histórica y rango vigente Plata, Oro o Diamante. Gestionados por Central.'),
    ('oro', '3 pases de 7 minutos cada 30 días, con una compra confirmada histórica y rango vigente Plata, Oro o Diamante. Gestionados por Central.'),
    ('diamante', '3 pases de 7 minutos cada 30 días, con una compra confirmada histórica y rango vigente Plata, Oro o Diamante. Gestionados por Central.')
)
UPDATE public.client_benefit_rules AS rule
SET description = descriptions.description,
    active = CASE WHEN rule.rank = 'bronce' THEN false ELSE rule.active END,
    revision = rule.revision + 1,
    updated_at = now()
FROM descriptions
WHERE rule.rank = descriptions.rank
  AND rule.event = 'information'
  AND rule.name = 'Pases de consulta'
  AND (rule.description IS DISTINCT FROM descriptions.description
       OR (rule.rank = 'bronce' AND rule.active));
