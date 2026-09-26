export type BrainRiskLevel = "low" | "elevated" | "high" | "critical";

export type BrainForecastSignal = {
  id: string;
  title: string;
  detail: string;
  score: number;
  level: BrainRiskLevel;
  affected_node_ids: string[];
  evidence: string[];
  recommendation: string;
};

export type BrainForecast = {
  score: number;
  level: BrainRiskLevel;
  confidence: "low" | "medium" | "high";
  title: string;
  summary: string;
  watch_node_ids: string[];
  signals: BrainForecastSignal[];
  recommendations: string[];
  baseline: {
    snapshots_used: number;
    median_duration_ms: number | null;
    median_degraded_nodes: number | null;
  };
};

type ForecastInput = {
  now?: number;
  durationMs: number;
  nodes: Record<string, any>;
  incidents: any[];
  history: any[];
  snapshots: any[];
  deploymentComparison?: {
    current_commit?: string | null;
    previous_commit?: string | null;
    delta_open_incidents?: number | null;
  } | null;
};

function median(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function levelFor(score: number): BrainRiskLevel {
  if (score >= 80) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "elevated";
  return "low";
}

function signal(
  id: string,
  title: string,
  detail: string,
  score: number,
  affectedNodeIds: string[],
  evidence: string[],
  recommendation: string
): BrainForecastSignal {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id,
    title,
    detail,
    score: bounded,
    level: levelFor(bounded),
    affected_node_ids: Array.from(new Set(affectedNodeIds.filter(Boolean))),
    evidence,
    recommendation,
  };
}

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildBrainForecast(input: ForecastInput): BrainForecast {
  const now = input.now ?? Date.now();
  const snapshots = (input.snapshots || []).filter(Boolean);
  const incidents = input.incidents || [];
  const history = input.history || [];
  const nodes = input.nodes || {};

  const previousDurations = snapshots
    .map((item) => numeric(item?.duration_ms, NaN))
    .filter(Number.isFinite);
  const previousDegraded = snapshots
    .map((item) => numeric(item?.attention_nodes, 0) + numeric(item?.error_nodes, 0))
    .filter(Number.isFinite);

  const durationMedian = median(previousDurations);
  const degradedMedian = median(previousDegraded);
  const currentDegraded = Object.values(nodes).filter((node: any) => node?.status === "attention" || node?.status === "error").length;

  const signals: BrainForecastSignal[] = [];

  if (durationMedian && input.durationMs >= Math.max(250, durationMedian * 1.7)) {
    const ratio = input.durationMs / Math.max(durationMedian, 1);
    signals.push(signal(
      "pulse-latency-spike",
      "El pulso está tardando más de lo habitual",
      "La lectura completa del Cerebro se está alejando de su línea base reciente.",
      Math.min(85, 28 + ratio * 18),
      ["infra", "core"],
      [
        `actual: ${Math.round(input.durationMs)} ms`,
        `mediana reciente: ${Math.round(durationMedian)} ms`,
        `multiplicador: x${ratio.toFixed(1)}`,
      ],
      "Vigila Supabase/PostgREST y las consultas que forman el pulso antes de que la degradación se convierta en errores visibles."
    ));
  }

  if (degradedMedian != null && currentDegraded >= Math.max(2, degradedMedian + 2)) {
    const delta = currentDegraded - degradedMedian;
    signals.push(signal(
      "degraded-nodes-growth",
      "Aumentan los subsistemas degradados",
      "Hay más nodos en atención/error que en la línea base reciente.",
      Math.min(88, 35 + delta * 12),
      Object.values(nodes)
        .filter((node: any) => node?.status === "attention" || node?.status === "error")
        .map((node: any) => String(node.id)),
      [
        `actual: ${currentDegraded} nodos`,
        `mediana reciente: ${degradedMedian.toFixed(1)}`,
      ],
      "Prioriza los nodos compartidos por varias dependencias. Un fallo transversal suele aparecer antes en Infraestructura/Core."
    ));
  }

  const recent15 = history.filter((item: any) => {
    const at = new Date(String(item?.occurred_at || "")).getTime();
    return Number.isFinite(at) && now - at <= 15 * 60 * 1000 && ["opened", "occurred", "reopened"].includes(String(item?.event_type));
  });
  const previous60 = history.filter((item: any) => {
    const at = new Date(String(item?.occurred_at || "")).getTime();
    const age = now - at;
    return Number.isFinite(at) && age > 15 * 60 * 1000 && age <= 75 * 60 * 1000 && ["opened", "occurred", "reopened"].includes(String(item?.event_type));
  });
  const recentRate = recent15.length;
  const baselineRate15 = previous60.length / 4;

  if (recentRate >= 3 && recentRate >= Math.max(3, baselineRate15 * 2)) {
    const affected = recent15.flatMap((item: any) => Array.isArray(item?.affected_node_ids) ? item.affected_node_ids : []);
    signals.push(signal(
      "incident-acceleration",
      "Aceleración de errores",
      "La frecuencia de incidentes de los últimos 15 minutos está creciendo por encima de la hora previa.",
      Math.min(95, 48 + recentRate * 6),
      affected,
      [
        `últimos 15 min: ${recentRate} eventos`,
        `ritmo base equivalente: ${baselineRate15.toFixed(1)} / 15 min`,
      ],
      "Revisa primero el patrón común entre rutas y nodos afectados; evita corregir cada error como si fuera independiente."
    ));
  }

  const recurrent = incidents.filter((item: any) => numeric(item?.reopened_count, 0) > 0);
  if (recurrent.length) {
    const totalReopens = recurrent.reduce((sum: number, item: any) => sum + numeric(item?.reopened_count, 0), 0);
    const maxReopens = Math.max(...recurrent.map((item: any) => numeric(item?.reopened_count, 0)));
    signals.push(signal(
      "incident-recurrence",
      "Incidencias que vuelven después de recuperarse",
      "Uno o más problemas han reaparecido después de haber sido considerados resueltos.",
      Math.min(94, 44 + maxReopens * 14 + recurrent.length * 5),
      recurrent.flatMap((item: any) => Array.isArray(item?.affected_node_ids) ? item.affected_node_ids : []),
      recurrent.slice(0, 4).map((item: any) => `${item.title || item.route || "incidente"} · ${numeric(item.reopened_count, 0)} reapertura(s)`),
      "Trátalo como causa raíz pendiente. Compara el commit donde reaparece y evita cerrar la incidencia solo porque deje de emitir durante unos minutos."
    ));
  }

  const deltaOpen = input.deploymentComparison?.delta_open_incidents;
  if (typeof deltaOpen === "number" && deltaOpen > 0 && input.deploymentComparison?.current_commit) {
    signals.push(signal(
      "deployment-regression",
      "El despliegue actual acumula más incidencias",
      "La versión actual tiene más incidentes activos que la referencia del despliegue anterior.",
      Math.min(96, 46 + deltaOpen * 12),
      incidents.flatMap((item: any) => Array.isArray(item?.affected_node_ids) ? item.affected_node_ids : []),
      [
        `commit actual: ${String(input.deploymentComparison.current_commit).slice(0, 8)}`,
        `commit anterior: ${String(input.deploymentComparison.previous_commit || "sin base").slice(0, 8)}`,
        `delta: +${deltaOpen} incidente(s)`,
      ],
      "Compara primero los cambios del despliegue actual con las rutas afectadas antes de introducir nuevos cambios de compensación."
    ));
  }

  const concentrated = new Map<string, { count: number; nodes: string[] }>();
  history
    .filter((item: any) => {
      const at = new Date(String(item?.occurred_at || "")).getTime();
      return Number.isFinite(at) && now - at <= 6 * 60 * 60 * 1000 && ["opened", "occurred", "reopened"].includes(String(item?.event_type));
    })
    .forEach((item: any) => {
      const key = String(item?.subsystem || "core");
      const current = concentrated.get(key) || { count: 0, nodes: [] };
      current.count += 1;
      current.nodes.push(...(Array.isArray(item?.affected_node_ids) ? item.affected_node_ids : []));
      concentrated.set(key, current);
    });

  const hotSubsystem = Array.from(concentrated.entries()).sort((a, b) => b[1].count - a[1].count)[0];
  if (hotSubsystem && hotSubsystem[1].count >= 5) {
    signals.push(signal(
      "subsystem-concentration",
      "Los errores se concentran en un mismo subsistema",
      "La mayoría de eventos recientes comparten una zona funcional, lo que aumenta la probabilidad de una causa raíz común.",
      Math.min(84, 36 + hotSubsystem[1].count * 6),
      hotSubsystem[1].nodes,
      [`${hotSubsystem[0]}: ${hotSubsystem[1].count} eventos en 6 h`],
      "Investiga la dependencia común del subsistema antes de ampliar timeouts, reintentos o polling."
    ));
  }

  const ordered = signals.sort((a, b) => b.score - a.score);
  const total = ordered.length
    ? Math.min(100, Math.round(ordered[0].score * 0.62 + ordered.slice(1, 4).reduce((sum, item) => sum + item.score * 0.16, 0)))
    : 8;
  const level = levelFor(total);
  const confidence = snapshots.length >= 12 && history.length >= 12 ? "high" : snapshots.length >= 4 || history.length >= 6 ? "medium" : "low";
  const watchNodes = Array.from(new Set(ordered.flatMap((item) => item.affected_node_ids))).slice(0, 10);
  const recommendations = Array.from(new Set(ordered.map((item) => item.recommendation))).slice(0, 4);

  const title =
    level === "critical" ? "Riesgo preventivo crítico" :
    level === "high" ? "Riesgo preventivo alto" :
    level === "elevated" ? "Señales tempranas detectadas" :
    "Comportamiento dentro de la línea base";

  const summary =
    ordered.length
      ? `El Cerebro detectó ${ordered.length} señal(es) preventiva(s). No significa que vaya a producirse un fallo, pero el patrón actual merece vigilancia antes de que escale.`
      : "No aparecen patrones de aceleración, reincidencia o degradación suficientes para anticipar un problema inmediato.";

  return {
    score: total,
    level,
    confidence,
    title,
    summary,
    watch_node_ids: watchNodes,
    signals: ordered,
    recommendations,
    baseline: {
      snapshots_used: snapshots.length,
      median_duration_ms: durationMedian == null ? null : Math.round(durationMedian),
      median_degraded_nodes: degradedMedian,
    },
  };
}
