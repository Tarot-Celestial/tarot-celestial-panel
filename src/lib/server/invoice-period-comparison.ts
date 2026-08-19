export type InvoiceTrend = "up" | "down" | "neutral";

export type InvoicePeriodComparison = {
  current: number;
  previous: number | null;
  difference: number | null;
  change_pct: number | null;
  trend: InvoiceTrend;
  has_previous: boolean;
};

export function safeInvoiceNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareInvoicePeriods(currentValue: unknown, previousValue: unknown, hasPrevious: boolean): InvoicePeriodComparison {
  const current = safeInvoiceNumber(currentValue);
  if (!hasPrevious) {
    return { current, previous: null, difference: null, change_pct: null, trend: "neutral", has_previous: false };
  }

  const previous = safeInvoiceNumber(previousValue);
  const difference = Math.round((current - previous) * 100) / 100;
  const trend: InvoiceTrend = Math.abs(difference) < 0.005 ? "neutral" : difference > 0 ? "up" : "down";
  const changePct = previous === 0
    ? (current === 0 ? 0 : null)
    : Math.round((((current - previous) / Math.abs(previous)) * 100) * 100) / 100;

  return { current, previous, difference, change_pct: changePct, trend, has_previous: true };
}

function minutesFromMeta(meta: unknown) {
  if (!meta) return 0;
  if (typeof meta === "object") return safeInvoiceNumber((meta as Record<string, unknown>).minutes);
  if (typeof meta !== "string") return 0;
  try {
    return safeInvoiceNumber(JSON.parse(meta)?.minutes);
  } catch {
    return 0;
  }
}

function recordFromMeta(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === "object") return meta as Record<string, unknown>;
  if (typeof meta !== "string") return {};
  try {
    const parsed = JSON.parse(meta);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function invoiceMinuteCode(kind: unknown, meta: unknown) {
  const lineKind = String(kind || "").trim().toLowerCase();
  if (!lineKind.startsWith("minutes_")) return null;
  const record = recordFromMeta(meta);
  const structuredCode = String(record.code || "").trim().toLowerCase();
  return (structuredCode || lineKind.slice("minutes_".length)).replace(/[\s-]+/g, "_") || null;
}

export async function loadInvoiceMinutesByCode(admin: any, invoiceIds: string[]) {
  const uniqueIds = Array.from(new Set(invoiceIds.filter(Boolean)));
  const totals = new Map<string, Map<string, number>>();
  if (!uniqueIds.length) return totals;

  const { data, error } = await admin
    .from("invoice_lines")
    .select("invoice_id, kind, meta")
    .in("invoice_id", uniqueIds);

  if (error) throw error;

  for (const line of data || []) {
    const invoiceId = String(line?.invoice_id || "");
    const code = invoiceMinuteCode(line?.kind, line?.meta);
    if (!invoiceId || !code) continue;
    const byCode = totals.get(invoiceId) || new Map<string, number>();
    byCode.set(code, Math.round(((byCode.get(code) || 0) + minutesFromMeta(line?.meta)) * 100) / 100);
    totals.set(invoiceId, byCode);
  }

  return totals;
}

export async function loadInvoiceMinuteTotals(admin: any, invoiceIds: string[]) {
  const uniqueIds = Array.from(new Set(invoiceIds.filter(Boolean)));
  const totals = new Map<string, number>();
  if (!uniqueIds.length) return totals;

  const { data, error } = await admin
    .from("invoice_lines")
    .select("invoice_id, kind, meta")
    .in("invoice_id", uniqueIds);

  if (error) throw error;

  for (const line of data || []) {
    const invoiceId = String(line?.invoice_id || "");
    const kind = String(line?.kind || "");
    if (!invoiceId || !kind.startsWith("minutes_")) continue;
    totals.set(invoiceId, (totals.get(invoiceId) || 0) + minutesFromMeta(line?.meta));
  }

  return totals;
}
