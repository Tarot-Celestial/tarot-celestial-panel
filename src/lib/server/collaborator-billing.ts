import { normalizeText, roundMoney } from "@/lib/server/auth-worker";

export type CollaboratorDefinition = {
  id: string;
  display_name: string;
  role: string;
  tag_id: string;
  tag_name: string;
  is_active: boolean;
  remuneration_type: string | null;
  remuneration_value: number | null;
  source_tracking_started_at: string | null;
};

type DateRange = {
  startIso: string;
  endIso: string;
};

type PaymentEntry = {
  id: string;
  source: "crm_cliente_pagos" | "rendimiento_llamadas";
  cliente_id: string;
  cliente_nombre: string;
  created_at: string;
  amount: number;
  currency: string;
  method_raw: string;
  method_group: string;
  status_raw: string;
  status_group: "completed" | "cancelled" | "refunded" | "failed" | "other";
  reference: string | null;
  package_id: string | null;
  package_name: string | null;
  paid_minutes: number;
  bonus_minutes: number;
  notes: string | null;
};

type ServiceEntry = {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  service_at: string;
  minutes_total: number;
  paid_minutes_used: number;
  gift_minutes_used: number;
  package_label: string;
  amount: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  payment_reference: string | null;
  tarotista_nombre: string;
  source: string;
};

type Summary = {
  clients_total: number;
  services_total: number;
  minutes_total: number;
  generated_total: number;
  totals_by_method: Record<string, number>;
  totals_by_method_currency: Record<string, Record<string, number>>;
  totals_by_currency: Record<string, number>;
  cancelled_or_refunded: number;
  completed_payments: number;
};

export type CollaboratorMonthlyReport = {
  collaborator: CollaboratorDefinition;
  month: string;
  previous_month: string;
  tag: { id: string; name: string };
  summary: Summary;
  previous_summary: Summary | null;
  comparisons: {
    clients: Comparison;
    services: Comparison;
    minutes: Comparison;
    generated: Comparison;
  };
  services: ServiceEntry[];
  payments: PaymentEntry[];
  remuneration: {
    configured: boolean;
    type: string | null;
    value: number | null;
    payable_total: number | null;
    note: string;
  };
  sync: {
    source: string;
    generated_at: string;
    tagged_clients: number;
  };
};

type Comparison = {
  current: number;
  previous: number | null;
  change_pct: number | null;
  trend: "up" | "down" | "neutral";
  has_previous: boolean;
  reason?: string | null;
};

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidText(value: unknown) {
  return UUID_PATTERN.test(String(value || "").trim());
}

const BUSINESS_TIME_ZONE = "Europe/Madrid";

function madridMonthBoundary(year: number, monthIndex: number) {
  const utcGuess = Date.UTC(year, monthIndex, 1, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(utcGuess))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess));
}

function monthRange(monthKey: string): DateRange {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) throw new Error("INVALID_MONTH");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = madridMonthBoundary(year, month - 1);
  const end = madridMonthBoundary(year, month);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function previousMonthKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) throw new Error("INVALID_MONTH");
  const previous = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function chunks<T>(values: T[], size = 180) {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function isMissingRelationError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

export async function listActiveCollaborators(admin: any): Promise<CollaboratorDefinition[]> {
  const { data, error } = await admin
    .from("billing_collaborators")
    .select("id, display_name, role, tag_id, is_active, remuneration_type, remuneration_value, source_tracking_started_at")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  const tagIds = Array.from(new Set((data || []).map((row: any) => String(row?.tag_id || "")).filter(Boolean)));
  const tagNames = new Map<string, string>();
  if (tagIds.length) {
    const { data: tags, error: tagsError } = await admin
      .from("crm_etiquetas")
      .select("id, nombre")
      .in("id", tagIds);
    if (tagsError) throw tagsError;
    for (const tag of tags || []) tagNames.set(String(tag.id), String(tag.nombre || ""));
  }

  return (data || []).map((row: any) => ({
    id: String(row.id),
    display_name: String(row.display_name || "Colaborador"),
    role: String(row.role || "colaborador"),
    tag_id: String(row.tag_id || ""),
    tag_name: tagNames.get(String(row.tag_id)) || "",
    is_active: row.is_active !== false,
    remuneration_type: row.remuneration_type ? String(row.remuneration_type) : null,
    remuneration_value: row.remuneration_value === null || row.remuneration_value === undefined
      ? null
      : safeNumber(row.remuneration_value),
    source_tracking_started_at: row.source_tracking_started_at ? String(row.source_tracking_started_at) : null,
  }));
}

async function loadTaggedClientIds(admin: any, tagId: string) {
  const all: string[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await admin
      .from("crm_cliente_etiquetas")
      .select("cliente_id")
      .eq("etiqueta_id", tagId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const id = String(row?.cliente_id || "");
      if (id) all.push(id);
    }
    if (rows.length < pageSize) break;
  }
  return Array.from(new Set(all));
}

async function loadClients(admin: any, clientIds: string[]) {
  const result = new Map<string, any>();
  for (const group of chunks(clientIds)) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, email")
      .in("id", group);
    if (error) throw error;
    for (const row of data || []) result.set(String(row.id), row);
  }
  return result;
}

