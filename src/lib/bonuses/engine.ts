export const METRICS = {
  captadas_total: "Captaciones registradas",
  pct_cliente: "% Cliente",
  pct_repite: "% Repite",
  minutes_cliente: "Minutos Cliente",
  minutes_repite: "Minutos Repite",
  calls_total: "Llamadas registradas",
  rank_captadas: "Posición Captadas",
  rank_cliente: "Posición Cliente",
  rank_repite: "Posición Repite",
} as const;
export type Metric = keyof typeof METRICS;
export type BonusRule = {
  id: string;
  name: string;
  description: string;
  kind: "tier" | "ranking" | "challenge";
  metric: Metric;
  minimum: number;
  maximum: number | null;
  target: number;
  reward: number;
  position: number | null;
  active: boolean;
  start_date: string;
  end_date: string | null;
  periodicity: "monthly" | "once";
  stackable: boolean;
  max_claims: number;
  sort_order: number;
  image_url: string | null;
  version: number;
};
export const moneyRound = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function validateMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Selecciona un mes válido.");
  return month;
}
export function monthEnd(month: string) {
  validateMonth(month);
  return new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  )
    .toISOString()
    .slice(0, 10);
}
export function applicable(rule: BonusRule, month: string) {
  return (
    rule.active &&
    rule.start_date <= monthEnd(month) &&
    (!rule.end_date || rule.end_date >= `${month}-01`)
  );
}
export function sortRanking(rows: any[], metric: string) {
  return [...rows].sort(
    (a, b) =>
      Number(b[metric] || 0) - Number(a[metric] || 0) ||
      String(a.worker_id).localeCompare(String(b.worker_id)),
  );
}
export function rankingPositions(rows: any[], workerId: string) {
  return Object.fromEntries(
    [
      ["captadas", "captadas_total"],
      ["cliente", "pct_cliente"],
      ["repite", "pct_repite"],
    ].map(([key, metric]) => [
      key,
      sortRanking(rows, metric).findIndex((r) => r.worker_id === workerId) +
        1 || null,
    ]),
  ) as Record<string, number | null>;
}
export function captureTier(rules: BonusRule[], count: number, month: string) {
  return (
    rules
      .filter(
        (r) =>
          r.kind === "tier" &&
          applicable(r, month) &&
          count >= r.minimum &&
          (r.maximum === null || count <= r.maximum),
      )
      .sort((a, b) => b.minimum - a.minimum)[0] || null
  );
}
export function captureAmount(
  rules: BonusRule[],
  count: number,
  month: string,
) {
  return moneyRound(count * (captureTier(rules, count, month)?.reward || 0));
}
export function rankingBonuses(
  rules: BonusRule[],
  positions: Record<string, number | null>,
  month: string,
  row: any,
) {
  return Object.fromEntries(
    ["captadas", "cliente", "repite"].map((key) => {
      const value = Number(
        row?.[key === "captadas" ? "captadas_total" : `pct_${key}`] || 0,
      );
      const rule = rules.find(
        (r) =>
          r.kind === "ranking" &&
          applicable(r, month) &&
          r.metric === `rank_${key}` &&
          r.position === positions[key],
      );
      return [key, value > 0 ? Number(rule?.reward || 0) : 0];
    }),
  ) as Record<string, number>;
}
export function evaluateRule(
  rule: BonusRule,
  row: any,
  positions: Record<string, number | null>,
  month: string,
) {
  const rank = rule.metric.startsWith("rank_");
  const value = rank
    ? positions[rule.metric.slice(5)] || 0
    : Math.max(0, Number(row[rule.metric] || 0));
  const metricHasActivity = rank
    ? Number(
        row[
          rule.metric === "rank_captadas"
            ? "captadas_total"
            : `pct_${rule.metric.slice(5)}`
        ] || 0,
      ) > 0
    : Number(row.calls_total || 0) > 0;
  let units = 0;
  if (rule.kind === "tier")
    units =
      value >= rule.minimum && (rule.maximum === null || value <= rule.maximum)
        ? value
        : 0;
  else if (rule.kind === "ranking")
    units = value === rule.position && metricHasActivity ? 1 : 0;
  else if (rank)
    units = value > 0 && value <= rule.target && metricHasActivity ? 1 : 0;
  else if (rule.target > 0 && metricHasActivity)
    units = Math.min(rule.max_claims, Math.floor(value / rule.target));
  const target =
    rule.kind === "tier"
      ? rule.minimum
      : rule.kind === "ranking"
        ? Number(rule.position)
        : rule.target;
  return {
    rule_id: rule.id,
    rule_version: rule.version,
    period_key:
      rule.periodicity === "once"
        ? `once:${rule.start_date}:${rule.end_date}`
        : month,
    name: rule.name,
    description: rule.description,
    kind: rule.kind,
    metric: rule.metric,
    value,
    target,
    units,
    amount: moneyRound(units * rule.reward),
    reward: rule.reward,
    reached: units > 0,
    progress: rank
      ? units
        ? 100
        : 0
      : target > 0
        ? Math.min(100, (value / target) * 100)
        : 100,
    remaining: rank
      ? value
        ? Math.max(0, value - target)
        : null
      : Math.max(0, target - value),
    stackable: rule.stackable,
    sort_order: rule.sort_order,
    image_url: rule.image_url,
  };
}
export function applyStacking<
  T extends {
    kind: string;
    stackable: boolean;
    amount: number;
    rule_id: string;
  },
