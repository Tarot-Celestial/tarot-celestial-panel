import "server-only";
import { activityBreakdown } from "@/lib/activity-codes";

type XpRuleRow = {
  action_key: string;
  name?: string | null;
  xp_reward?: number | null;
  enabled?: boolean | null;
  integration_status?: string | null;
  trigger_type?: string | null;
  condition_json?: any;
  automatic?: boolean | null;
  frequency?: string | null;
  source_key?: string | null;
  max_awards?: number | null;
};

type RuleMetricKey =
  | "minutes_total"
  | "minutes_cliente"
  | "minutes_repite"
  | "calls_total"
  | "revenue_total"
  | "payments_count"
  | "clients_captured"
  | "repurchases"
  | "followups"
  | "consultations"
  | "positive_reviews"
  | "xp_period";

type WorkerMetrics = Record<RuleMetricKey, number>;

const numberValue = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function startOfUtcWeek(now = new Date()) {
  const day = startOfUtcDay(now);
  const delta = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - delta);
  return day;
}
function startOfUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function resolvePeriod(frequency: string, condition: any, now = new Date()) {
  const requested = String(condition?.period || "").toLowerCase();
  const freq = String(frequency || "").toLowerCase();
  const period = requested || (freq.includes("daily") || freq.includes("día") ? "daily" : freq.includes("week") || freq.includes("seman") ? "weekly" : freq.includes("month") || freq.includes("period") || freq.includes("mes") ? "monthly" : "lifetime");
  if (period === "daily" || period === "shift") {
    const start = startOfUtcDay(now);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    return { period: "daily", key: start.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString() };
  }
  if (period === "weekly") {
    const start = startOfUtcWeek(now);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    return { period: "weekly", key: start.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString() };
  }
  if (period === "monthly") {
    const start = startOfUtcMonth(now);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { period: "monthly", key: start.toISOString().slice(0, 7), start: start.toISOString(), end: end.toISOString() };
  }
  return { period: "lifetime", key: "lifetime", start: "2000-01-01T00:00:00.000Z", end: "2999-01-01T00:00:00.000Z" };
}

function compare(current: number, operator: string, target: number) {
  if (operator === "gt") return current > target;
  if (operator === "eq") return current === target;
  if (operator === "lte") return current <= target;
  if (operator === "lt") return current < target;
  return current >= target;
}

async function loadWorkerMetrics(admin: any, workerId: string, start: string, end: string): Promise<WorkerMetrics> {
  const [callsR, paymentsR, eventsR, capturesR, followupsR] = await Promise.all([
    admin
      .from("rendimiento_llamadas")
      .select("tiempo,importe,code_blocks,resumen_codigo,tipo_registro,codigo_1,minutos_1,codigo_2,minutos_2")
      .eq("telefonista_worker_id", workerId)
      .gte("fecha_hora", start)
      .lt("fecha_hora", end),
    admin
      .from("crm_cliente_pagos")
      .select("id,importe,cliente_id")
      .eq("created_by_user_id", workerId)
      .eq("estado", "completed")
      .gte("created_at", start)
      .lt("created_at", end),
    admin
      .from("worker_xp_events")
      .select("action_key,xp_amount")
      .eq("worker_id", workerId)
      .eq("status", "applied")
      .gte("created_at", start)
      .lt("created_at", end),
    admin
      .from("crm_client_capture_assignments")
      .select("client_id")
      .eq("captured_by_worker_id", workerId)
      .gte("captured_at", start)
      .lt("captured_at", end),
    admin
      .from("crm_client_followups")
      .select("id")
      .eq("worker_id", workerId)
      .not("completed_at", "is", null)
      .gte("completed_at", start)
      .lt("completed_at", end),
  ]);

  // Some historical installations may not expose one of the operational tables/columns.
  // In that case, keep the other real metrics usable instead of making the whole XP panel fail.
  const callRows = callsR.error ? [] : (callsR.data || []);
  const payments = paymentsR.error ? [] : (paymentsR.data || []);
  const events = eventsR.error ? [] : (eventsR.data || []);
  const captures = capturesR.error ? [] : (capturesR.data || []);
  const followups = followupsR.error ? [] : (followupsR.data || []);

  let minutesTotal = 0;
  let minutesCliente = 0;
  let minutesRepite = 0;
  let callRevenue = 0;
  for (const row of callRows) {
    const breakdown = activityBreakdown(row as any);
    const rowMinutes = (Object.values(breakdown) as number[]).reduce((sum: number, value: number) => sum + numberValue(value), 0);
    minutesTotal += rowMinutes || numberValue(row.tiempo);
    minutesCliente += numberValue(breakdown.cliente);
    minutesRepite += numberValue(breakdown.repite);
    callRevenue += numberValue(row.importe);
  }

  const countEvent = (key: string) => events.filter((event: any) => String(event.action_key || "") === key).length;
  return {
    minutes_total: Math.round(minutesTotal * 100) / 100,
    minutes_cliente: Math.round(minutesCliente * 100) / 100,
    minutes_repite: Math.round(minutesRepite * 100) / 100,
    calls_total: callRows.length,
    revenue_total: Math.round((callRevenue || payments.reduce((sum: number, row: any) => sum + numberValue(row.importe), 0)) * 100) / 100,
    payments_count: payments.length,
    clients_captured: captures.length || countEvent("client_capture"),
    repurchases: countEvent("repurchase") + countEvent("segunda_compra_captada"),
    followups: followups.length || countEvent("followup"),
    consultations: countEvent("consultation"),
    positive_reviews: countEvent("positive_review"),
    xp_period: events.reduce((sum: number, event: any) => sum + numberValue(event.xp_amount), 0),
  };
}

