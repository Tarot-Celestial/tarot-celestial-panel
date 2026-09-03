// Shared catalogue extracted from RegistrarLlamadaModal. Keep stored codes unchanged.
export const CALL_CODE_OPTIONS = [
  { value: "FREE", label: "Free" }, { value: "RUEDA", label: "Rueda" },
  { value: "CLIENTE", label: "Cliente" }, { value: "REPITE", label: "Repite" },
  { value: "CALL", label: "CALL · 0,06 €/min" },
] as const;
// 'Otros' already exists in billing as non-billable/unclassified minutes.
export const ACTIVITY_CODE_OPTIONS = [...CALL_CODE_OPTIONS, { value: "OTROS", label: "Sin código / Otros" }] as const;
export type ActivityCode = (typeof ACTIVITY_CODE_OPTIONS)[number]["value"];
export type CodeBlock = { code: ActivityCode; minutes: number };
export type ActivitySource = {
  tiempo?: unknown; tipo_registro?: unknown; resumen_codigo?: unknown; code_blocks?: unknown;
  codigo_1?: unknown; minutos_1?: unknown; codigo_2?: unknown; minutos_2?: unknown;
};
const rounded = (n: number) => Math.round(n * 100) / 100;
const numeric = (n: unknown) => Number(String(n ?? 0).replace(",", ".")) || 0;
export function classifyActivityCode(value: unknown): ActivityCode {
  const s = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("free")) return "FREE";
  if (s.includes("rueda")) return "RUEDA";
  if (s.includes("cliente")) return "CLIENTE";
  if (s.includes("repite")) return "REPITE";
  if (s.includes("call")) return "CALL";
  return "OTROS";
}
export function consolidateCodes(blocks: CodeBlock[]): CodeBlock[] {
  const sums = new Map<ActivityCode, number>();
  for (const block of blocks) sums.set(block.code, rounded((sums.get(block.code) || 0) + block.minutes));
  return ACTIVITY_CODE_OPTIONS.flatMap(({ value }) => (sums.get(value) || 0) > 0 ? [{ code: value, minutes: sums.get(value)! }] : []);
}
export function parseCodeSummary(summary: unknown, total = 0, type: unknown = ""): CodeBlock[] {
  const raw = String(summary || "").trim();
  if (!raw) return total > 0 ? [{ code: classifyActivityCode(type), minutes: total }] : [];
  // Decimal commas are not separators: '7,5 free · 8,5 cliente'.
  const parts = raw.split(/·|\+|\n|;|,(?!\d)/).map(s => s.trim()).filter(Boolean);
  const blocks = parts.flatMap(part => {
    const match = part.match(/\d+(?:[.,]\d+)?/);
    const minutes = numeric(match?.[0]) || (parts.length === 1 ? total : 0);
    return minutes > 0 ? [{ code: classifyActivityCode(part), minutes }] : [];
  });
  return blocks.length ? consolidateCodes(blocks) : total > 0 ? [{ code: classifyActivityCode(raw || type), minutes: total }] : [];
}
export function parseActivityCodes(row: ActivitySource): CodeBlock[] {
  if (Array.isArray(row.code_blocks)) return consolidateCodes(row.code_blocks.map(b => ({ code: classifyActivityCode(b.code), minutes: numeric(b.minutes) })));
  const a = String(row.codigo_1 || "").trim(), b = String(row.codigo_2 || "").trim();
  const m1 = numeric(row.minutos_1), m2 = numeric(row.minutos_2), total = numeric(row.tiempo);
  const single = Boolean((a && !b && !m1 && !m2) || (b && !a && !m1 && !m2));
  const slots = [[a, m1 || (single && a ? total : 0)], [b, m2 || (single && b ? total : 0)]] as const;
  const blocks = slots.flatMap(([code, minutes]) => {
    // Some imports stored a complete multi-code summary in codigo_1.
    if (/[·+;\n]/.test(code) && /\d/.test(code)) return parseCodeSummary(code, minutes);
    return minutes > 0 ? [{ code: classifyActivityCode(code), minutes }] : [];
  });
  return blocks.length ? consolidateCodes(blocks) : parseCodeSummary(row.resumen_codigo, total, row.tipo_registro);
}
export function serializeActivityCodes(blocks: CodeBlock[]) {
  return consolidateCodes(blocks).map(b => `${b.minutes} ${b.code.toLowerCase()}`).join(" · ");
}
export function activityBreakdown(row: ActivitySource) {
  const result = { free: 0, rueda: 0, cliente: 0, repite: 0, call_fixed: 0, otros: 0 };
  const keys = { FREE: "free", RUEDA: "rueda", CLIENTE: "cliente", REPITE: "repite", CALL: "call_fixed", OTROS: "otros" } as const;
  for (const b of parseActivityCodes(row)) result[keys[b.code]] = rounded(result[keys[b.code]] + b.minutes);
  return result;
}
export function decimalValue(value: unknown, label: string) {
  const s = String(value ?? "").trim().replace(",", ".");
  if (!/^(?:0|\d+)(?:\.\d{1,2})?$/.test(s) || !Number.isFinite(Number(s)) || Number(s) > 1000000) throw new Error(`${label}: usa una cifra válida, sin negativos y con hasta dos decimales.`);
  return Number(s);
}
export function validateActivityCodes(blocks: unknown, total: number): CodeBlock[] {
  if (!Array.isArray(blocks) || blocks.length > 32) throw new Error("Revisa la distribución de minutos (máximo 32 tramos).");
  const parsed = blocks.map(b => {
    if (!b || !ACTIVITY_CODE_OPTIONS.some(c => c.value === b.code)) throw new Error("Selecciona un código válido en cada tramo.");
    const minutes = decimalValue(b.minutes, "Minutos del tramo");
    if (minutes <= 0) throw new Error("Cada tramo debe tener minutos mayores que cero.");
    return { code: b.code as ActivityCode, minutes };
  });
  const sum = rounded(parsed.reduce((n, b) => n + b.minutes, 0));
  if (sum > total) throw new Error("La distribución de códigos supera el tiempo total.");
  if (sum < total) throw new Error(`${rounded(total - sum)} minutos sin clasificar. Completa la distribución antes de guardar.`);
  return consolidateCodes(parsed);
}