>(items: T[]): T[] {
  const exclusive = items
    .filter((i) => i.kind === "challenge" && !i.stackable && i.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.rule_id.localeCompare(b.rule_id));
  return items.map((i) =>
    i.kind === "challenge" &&
    !i.stackable &&
    exclusive.length &&
    i.rule_id !== exclusive[0].rule_id
      ? { ...i, amount: 0, units: 0, reached: false, suppressed: true }
      : i,
  );
}
export function validateRule(raw: any): Omit<BonusRule, "id" | "version"> {
  const text = (v: any, max: number) =>
    String(v || "")
      .trim()
      .slice(0, max);
  const number = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0)
      throw new Error("Los valores deben ser números positivos.");
    return n;
  };
  const name = text(raw.name, 120),
    kind = raw.kind,
    metric = raw.metric;
  if (
    !name ||
    !["tier", "ranking", "challenge"].includes(kind) ||
    !(metric in METRICS)
  )
    throw new Error("Revisa nombre, tipo y métrica.");
  const start = text(raw.start_date, 10),
    end = raw.end_date ? text(raw.end_date, 10) : null;
  for (const d of [start, end].filter(Boolean) as string[])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
      !Number.isFinite(Date.parse(d)) ||
      new Date(d).toISOString().slice(0, 10) !== d
    )
      throw new Error("Fecha no válida.");
  if (end && end < start)
    throw new Error("La fecha final debe ser posterior al inicio.");
  const periodicity = raw.periodicity === "once" ? "once" : "monthly";
  if (periodicity === "once" && (!end || start.slice(0, 7) !== end.slice(0, 7)))
    throw new Error(
      "Un reto puntual debe empezar y terminar dentro del mismo mes de facturación.",
    );
  const minimum = number(raw.minimum || 0),
    maximum =
      raw.maximum == null || raw.maximum === "" ? null : number(raw.maximum),
    target = number(raw.target || 1),
    reward = moneyRound(number(raw.reward)),
    position = kind === "ranking" ? number(raw.position) : null,
    max_claims = number(raw.max_claims || 1);
  if (
    max_claims < 1 ||
    max_claims > 100 ||
    !Number.isInteger(max_claims) ||
    reward > 100000
  )
    throw new Error("Revisa el premio y el máximo de veces (1–100).");
  if (
    kind === "tier" &&
    (metric !== "captadas_total" ||
      !Number.isInteger(minimum) ||
      (maximum !== null && (!Number.isInteger(maximum) || maximum < minimum)))
  )
    throw new Error("Tramo de captadas no válido.");
  if (
    kind === "ranking" &&
    (!metric.startsWith("rank_") ||
      !position ||
      position > 100 ||
      !Number.isInteger(position))
  )
    throw new Error("Posición de ranking no válida.");
  if (kind === "challenge" && target <= 0)
    throw new Error("El objetivo debe ser mayor que cero.");
  if (metric.startsWith("pct_") && (target > 100 || max_claims !== 1))
    throw new Error(
      "Los porcentajes admiten un objetivo hasta 100 y un premio por periodo.",
    );
  if (
    metric.startsWith("rank_") &&
    (!Number.isInteger(target) || max_claims !== 1)
  )
    throw new Error("El ranking admite un premio por periodo.");
  if (
    kind !== "challenge" &&
    (periodicity !== "monthly" ||
      start.slice(8) !== "01" ||
      (end && end !== monthEnd(end.slice(0, 7))))
  )
    throw new Error("Tramos y ranking se configuran por meses completos.");
  let image_url = raw.image_url ? text(raw.image_url, 1000) : null;
  if (image_url) {
    try {
      if (new URL(image_url).protocol !== "https:") throw 0;
    } catch {
      throw new Error("La imagen debe usar una URL HTTPS.");
    }
  }
  return {
    name,
    description: text(raw.description, 2000),
    kind,
    metric,
    minimum,
    maximum,
    target,
    reward,
    position,
    active: raw.active !== false,
    start_date: start,
    end_date: end,
    periodicity,
    stackable: raw.stackable !== false,
    max_claims,
    sort_order: Math.trunc(number(raw.sort_order || 0)),
    image_url,
  };
}