export async function evaluateProfessionalXpRules(admin: any, workerIds: string[]) {
  if (!workerIds.length) return { evaluated: 0, awarded: 0, skipped: 0 };
  const settingsR = await admin.from("worker_xp_system_settings").select("professional_mode,auto_evaluate").eq("id", true).maybeSingle();
  if (!settingsR.error && settingsR.data && (settingsR.data.professional_mode === false || settingsR.data.auto_evaluate === false)) {
    return { evaluated: 0, awarded: 0, skipped: 0 };
  }

  const rulesR = await admin.from("worker_xp_rules").select("*").eq("enabled", true);
  if (rulesR.error) return { evaluated: 0, awarded: 0, skipped: 0 };
  const rules = (rulesR.data || []).filter((rule: XpRuleRow) =>
    String(rule.trigger_type || "").toLowerCase() === "threshold" &&
    rule.automatic !== false &&
    String(rule.integration_status || "") === "connected"
  );
  if (!rules.length) return { evaluated: 0, awarded: 0, skipped: 0 };

  let evaluated = 0, awarded = 0, skipped = 0;
  const metricsCache = new Map<string, WorkerMetrics>();

  for (const workerId of workerIds) {
    for (const rule of rules) {
      evaluated += 1;
      const condition = rule.condition_json && typeof rule.condition_json === "object" ? rule.condition_json : {};
      const metricKey = String(condition.metric_key || "") as RuleMetricKey;
      const allowed: RuleMetricKey[] = ["minutes_total","minutes_cliente","minutes_repite","calls_total","revenue_total","payments_count","clients_captured","repurchases","followups","consultations","positive_reviews","xp_period"];
      if (!allowed.includes(metricKey)) { skipped += 1; continue; }
      const period = resolvePeriod(String(rule.frequency || ""), condition);
      const cacheKey = `${workerId}:${period.start}:${period.end}`;
      let metrics = metricsCache.get(cacheKey);
      if (!metrics) {
        metrics = await loadWorkerMetrics(admin, workerId, period.start, period.end);
        metricsCache.set(cacheKey, metrics);
      }
      const current = numberValue(metrics[metricKey]);
      const target = numberValue(condition.threshold);
      if (!compare(current, String(condition.operator || "gte"), target)) { skipped += 1; continue; }

      const maxAwards = rule.max_awards == null ? null : Math.max(1, Math.round(numberValue(rule.max_awards)));
      if (maxAwards) {
        const countR = await admin.from("worker_xp_events")
          .select("id", { count: "exact", head: true })
          .eq("worker_id", workerId)
          .eq("action_key", rule.action_key)
          .eq("status", "applied");
        if (!countR.error && Number(countR.count || 0) >= maxAwards) { skipped += 1; continue; }
      }

      const referenceId = `xp_rule:${rule.action_key}:${period.key}`;
      const existing = await admin.from("worker_xp_events")
        .select("id")
        .eq("worker_id", workerId)
        .eq("action_key", rule.action_key)
        .eq("reference_id", referenceId)
        .eq("status", "applied")
        .maybeSingle();
      if (existing.data) { skipped += 1; continue; }

      const inserted = await admin.from("worker_xp_events").insert({
        worker_id: workerId,
        action_key: rule.action_key,
        xp_amount: Math.max(0, Math.round(numberValue(rule.xp_reward))),
        reference_id: referenceId,
        reference_label: `${rule.name || rule.action_key} · ${period.key}`,
        origin: "xp_rule_engine",
        status: "applied",
        metadata: {
          professional_rule: true,
          source_key: rule.source_key || "performance",
          metric_key: metricKey,
          operator: condition.operator || "gte",
          threshold: target,
          observed_value: current,
          period: period.period,
          period_key: period.key,
        },
      }).select("id").single();
      if (inserted.error) { skipped += 1; continue; }
      awarded += 1;
    }
  }
  return { evaluated, awarded, skipped };
}