async function loadRowsByClients(admin: any, table: string, clientIds: string[], range: DateRange) {
  const result: any[] = [];
  const dateColumn = table === "rendimiento_llamadas" ? "fecha_hora" : "created_at";
  for (const group of chunks(clientIds)) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .in("cliente_id", group)
      .gte(dateColumn, range.startIso)
      .lt(dateColumn, range.endIso)
      .order(dateColumn, { ascending: true });
    if (error) throw error;
    result.push(...(data || []));
  }
  return result;
}

function isMissingSourceColumnError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42703" || code === "PGRST100" || message.includes("billing_collaborator_id") || message.includes("source_tag_id");
}

async function loadRowsBySource(admin: any, table: string, definition: CollaboratorDefinition, range: DateRange) {
  const result: any[] = [];
  const dateColumn = table === "rendimiento_llamadas" ? "fecha_hora" : "created_at";
  const pageSize = 1000;

  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .or(`billing_collaborator_id.eq.${definition.id},source_tag_id.eq.${definition.tag_id}`)
      .gte(dateColumn, range.startIso)
      .lt(dateColumn, range.endIso)
      .order(dateColumn, { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      // crm_cliente_pagos puede no tener todavía las columnas de origen en una
      // instalación antigua. En ese caso se mantiene la asociación segura por
      // cliente y por coincidencia con la llamada, sin romper todo el informe.
      if (table === "crm_cliente_pagos" && isMissingSourceColumnError(error)) return [];
      throw error;
    }

    const rows = data || [];
    result.push(...rows);
    if (rows.length < pageSize) break;
  }

  return result;
}

