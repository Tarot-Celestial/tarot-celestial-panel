-- Correct only evidenced pending rank extras for completed purchases since
-- 2026-11-01 00:00 Europe/Madrid. Keep every original spin and its audit trail.
-- No Coins, minutes, consumed rewards, October purchases, or customer messages.
BEGIN;

DO $reconcile_rank_roulette$
DECLARE
  v_client uuid;
  v_spin record;
  v_after jsonb;
  v_ids jsonb;
  v_count integer;
  v_unexpired integer;
  v_expired integer;
  v_started timestamptz := clock_timestamp();
  v_correction_key constant text := 'rank_roulette_extras_20261107_v1';
BEGIN
  -- Match the spin engine's lock order: client first, then pending spin rows.
  FOR v_client IN
    SELECT DISTINCT s.cliente_id
    FROM public.cliente_ruleta_giros s
    JOIN public.crm_cliente_pagos p
      ON p.id = s.purchase_id AND p.cliente_id = s.cliente_id
    WHERE p.created_at >= TIMESTAMP '2026-11-01' AT TIME ZONE 'Europe/Madrid'
      AND p.estado = 'completed'
      AND p.benefits_processed_at IS NOT NULL
      AND s.estado = 'pending'
      AND s.used_at IS NULL
      AND (
        s.source = 'rank_package_matrix'
        OR s.source = 'rank_roulette'
        OR (s.source = 'rank_benefits'
          AND s.payment_key LIKE 'benefit:' || p.id::text || ':rank_roulette:%')
      )
    ORDER BY s.cliente_id
  LOOP
    PERFORM 1 FROM public.crm_clientes WHERE id = v_client FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_ids := '[]'::jsonb;
    v_count := 0;
    v_unexpired := 0;
    v_expired := 0;

    FOR v_spin IN
      SELECT s.id, s.purchase_id, s.expires_at, to_jsonb(s) AS before_data
      FROM public.cliente_ruleta_giros s
      JOIN public.crm_cliente_pagos p
        ON p.id = s.purchase_id AND p.cliente_id = s.cliente_id
      WHERE s.cliente_id = v_client
        AND p.created_at >= TIMESTAMP '2026-11-01' AT TIME ZONE 'Europe/Madrid'
        AND p.estado = 'completed'
        AND p.benefits_processed_at IS NOT NULL
        AND p.benefits_context->>'pricing_mode' = 'regular'
        AND s.estado = 'pending'
        AND s.used_at IS NULL
        AND s.reward_type IS NULL AND s.reward_value IS NULL
        AND s.premio_tipo IS NULL AND s.premio_valor IS NULL
        AND s.premio_minutos IS NULL AND s.result_status IS NULL
        AND NOT coalesce(s.reward_meta, '{}'::jsonb) ? v_correction_key
        AND NOT EXISTS (
          SELECT 1 FROM public.tc_client_benefit_events result
          WHERE result.spin_id = s.id
            AND (result.benefit_type = 'roulette_result'
              OR result.benefit_key LIKE 'roulette_result:%')
        )
        AND EXISTS (
          SELECT 1 FROM public.tc_client_benefit_events processed
          WHERE processed.payment_id = p.id
            AND processed.cliente_id = v_client
            AND processed.benefit_key = 'purchase_processed'
        )
        AND (
          (s.source = 'rank_package_matrix' AND EXISTS (
            SELECT 1 FROM public.tc_client_benefit_events matrix
            WHERE matrix.payment_id = p.id
              AND matrix.cliente_id = v_client
              AND matrix.benefit_key LIKE 'rank_package:%'
              AND matrix.delivery_key = 'rank-package:' || p.id::text
              AND matrix.snapshot->'delivered'->'spin_ids'
                @> jsonb_build_array(s.id)
          ))
          OR (
            (s.source = 'rank_roulette' OR s.source = 'rank_benefits')
            AND s.payment_key LIKE 'benefit:' || p.id::text || ':rank_roulette:%'
            AND EXISTS (
              SELECT 1 FROM public.tc_client_benefit_events rank_event
              WHERE rank_event.payment_id = p.id
                AND rank_event.cliente_id = v_client
                AND rank_event.spin_id = s.id
                AND rank_event.benefit_key LIKE 'rank_roulette:%'
                AND s.payment_key = 'benefit:' || p.id::text || ':' || rank_event.benefit_key
            )
          )
        )
        AND EXISTS (
          SELECT 1
          FROM public.cliente_ruleta_giros base
          JOIN public.tc_client_benefit_events base_event
            ON base_event.spin_id = base.id
            AND base_event.payment_id = p.id
            AND base_event.cliente_id = v_client
            AND base_event.benefit_key LIKE 'purchase_roulette:%'
          WHERE base.purchase_id = p.id
            AND base.cliente_id = v_client
            AND base.source = 'rank_benefits'
            AND base.payment_key = 'benefit:' || p.id::text || ':' || base_event.benefit_key
            AND base.estado IN ('pending', 'used')
        )
      ORDER BY s.id
      FOR UPDATE OF s
    LOOP
      UPDATE public.cliente_ruleta_giros s
      SET estado = 'revoked',
          reward_meta = coalesce(s.reward_meta, '{}'::jsonb) || jsonb_build_object(
            v_correction_key, jsonb_build_object(
              'reason', 'Rank roulette was added on top of the purchase roulette.',
              'migration', '20261107165524_reconcile_pending_rank_roulette_extras',
              'corrected_at', v_started,
              'previous_state', v_spin.before_data->>'estado',
              'previous_expires_at', v_spin.before_data->'expires_at',
              'payment_id', s.purchase_id,
              'coins_changed', 0,
              'minutes_changed', 0
            )
          )
      WHERE s.id = v_spin.id AND s.estado = 'pending' AND s.used_at IS NULL
      RETURNING to_jsonb(s) INTO v_after;

      IF NOT FOUND THEN CONTINUE; END IF;

      INSERT INTO public.tc_client_benefit_audit(
        actor_user_id, action, entity, entity_id, before_data, after_data
      ) VALUES (
        NULL, v_correction_key, 'cliente_ruleta_giros', v_spin.id::text,
        v_spin.before_data, v_after
      );

      v_ids := v_ids || jsonb_build_array(v_spin.id);
      v_count := v_count + 1;
      IF v_spin.expires_at IS NOT NULL AND v_spin.expires_at <= v_started THEN
        v_expired := v_expired + 1;
      ELSE
        v_unexpired := v_unexpired + 1;
      END IF;
    END LOOP;

    IF v_count > 0 THEN
      INSERT INTO public.crm_client_notes(
        cliente_id, texto, author_name, is_pinned, event_type, event_data
      ) VALUES (
        v_client::text,
        format(
          'Ajuste de giros: se retiraron %s giros adicionales de rango duplicados con los giros de compra (%s sin caducar y %s con fecha vencida). Se conservan los giros de compra y todos los ya utilizados. No se han cambiado Coins ni minutos.',
          v_count, v_unexpired, v_expired
        ),
        'Sistema', false, 'roulette_rank_extras_reconciled',
        jsonb_build_object(
          'correction_key', v_correction_key,
          'migration', '20261107165524_reconcile_pending_rank_roulette_extras',
          'spin_ids', v_ids,
          'revoked_count', v_count,
          'unexpired_count', v_unexpired,
          'date_expired_count', v_expired,
          'coins_changed', 0,
          'minutes_changed', 0,
          'corrected_at', v_started
        )
      );
    END IF;
  END LOOP;
END;
$reconcile_rank_roulette$;

COMMIT;

