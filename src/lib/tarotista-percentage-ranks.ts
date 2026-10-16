/** Preparation-only rules. This module never persists, confirms or pays a rank. */
export const PERCENTAGE_RANK_ORDER = ["C", "B", "A", "S"] as const;
export type PercentageRankCode = typeof PERCENTAGE_RANK_ORDER[number];
export type PercentageRule = {
  code: PercentageRankCode;
  cliente_pct: number;
  repite_pct: number;
  health_bonus: number;
  rank_bonus: number;
  cliente_rate_bonus: number;
  repite_rate_bonus: number;
};
export type PercentageMinutes = {
  minutes_total: number;
  minutes_cliente: number;
  minutes_repite: number;
};
export type PercentageGoal = {
  key: "cliente" | "repite";
  label: string;
  actual: number;
  target: number;
  met: boolean;
  remaining_points: number;
  bar: number;
};
export type PercentageEvaluation = {
  evaluable: boolean;
  candidate: PercentageRankCode | null;
  cliente_pct: number | null;
  repite_pct: number | null;
  next: PercentageRankCode | null;
  goals: PercentageGoal[];
  eligible: PercentageRankCode[];
  review_required: true;
};
export const PERCENTAGE_RANK_NAMES: Record<PercentageRankCode, string> = {
  C: "Inicio del camino", B: "Crecimiento", A: "Rendimiento destacado", S: "Élite profesional",
};
/** Thresholds are a proposal, NOT an active configuration or a production fallback. */
export function proposedPercentageRules(): PercentageRule[] {
  return [
    { code: "C", cliente_pct: 0, repite_pct: 0, health_bonus: 0, rank_bonus: 0, cliente_rate_bonus: 0, repite_rate_bonus: 0 },
    { code: "B", cliente_pct: 20, repite_pct: 10, health_bonus: 10, rank_bonus: 5, cliente_rate_bonus: 0, repite_rate_bonus: 0 },
    { code: "A", cliente_pct: 30, repite_pct: 15, health_bonus: 15, rank_bonus: 10, cliente_rate_bonus: 0, repite_rate_bonus: 0.01 },
    { code: "S", cliente_pct: 40, repite_pct: 20, health_bonus: 20, rank_bonus: 30, cliente_rate_bonus: 0.01, repite_rate_bonus: 0.01 },
  ];
}
const FIELDS = ["cliente_pct", "repite_pct", "health_bonus", "rank_bonus", "cliente_rate_bonus", "repite_rate_bonus"] as const;
export function validatePercentageRules(value: unknown): PercentageRule[] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("Configura exactamente los rangos C, B, A y S.");
  const result = PERCENTAGE_RANK_ORDER.map(code => {
    const matches = value.filter(r => r && typeof r === "object" && r.code === code);
    if (matches.length !== 1) throw new Error(`El rango ${code} falta o está duplicado.`);
    const raw = matches[0];
    if (Object.keys(raw).some(key => !["code", ...FIELDS].includes(key))) throw new Error("La propuesta solo acepta porcentajes y beneficios estructurados; no acepta objetivos ocultos de minutos o captaciones.");
    const row = { code } as PercentageRule;
    for (const field of FIELDS) {
      const n = raw[field];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error(`Rango ${code}: revisa ${field}; debe ser un número válido, sin negativos.`);
      const max = field.endsWith("_pct") ? 100 : field.endsWith("rate_bonus") ? 1 : 10000;
      if (n > max) throw new Error(`Rango ${code}: ${field} supera el límite ${max}.`);
      if (field.endsWith("_pct") && Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) throw new Error("Usa como máximo dos decimales en los objetivos porcentuales.");
      row[field] = n;
    }
    if (row.cliente_pct + row.repite_pct > 100) throw new Error(`Rango ${code}: Cliente y Repite juntos no pueden superar el 100 %.`);
    if (code === "C" && (row.cliente_pct !== 0 || row.repite_pct !== 0)) throw new Error("C es el rango de entrada y no tiene requisitos porcentuales.");
    if (code !== "C" && (row.cliente_pct <= 0 || row.repite_pct <= 0)) throw new Error(`Rango ${code}: indica ambos porcentajes, mayores que cero.`);
    return row;
  });
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1], b = result[i];
    if (b.cliente_pct < a.cliente_pct || b.repite_pct < a.repite_pct || (b.cliente_pct === a.cliente_pct && b.repite_pct === a.repite_pct)) throw new Error(`El rango ${b.code} debe avanzar respecto al anterior sin reducir ninguno de los dos objetivos.`);
  }
  return result;
}
function checkedMinutes(input: PercentageMinutes) {
  for (const key of ["minutes_total", "minutes_cliente", "minutes_repite"] as const) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0) throw new Error("Los minutos del periodo no son válidos.");
  }
  if (input.minutes_cliente + input.minutes_repite > input.minutes_total + 1e-8) throw new Error("Cliente y Repite superan los minutos totales; revisa los datos.");
  return input;
}
export function evaluatePercentageRanks(input: PercentageMinutes, rawRules: unknown): PercentageEvaluation {
  const rules = validatePercentageRules(rawRules), m = checkedMinutes(input);
  if (!m.minutes_total) return { evaluable: false, candidate: null, cliente_pct: null, repite_pct: null, next: null, goals: [], eligible: [], review_required: true };
  const cliente = m.minutes_cliente / m.minutes_total * 100, repite = m.minutes_repite / m.minutes_total * 100;
  // Compare against the actual minute ratio, never the display-rounded percentages.
  const meets = (kind: "cliente" | "repite", target: number) => m[`minutes_${kind}`] * 100 >= m.minutes_total * target;
  const eligible = rules.filter(r => meets("cliente", r.cliente_pct) && meets("repite", r.repite_pct)).map(r => r.code);
  const candidate = eligible[eligible.length - 1] || "C";
  const next = rules[rules.findIndex(r => r.code === candidate) + 1] || null;
  const goals: PercentageGoal[] = next ? (["cliente", "repite"] as const).map(key => {
    const actual = key === "cliente" ? cliente : repite, target = next[`${key}_pct`], met = meets(key, target);
    return { key, label: key === "cliente" ? "Cliente" : "Repite", actual, target, met, remaining_points: met ? 0 : Math.max(0.01, Math.ceil((target - actual) * 100) / 100), bar: Math.max(0, Math.min(100, actual / target * 100)) };
  }) : [];
  return { evaluable: true, candidate, cliente_pct: cliente, repite_pct: repite, next: next?.code || null, goals, eligible, review_required: true };
}
export function percentageRequirements(rule: PercentageRule) {
  return { min_minutes_total: null, min_minutes_cliente: null, min_minutes_repite: null, min_captadas: null,
    min_cliente_pct: rule.code === "C" ? null : rule.cliente_pct, min_repite_pct: rule.code === "C" ? null : rule.repite_pct };
}
export function percentageBenefitAmount(rule: PercentageRule, input: PercentageMinutes) {
  const m = checkedMinutes(input);
  return Math.round((rule.health_bonus + rule.rank_bonus + m.minutes_cliente * rule.cliente_rate_bonus + m.minutes_repite * rule.repite_rate_bonus) * 100) / 100;
}
/** Exposes discrepancies, not a claim that prose-only benefits are payable. */
export function structuredBenefitWarnings(rows: Array<{code: string; benefit_config?: Record<string, unknown>}>): string[] {
  return rows.flatMap(row => {
    const b = row.benefit_config || {};
    const text = Array.isArray(b.extras) ? b.extras.join(" ") : "";
    const warnings: string[] = [];
    if (/(€|eur|bono de salud|bono de rango)/i.test(text)) warnings.push(`Rango ${row.code}: hay importes o bonos escritos en «extras». El texto no se suma automáticamente a la factura; revisa los campos numéricos.`);
    return warnings;
  });
}
export function percentLabel(n: number | null) {
  return n === null ? "—" : `${(Math.floor((n + 1e-10) * 100) / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
}
export function pointsLabel(n: number) { return `${n.toLocaleString("es-ES", { maximumFractionDigits: 2 })} puntos porcentuales`; }
export function euros(n: number) { return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
export function validateSimulationMonth(value: unknown): string {
  if (typeof value !== "string" || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) throw new Error("Selecciona un mes válido (AAAA-MM).");
  return value;
}