function mergeRowsById(...groups: any[][]) {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const rows of groups) {
    for (const row of rows || []) {
      const id = String(row?.id || "").trim();
      const key = id || JSON.stringify([
        row?.cliente_id,
        row?.fecha_hora || row?.created_at || row?.fecha,
        row?.importe,
        row?.billing_collaborator_id,
        row?.source_tag_id,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}

function clientName(client: any, fallback: unknown) {
  const joined = [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim();
  return joined || String(fallback || client?.telefono || "Cliente").trim() || "Cliente";
}

function isExplicitTestRecord(row: any) {
  if (row?.is_test === true || row?.es_prueba === true || row?.test_mode === true) return true;

  // Nunca se descarta una llamada por el nombre visible del cliente. Un cliente
  // real puede llamarse "PRUEBA" y seguir teniendo UUID, minutos, importe y una
  // etiqueta CALL MARIO válidos. Solo se excluyen marcas estructuradas o textos
  // técnicos que identifiquen expresamente el registro como demo/test.
  const haystack = normalizeText([
    row?.tipo_registro,
    row?.notas,
    row?.notes,
    row?.referencia_externa,
  ].filter(Boolean).join(" "));
  return /(^|\s)(test|prueba|demo|testing)(\s|$)/.test(haystack);
}

function normalizeStatus(value: unknown): PaymentEntry["status_group"] {
  const status = normalizeText(value);
  if ([
    "completed", "complete", "paid", "captured", "approved", "succeeded", "success",
    "completado", "finalizado", "pagado", "aprobado", "confirmado", "procesado",
  ].includes(status)) return "completed";
  if (["refunded", "refund", "reembolsado", "reembolso", "reversed", "chargeback"].includes(status)) return "refunded";
  if (["cancelled", "canceled", "cancelado", "anulado", "void", "voided"].includes(status)) return "cancelled";
  if (["failed", "error", "declined", "rechazado", "fallido"].includes(status)) return "failed";
  return "other";
}

export function normalizePaymentMethod(value: unknown) {
  const raw = String(value || "").trim();
  const method = normalizeText(raw).replace(/[\s-]+/g, "_");
  if (!method) return { group: "Sin método", label: "Sin método" };
  if (method === "paypal_manual" || method.includes("virtual_terminal") || method === "tpv" || method.includes("stripe") || method === "card" || method.includes("square")) {
    return { group: "TPV", label: "TPV" };
  }
  if (method.includes("paypal")) return { group: "PayPal", label: "PayPal" };
  if (method.includes("bizum")) return { group: "Bizum", label: "Bizum" };
  if (method === "otros" || method === "other") return { group: "Otros", label: "Otros" };
  return { group: raw || "Otro", label: raw || "Otro" };
}

function parsePackNameFromNotes(notes: unknown) {
  const text = String(notes || "").trim();
  if (!text) return null;
  const match = text.match(/(?:checkout completado|compra automatizada|compra web)\s*[·:]\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function paymentFromCrm(row: any, client: any): PaymentEntry {
  const method = normalizePaymentMethod(row?.metodo);
  const status = normalizeStatus(row?.estado);
  return {
    id: String(row?.id || ""),
    source: "crm_cliente_pagos",
    cliente_id: String(row?.cliente_id || ""),
    cliente_nombre: clientName(client, null),
    created_at: String(row?.created_at || row?.updated_at || ""),
    amount: roundMoney(safeNumber(row?.importe)),
    currency: String(row?.moneda || "EUR").toUpperCase(),
    method_raw: String(row?.metodo || ""),
    method_group: method.group,
    status_raw: String(row?.estado || ""),
    status_group: status,
    reference: row?.referencia_externa || row?.paypal_capture_id || row?.paypal_order_id || row?.stripe_session_id || null,
    package_id: row?.pack_id ? String(row.pack_id) : null,
    package_name: row?.pack_name ? String(row.pack_name) : parsePackNameFromNotes(row?.notas),
    paid_minutes: Math.max(0, safeNumber(row?.paid_minutes)),
    bonus_minutes: Math.max(0, safeNumber(row?.bonus_minutes)),
    notes: row?.notas ? String(row.notas) : null,
  };
}

function codeMinutes(row: any) {
  const slots = [
    { code: String(row?.codigo_1 || ""), minutes: Math.max(0, safeNumber(row?.minutos_1)) },
    { code: String(row?.codigo_2 || ""), minutes: Math.max(0, safeNumber(row?.minutos_2)) },
  ];
  let gift = 0;
  let paid = 0;
  for (const slot of slots) {
    if (!slot.minutes) continue;
    if (normalizeText(slot.code).includes("free")) gift += slot.minutes;
    else paid += slot.minutes;
  }
  const total = Math.max(0, safeNumber(row?.tiempo));
  if (paid + gift === 0 && total > 0) {
    if (normalizeText(row?.resumen_codigo || row?.tipo_registro).includes("free")) gift = total;
    else paid = total;
  }
  return { paid: roundMoney(paid), gift: roundMoney(gift), total: roundMoney(total || paid + gift) };
}

function packageLabelFromPerformance(row: any, usage: { paid: number; gift: number; total: number }) {
  const storedPaid = Math.max(0, safeNumber(row?.minutos_guardados_normales));
  const storedGift = Math.max(0, safeNumber(row?.minutos_guardados_free));
  const purchasePaid = roundMoney(storedPaid + usage.paid);
  const purchaseGift = roundMoney(storedGift + usage.gift);

  if (row?.package_name) return String(row.package_name);
  if (row?.package_id) return String(row.package_id);
  if (Boolean(row?.cliente_compra_minutos) && (purchasePaid > 0 || purchaseGift > 0)) {
    if (purchaseGift > 0) return `${purchasePaid.toLocaleString("es-ES")} + ${purchaseGift.toLocaleString("es-ES")} minutos de regalo`;
    return `${purchasePaid.toLocaleString("es-ES")} minutos`;
  }
  if (String(row?.resumen_codigo || "").trim()) return String(row.resumen_codigo).trim();
  return Boolean(row?.cliente_compra_minutos) ? "Tarifa personalizada" : "Saldo de minutos previo";
}

function paymentFromPerformance(row: any, client: any): PaymentEntry | null {
  const amount = roundMoney(safeNumber(row?.importe));
  if (amount <= 0 || !Boolean(row?.cliente_compra_minutos)) return null;
  const method = normalizePaymentMethod(row?.forma_pago);
  const usage = codeMinutes(row);
  const packageName = packageLabelFromPerformance(row, usage);
  return {
    id: String(row?.id || ""),
    source: "rendimiento_llamadas",
    cliente_id: String(row?.cliente_id || ""),
    cliente_nombre: clientName(client, row?.cliente_nombre),
    created_at: String(row?.fecha_hora || row?.fecha || ""),
    amount,
    currency: String(row?.moneda || "EUR").toUpperCase(),
    method_raw: String(row?.forma_pago || ""),
    method_group: method.group,
    status_raw: "completed",
    status_group: "completed",
    reference: row?.payment_reference || row?.referencia_externa || null,
    package_id: row?.package_id ? String(row.package_id) : null,
    package_name: packageName,
    paid_minutes: Math.max(0, safeNumber(row?.minutos_guardados_normales)) + usage.paid,
    bonus_minutes: Math.max(0, safeNumber(row?.minutos_guardados_free)) + usage.gift,
    notes: null,
  };
}

function withinHours(a: string, b: string, hours = 36) {
  const ams = new Date(a).getTime();
  const bms = new Date(b).getTime();
  if (!Number.isFinite(ams) || !Number.isFinite(bms)) return false;
  return Math.abs(ams - bms) <= hours * 60 * 60 * 1000;
}

function samePayment(a: PaymentEntry, b: PaymentEntry) {
  if (a.cliente_id !== b.cliente_id) return false;
  if (Math.abs(a.amount - b.amount) > 0.005) return false;
  if (a.currency !== b.currency) return false;

  const referenceA = normalizeText(a.reference);
  const referenceB = normalizeText(b.reference);
  if (referenceA && referenceB) return referenceA === referenceB;

  if (a.method_group !== b.method_group) return false;
  if (a.package_id && b.package_id && a.package_id !== b.package_id) return false;
  return withinHours(a.created_at, b.created_at);
}

function mergePayments(crmPayments: PaymentEntry[], performancePayments: PaymentEntry[]) {
  const merged = [...crmPayments];
  const matchedCrmIndexes = new Set<number>();

  for (const candidate of performancePayments) {
    const duplicateIndex = crmPayments.findIndex((payment, index) => (
      !matchedCrmIndexes.has(index)
      && samePayment(payment, candidate)
    ));

    if (duplicateIndex >= 0) matchedCrmIndexes.add(duplicateIndex);
    else merged.push(candidate);
  }

  return merged.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function buildService(row: any, client: any): ServiceEntry | null {
  const usage = codeMinutes(row);
  if (usage.total <= 0) return null;
  const status = normalizeStatus(row?.estado || row?.status || "completed");
  if (["cancelled", "refunded", "failed"].includes(status)) return null;
  const method = normalizePaymentMethod(row?.forma_pago);
  const amount = roundMoney(safeNumber(row?.importe));
  return {
    id: String(row?.id || ""),
    cliente_id: String(row?.cliente_id || ""),
    cliente_nombre: clientName(client, row?.cliente_nombre),
    service_at: String(row?.fecha_hora || row?.fecha || ""),
    minutes_total: usage.total,
    paid_minutes_used: usage.paid,
    gift_minutes_used: usage.gift,
    package_label: packageLabelFromPerformance(row, usage),
    amount,
    currency: String(row?.moneda || "EUR").toUpperCase(),
    payment_method: amount > 0 ? method.label : "Saldo previo",
    payment_status: amount > 0 ? "Completado" : "Servicio completado",
    payment_reference: row?.payment_reference || row?.referencia_externa || null,
    tarotista_nombre: String(row?.tarotista_nombre || row?.tarotista_manual_call || "No disponible"),
    source: "rendimiento_llamadas",
  };
}

function emptySummary(): Summary {
  return {
    clients_total: 0,
    services_total: 0,
    minutes_total: 0,
    generated_total: 0,
    totals_by_method: {},
    totals_by_method_currency: {},
    totals_by_currency: {},
    cancelled_or_refunded: 0,
    completed_payments: 0,
  };
}

function summarize(services: ServiceEntry[], payments: PaymentEntry[]): Summary {
  const summary = emptySummary();
  summary.clients_total = new Set(services.map((service) => service.cliente_id)).size;
  summary.services_total = services.length;
  summary.minutes_total = roundMoney(services.reduce((sum, service) => sum + service.minutes_total, 0));

  for (const payment of payments) {
    if (["cancelled", "refunded"].includes(payment.status_group)) summary.cancelled_or_refunded += 1;
    if (payment.status_group !== "completed") continue;
    summary.completed_payments += 1;
    summary.generated_total = roundMoney(summary.generated_total + payment.amount);
    summary.totals_by_method[payment.method_group] = roundMoney((summary.totals_by_method[payment.method_group] || 0) + payment.amount);
    const methodCurrencies = summary.totals_by_method_currency[payment.method_group] || {};
    methodCurrencies[payment.currency] = roundMoney((methodCurrencies[payment.currency] || 0) + payment.amount);
    summary.totals_by_method_currency[payment.method_group] = methodCurrencies;
    summary.totals_by_currency[payment.currency] = roundMoney((summary.totals_by_currency[payment.currency] || 0) + payment.amount);
  }

  return summary;
}

function comparison(current: number, previous: number | null): Comparison {
  const hasPrevious = previous !== null;
  if (!hasPrevious) return { current, previous: null, change_pct: null, trend: "neutral", has_previous: false };
  const previousValue = safeNumber(previous);
  const trend = Math.abs(current - previousValue) < 0.005 ? "neutral" : current > previousValue ? "up" : "down";
  const changePct = previousValue === 0 ? (current === 0 ? 0 : null) : roundMoney(((current - previousValue) / Math.abs(previousValue)) * 100);
  return { current, previous: previousValue, change_pct: changePct, trend, has_previous: true };
}

function nonZeroCurrencies(summary: Summary | null) {
  if (!summary) return [] as string[];
  return Object.entries(summary.totals_by_currency || {})
    .filter(([, total]) => Math.abs(safeNumber(total)) >= 0.005)
    .map(([currency]) => currency)
    .sort();
}

function generatedRevenueComparison(current: Summary, previous: Summary | null): Comparison {
  if (!previous) return comparison(current.generated_total, null);

  const currentCurrencies = nonZeroCurrencies(current);
  const previousCurrencies = nonZeroCurrencies(previous);
  const hasMultipleCurrencies = currentCurrencies.length > 1 || previousCurrencies.length > 1;
  const currencyChanged = currentCurrencies.length === 1
    && previousCurrencies.length === 1
    && currentCurrencies[0] !== previousCurrencies[0];

  if (hasMultipleCurrencies || currencyChanged) {
    return {
      current: current.generated_total,
      previous: previous.generated_total,
      change_pct: null,
      trend: "neutral",
      has_previous: true,
      reason: "Monedas no comparables",
    };
  }

  return comparison(current.generated_total, previous.generated_total);
}

function calculatePayable(definition: CollaboratorDefinition, generatedTotal: number) {
  const type = normalizeText(definition.remuneration_type);
  const value = definition.remuneration_value;
  if (!type || value === null || value === undefined) {
    return {
      configured: false,
      type: null,
      value: null,
      payable_total: null,
      note: "No existe una fórmula de remuneración configurada para este colaborador.",
    };
  }
  if (type === "percentage") {
    return {
      configured: true,
      type,
      value,
      payable_total: roundMoney(generatedTotal * (safeNumber(value) / 100)),
      note: `Porcentaje configurado: ${safeNumber(value).toLocaleString("es-ES")} %.`,
    };
  }
  if (type === "fixed") {
    return {
      configured: true,
      type,
      value,
      payable_total: roundMoney(value),
      note: `Importe fijo mensual configurado: ${safeNumber(value).toLocaleString("es-ES")} €.`,
    };
  }
  return {
    configured: false,
    type,
    value,
    payable_total: null,
    note: "La regla guardada no es compatible; debe revisarse antes de calcular un pago.",
  };
}

function explicitCollaboratorMatch(row: any, definition: CollaboratorDefinition) {
  const rowCollaboratorId = String(row?.billing_collaborator_id || "").trim();
  const rowSourceTagId = String(row?.source_tag_id || "").trim();
  if (!rowCollaboratorId && !rowSourceTagId) return null;
  return rowCollaboratorId === definition.id || rowSourceTagId === definition.tag_id;
}

function performanceBelongsToCollaborator(
  row: any,
  definition: CollaboratorDefinition,
  taggedClientIds: Set<string>
) {
  const explicitMatch = explicitCollaboratorMatch(row, definition);
  if (explicitMatch !== null) return explicitMatch;

  // Rendimiento es la fuente operativa principal. Si la llamada no conserva aún
  // los campos de origen, se incluye mediante la relación real cliente -> etiqueta.
  // Esto recupera también registros existentes posteriores a la activación del
  // seguimiento por llamada, sin depender de una nota o de un texto visible.
  return taggedClientIds.has(String(row?.cliente_id || "").trim());
}

function crmPaymentBelongsToCollaborator(
  row: any,
  payment: PaymentEntry,
  definition: CollaboratorDefinition,
  performancePayments: PaymentEntry[],
  taggedClientIds: Set<string>
) {
  const explicitMatch = explicitCollaboratorMatch(row, definition);
  if (explicitMatch !== null) return explicitMatch;

  // Los pagos estructurados de clientes que tienen la etiqueta real CALL MARIO
  // pertenecen al informe. Si la etiqueta aún no está disponible, se conserva la
  // asociación segura mediante una llamada de Rendimiento ya atribuida a Mario.
  if (taggedClientIds.has(String(row?.cliente_id || "").trim())) return true;
  return performancePayments.some((candidate) => samePayment(candidate, payment));
}

async function loadPeriod(admin: any, definition: CollaboratorDefinition, month: string, taggedClientIds: string[]) {
  const range = monthRange(month);
  const taggedClientIdSet = new Set(taggedClientIds.map((id) => String(id || "").trim()).filter(isUuidText));

  // Fuente operativa principal: rendimiento_llamadas. Las relaciones explícitas
  // se consultan junto con todas las llamadas de clientes cuya etiqueta real es la
  // del colaborador; ambas fuentes se fusionan por el ID estable de la llamada.
  const [directPerformanceRows, directCrmPaymentRows] = await Promise.all([
    loadRowsBySource(admin, "rendimiento_llamadas", definition, range),
    loadRowsBySource(admin, "crm_cliente_pagos", definition, range),
  ]);

  // Si la etiqueta todavía no se ha reflejado, el UUID del cliente se recupera
  // directamente de la llamada/cobro marcado. Así también se puede localizar el
  // cobro estructurado correspondiente y conservar referencia y estado reales.
  const sourceClientIds = Array.from(new Set([
    ...taggedClientIds,
    ...directPerformanceRows.map((row: any) => String(row?.cliente_id || "").trim()),
    ...directCrmPaymentRows.map((row: any) => String(row?.cliente_id || "").trim()),
  ].filter(isUuidText)));

  const [clientPerformanceRows, clientCrmPaymentRows] = sourceClientIds.length
    ? await Promise.all([
        loadRowsByClients(admin, "rendimiento_llamadas", sourceClientIds, range),
        loadRowsByClients(admin, "crm_cliente_pagos", sourceClientIds, range),
      ])
    : [[], []];

  const performanceRows = mergeRowsById(directPerformanceRows, clientPerformanceRows);
  const crmPaymentRows = mergeRowsById(directCrmPaymentRows, clientCrmPaymentRows);
  const relatedClientIds = Array.from(new Set([
    ...sourceClientIds,
    ...performanceRows.map((row: any) => String(row?.cliente_id || "").trim()),
    ...crmPaymentRows.map((row: any) => String(row?.cliente_id || "").trim()),
  ].filter(isUuidText)));
  const clients = await loadClients(admin, relatedClientIds);

  const services: ServiceEntry[] = [];
  const performancePayments: PaymentEntry[] = [];
  for (const row of performanceRows) {
    if (!performanceBelongsToCollaborator(row, definition, taggedClientIdSet)) continue;
    const client = clients.get(String(row?.cliente_id || ""));
    if (isExplicitTestRecord(row)) continue;
    const service = buildService(row, client);
    if (service) services.push(service);
    const payment = paymentFromPerformance(row, client);
    if (payment) performancePayments.push(payment);
  }

  const crmPayments = (crmPaymentRows || [])
    .map((row: any) => ({
      row,
      payment: paymentFromCrm(row, clients.get(String(row?.cliente_id || ""))),
    }))
    .filter(({ row }: { row: any }) => !isExplicitTestRecord(row))
    .filter(({ row, payment }: { row: any; payment: PaymentEntry }) => (
      crmPaymentBelongsToCollaborator(row, payment, definition, performancePayments, taggedClientIdSet)
    ))
    .map(({ payment }: { payment: PaymentEntry }) => payment);

  const payments = mergePayments(crmPayments, performancePayments);
  services.sort((a, b) => String(b.service_at).localeCompare(String(a.service_at)));
  payments.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { services, payments, summary: summarize(services, payments) };
}

export async function loadCollaboratorMonthlyReport(
  admin: any,
  collaboratorId: string,
  month: string,
  options?: { includePrevious?: boolean }
): Promise<CollaboratorMonthlyReport> {
  const definitions = await listActiveCollaborators(admin);
  const definition = definitions.find((row) => row.id === collaboratorId);
  if (!definition) throw new Error("COLLABORATOR_NOT_FOUND");
  if (!definition.tag_id) throw new Error("COLLABORATOR_WITHOUT_TAG");

  const clientIds = await loadTaggedClientIds(admin, definition.tag_id);
  const previousMonth = previousMonthKey(month);
  const current = await loadPeriod(admin, definition, month, clientIds);
  const previous = options?.includePrevious === false
    ? null
    : await loadPeriod(admin, definition, previousMonth, clientIds);

  const previousHasData = Boolean(previous && (previous.services.length > 0 || previous.payments.length > 0));
  const previousSummary = previousHasData ? previous?.summary || null : null;
  const remuneration = calculatePayable(definition, current.summary.generated_total);
  const generatedComparison = generatedRevenueComparison(current.summary, previousSummary);

  return {
    collaborator: definition,
    month,
    previous_month: previousMonth,
    tag: { id: definition.tag_id, name: definition.tag_name },
    summary: current.summary,
    previous_summary: previousSummary,
    comparisons: {
      clients: comparison(current.summary.clients_total, previousSummary?.clients_total ?? null),
      services: comparison(current.summary.services_total, previousSummary?.services_total ?? null),
      minutes: comparison(current.summary.minutes_total, previousSummary?.minutes_total ?? null),
      generated: generatedComparison,
    },
    services: current.services,
    payments: current.payments.filter((payment) => payment.status_group !== "failed"),
    remuneration,
    sync: {
      source: "rendimiento_llamadas + crm_cliente_etiquetas(CALL MARIO) + crm_cliente_pagos",
      generated_at: new Date().toISOString(),
      tagged_clients: clientIds.length,
    },
  };
}

export function collaboratorReportToInvoiceRow(report: CollaboratorMonthlyReport) {
  const generatedComparison = report.comparisons.generated;
  const minutesComparison = report.comparisons.minutes;
  const currencyCodes = Object.keys(report.summary.totals_by_currency);
  return {
    invoice_id: `collaborator:${report.collaborator.id}:${report.month}`,
    collaborator_id: report.collaborator.id,
    worker_id: report.collaborator.id,
    display_name: report.collaborator.display_name,
    role: report.collaborator.role || "colaborador",
    month_key: report.month,
    status: report.remuneration.configured ? "calculado" : "informe",
    total: report.remuneration.payable_total || 0,
    generated_total: report.summary.generated_total,
    generated_currency: currencyCodes.length === 1 ? currencyCodes[0] : currencyCodes.length > 1 ? "MULTI" : "EUR",
    generated_by_currency: report.summary.totals_by_currency,
    payable_total: report.remuneration.payable_total,
    remuneration_configured: report.remuneration.configured,
    worker_ack: "not_applicable",
    worker_ack_at: null,
    worker_ack_note: report.remuneration.note,
    previous_month_key: report.previous_month,
    previous_total: report.previous_summary?.generated_total ?? null,
    previous_generated_by_currency: report.previous_summary?.totals_by_currency || {},
    current_minutes: report.summary.minutes_total,
    previous_minutes: report.previous_summary?.minutes_total ?? null,
    total_change_pct: generatedComparison.change_pct,
    minutes_change_pct: minutesComparison.change_pct,
    total_trend: generatedComparison.trend,
    minutes_trend: minutesComparison.trend,
    has_previous_invoice: generatedComparison.has_previous,
    comparison_note: generatedComparison.reason || null,
    trend_basis: "collaborator_minutes",
    is_collaborator: true,
    tag_id: report.tag.id,
    tag_name: report.tag.name,
    services_total: report.summary.services_total,
    clients_total: report.summary.clients_total,
    sync_source: report.sync.source,
    updated_at: report.sync.generated_at,
    created_at: report.sync.generated_at,
  };
}
