import { getAdminClient } from "@/lib/server/auth-worker";

type RendimientoRow = {
  id?: string | null;
  fecha?: string | null;
  fecha_hora?: string | null;
  created_at?: string | null;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  telefonista_worker_id?: string | null;
  telefonista_nombre?: string | null;
  tarotista_worker_id?: string | null;
  tarotista_nombre?: string | null;
  tarotista_manual_call?: string | null;
  llamada_call?: boolean | null;
  tipo_registro?: string | null;
  resumen_codigo?: string | null;
  tiempo?: number | string | null;
  forma_pago?: string | null;
  importe?: number | string | null;
  edit_revision?: number | string | null;
};

type TariffRow = {
  id: string;
  rate_per_minute: number | string;
  effective_from: string;
  created_at?: string | null;
};

type ClientRow = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
};

export type WelldoneRange = {
  start: string;
  end: string;
};

export type WelldoneFilters = {
  client?: string;
  phone?: string;
  telefonista?: string;
  method?: string;
  type?: string;
  corrected?: "all" | "yes" | "no" | string;
};

export type WelldoneDetailRow = {
  id: string;
  occurred_at: string;
  date: string;
  time: string;
  client_id: string | null;
  client_name: string;
  phone: string | null;
  telefonista_worker_id: string | null;
  telefonista_name: string;
  tarotista_origen: string;
  type: string;
  code: string;
  minutes: number;
  rate_per_minute: number | null;
  cost: number | null;
  payment_method: string;
  amount: number;
  corrected: boolean;
  revision: number;
  reference: string;
};

export type WelldoneDaily = {
  date: string;
  calls: number;
  minutes: number;
  cost: number;
  avg_minutes: number;
  avg_cost: number;
  cumulative_cost: number;
};

export type WelldoneSummary = {
  calls: number;
  minutes: number;
  cost: number;
  avg_minutes: number;
  avg_cost: number;
  unpriced_calls: number;
  unpriced_minutes: number;
};

export type WelldoneComparisonMetric = {
  current: number;
  previous: number;
  change_pct: number | null;
  trend: "up" | "down" | "flat";
};

export type WelldoneReport = {
  range: WelldoneRange;
  previous_range: WelldoneRange;
  summary: WelldoneSummary;
  previous_summary: WelldoneSummary;
  comparison: {
    minutes: WelldoneComparisonMetric;
    cost: WelldoneComparisonMetric;
    calls: WelldoneComparisonMetric;
    avg_minutes: WelldoneComparisonMetric;
    avg_cost: WelldoneComparisonMetric;
  };
  current_rate: number;
  tariffs: Array<{ id: string; rate_per_minute: number; effective_from: string }>;
  daily: WelldoneDaily[];
  detail: WelldoneDetailRow[];
  pagination: { page: number; page_size: number; total: number; pages: number };
  filter_options: { telefonistas: string[]; methods: string[]; types: string[] };
  source: {
    calls: "tc_rendimiento_list";
    stable_call_flag: "llamada_call";
    minutes: "tiempo";
    correction_revision: "edit_revision";
  };
};

function safeNumber(value: unknown) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function decimalUnits(value: unknown, scale = 6): bigint {
  const raw = String(value ?? "0").trim().replace(",", ".");
  const sign = raw.startsWith("-") ? -1n : 1n;
  const clean = raw.replace(/^[+-]/, "");
  const [wholeRaw, fracRaw = ""] = clean.split(".");
  const whole = /^\d+$/.test(wholeRaw || "") ? wholeRaw : "0";
  const frac = (fracRaw.replace(/\D/g, "") + "0".repeat(scale)).slice(0, scale);
  return sign * (BigInt(whole) * (10n ** BigInt(scale)) + BigInt(frac || "0"));
}

function moneyFromMinutes(minutes: unknown, rate: unknown) {
  const scale = 1_000_000n;
  const minuteUnits = decimalUnits(minutes, 6);
  const rateUnits = decimalUnits(rate, 6);
  const micros = (minuteUnits * rateUnits + scale / 2n) / scale;
  return round(Number(micros) / 1_000_000, 2);
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isoDate(value: unknown) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function occurredAt(row: RendimientoRow) {
  return String(row.fecha_hora || row.created_at || row.fecha || "");
}

function displayClient(client: ClientRow | undefined, row: RendimientoRow) {
  const joined = [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim();
  return joined || String(row.cliente_nombre || client?.telefono || "Cliente").trim() || "Cliente";
}

export function monthRange(monthKey: string): WelldoneRange {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("INVALID_MONTH");
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, "0")}` };
}

export function previousRange(range: WelldoneRange): WelldoneRange {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const isFullCalendarMonth = sameMonth && start.getUTCDate() === 1 && end.getUTCDate() === lastDay;
  if (isFullCalendarMonth) {
    const prevMonthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
    return { start: prevMonthStart.toISOString().slice(0, 10), end: prevMonthEnd.toISOString().slice(0, 10) };
  }
  const spanMs = Math.max(0, end.getTime() - start.getTime()) + 86_400_000;
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - spanMs + 86_400_000);
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
  };
}

async function loadTariffs(): Promise<TariffRow[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("welldone_tariffs")
    .select("id, rate_per_minute, effective_from, created_at")
    .order("effective_from", { ascending: true });
  if (error) {
    const code = String((error as any)?.code || "");
    const message = String((error as any)?.message || "").toLowerCase();
    if (code === "42P01" || message.includes("welldone_tariffs")) throw new Error("WELLDONE_SQL_REQUIRED");
    throw error;
  }
  return (data || []) as TariffRow[];
}

function rateForDate(date: string, tariffs: TariffRow[]) {
  let selected: TariffRow | null = null;
  for (const tariff of tariffs) {
    if (String(tariff.effective_from) <= date) selected = tariff;
    else break;
  }
  return selected ? safeNumber(selected.rate_per_minute) : null;
}

async function loadRendimientoCallRows(workerId: string, range: WelldoneRange): Promise<RendimientoRow[]> {
  const admin = getAdminClient();
  const rows: RendimientoRow[] = [];
  const size = 100;
  let page = 1;
  let pages = 1;

  do {
    const { data, error } = await admin.rpc("tc_rendimiento_list", {
      p_worker: workerId,
      p_filters: { call: "true", from: range.start, to: range.end },
      p_page: page,
      p_size: size,
    });
    if (error) throw error;
    const payload = data || {};
    const chunk = Array.isArray(payload.data) ? payload.data as RendimientoRow[] : [];
    rows.push(...chunk.filter((row) => row.llamada_call === true));
    pages = Math.max(1, Math.min(500, Number(payload?.pagination?.pages || 1) || 1));
    page += 1;
  } while (page <= pages);

  return rows;
}

async function loadClients(ids: string[]) {
  const admin = getAdminClient();
  const map = new Map<string, ClientRow>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id,nombre,apellido,telefono")
      .in("id", chunk);
    if (error) throw error;
    for (const row of (data || []) as ClientRow[]) map.set(String(row.id), row);
  }
  return map;
}

function makeDetail(row: RendimientoRow, client: ClientRow | undefined, tariffs: TariffRow[]): WelldoneDetailRow | null {
  const minutes = round(Math.max(0, safeNumber(row.tiempo)), 2);
  if (minutes <= 0) return null;
  const date = isoDate(occurredAt(row));
  if (!date) return null;
  const resolvedRate = rateForDate(date, tariffs);
  const rate = resolvedRate == null ? null : round(resolvedRate, 6);
  const stamp = occurredAt(row);
  const dt = new Date(stamp);
  const time = Number.isFinite(dt.getTime())
    ? dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : "—";
  const revision = Math.max(0, Math.trunc(safeNumber(row.edit_revision)));
  return {
    id: String(row.id || ""),
    occurred_at: stamp,
    date,
    time,
    client_id: row.cliente_id ? String(row.cliente_id) : null,
    client_name: displayClient(client, row),
    phone: client?.telefono ? String(client.telefono) : null,
    telefonista_worker_id: row.telefonista_worker_id ? String(row.telefonista_worker_id) : null,
    telefonista_name: String(row.telefonista_nombre || "—"),
    tarotista_origen: String(row.tarotista_manual_call || row.tarotista_nombre || "CALL"),
    type: String(row.tipo_registro || "—"),
    code: String(row.resumen_codigo || "—"),
    minutes,
    rate_per_minute: rate,
    cost: rate == null ? null : moneyFromMinutes(minutes, rate),
    payment_method: String(row.forma_pago || "—"),
    amount: round(safeNumber(row.importe), 2),
    corrected: revision > 0,
    revision,
    reference: String(row.id || ""),
  };
}

function summarize(rows: WelldoneDetailRow[]): WelldoneSummary {
  const calls = rows.length;
  const minutes = round(rows.reduce((sum, row) => sum + row.minutes, 0), 2);
  const pricedRows = rows.filter((row) => row.cost != null);
  const cost = round(pricedRows.reduce((sum, row) => sum + Number(row.cost || 0), 0), 2);
  const unpricedRows = rows.filter((row) => row.cost == null);
  const unpricedMinutes = round(unpricedRows.reduce((sum, row) => sum + row.minutes, 0), 2);
  return {
    calls,
    minutes,
    cost,
    avg_minutes: calls ? round(minutes / calls, 2) : 0,
    avg_cost: pricedRows.length ? round(cost / pricedRows.length, 2) : 0,
    unpriced_calls: unpricedRows.length,
    unpriced_minutes: unpricedMinutes,
  };
}

function compare(current: number, previous: number): WelldoneComparisonMetric {
  const trend = Math.abs(current - previous) < 0.000001 ? "flat" : current > previous ? "up" : "down";
  const change_pct = previous === 0 ? (current === 0 ? 0 : null) : round(((current - previous) / Math.abs(previous)) * 100, 2);
  return { current, previous, change_pct, trend };
}

function buildDaily(rows: WelldoneDetailRow[], range: WelldoneRange) {
  const byDate = new Map<string, WelldoneDaily>();
  const pricedCallsByDate = new Map<string, number>();
  const cursor = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    byDate.set(key, { date: key, calls: 0, minutes: 0, cost: 0, avg_minutes: 0, avg_cost: 0, cumulative_cost: 0 });
    pricedCallsByDate.set(key, 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const row of rows) {
    const item = byDate.get(row.date);
    if (!item) continue;
    item.calls += 1;
    item.minutes = round(item.minutes + row.minutes, 2);
    if (row.cost != null) {
      item.cost = round(item.cost + row.cost, 2);
      pricedCallsByDate.set(row.date, (pricedCallsByDate.get(row.date) || 0) + 1);
    }
  }
  let cumulative = 0;
  for (const item of byDate.values()) {
    const pricedCalls = pricedCallsByDate.get(item.date) || 0;
    item.avg_minutes = item.calls ? round(item.minutes / item.calls, 2) : 0;
    item.avg_cost = pricedCalls ? round(item.cost / pricedCalls, 2) : 0;
    cumulative = round(cumulative + item.cost, 2);
    item.cumulative_cost = cumulative;
  }
  return Array.from(byDate.values());
}

export async function buildWelldoneReport(input: {
  workerId: string;
  range: WelldoneRange;
  filters?: WelldoneFilters;
  page?: number;
  pageSize?: number;
}): Promise<WelldoneReport> {
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(input.pageSize || 25)));
  const prevRange = previousRange(input.range);
  const [tariffs, currentRaw, previousRaw] = await Promise.all([
    loadTariffs(),
    loadRendimientoCallRows(input.workerId, input.range),
    loadRendimientoCallRows(input.workerId, prevRange),
  ]);
  if (!tariffs.length) throw new Error("WELLDONE_TARIFF_MISSING");

  const clientIds = [
    ...currentRaw.map((row) => String(row.cliente_id || "")),
    ...previousRaw.map((row) => String(row.cliente_id || "")),
  ].filter(Boolean);
  const clients = await loadClients(clientIds);

  const currentAll = currentRaw
    .map((row) => makeDetail(row, row.cliente_id ? clients.get(String(row.cliente_id)) : undefined, tariffs))
    .filter(Boolean) as WelldoneDetailRow[];
  const previousAll = previousRaw
    .map((row) => makeDetail(row, row.cliente_id ? clients.get(String(row.cliente_id)) : undefined, tariffs))
    .filter(Boolean) as WelldoneDetailRow[];

  const clientFilter = normalizeText(input.filters?.client);
  const phoneFilter = normalizeText(input.filters?.phone).replace(/\s+/g, "");
  const telefonistaFilter = normalizeText(input.filters?.telefonista);
  const methodFilter = normalizeText(input.filters?.method);
  const typeFilter = normalizeText(input.filters?.type);
  const correctedFilter = String(input.filters?.corrected || "all");
  const applyFilters = (rows: WelldoneDetailRow[]) => rows.filter((row) => {
    if (clientFilter && !normalizeText(row.client_name).includes(clientFilter)) return false;
    if (phoneFilter && !normalizeText(row.phone).replace(/\s+/g, "").includes(phoneFilter)) return false;
    if (telefonistaFilter && normalizeText(row.telefonista_name) !== telefonistaFilter) return false;
    if (methodFilter && normalizeText(row.payment_method) !== methodFilter) return false;
    if (typeFilter && normalizeText(row.type) !== typeFilter) return false;
    if (correctedFilter === "yes" && !row.corrected) return false;
    if (correctedFilter === "no" && row.corrected) return false;
    return true;
  });
  const filtered = applyFilters(currentAll);
  const previousFiltered = applyFilters(previousAll);

  filtered.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  const summary = summarize(filtered);
  const previousSummary = summarize(previousFiltered);
  const costComparison = compare(summary.cost, previousSummary.cost);
  const avgCostComparison = compare(summary.avg_cost, previousSummary.avg_cost);
  if (summary.unpriced_calls > 0 || previousSummary.unpriced_calls > 0) {
    costComparison.change_pct = null;
    avgCostComparison.change_pct = null;
  }
  const comparison = {
    minutes: compare(summary.minutes, previousSummary.minutes),
    cost: costComparison,
    calls: compare(summary.calls, previousSummary.calls),
    avg_minutes: compare(summary.avg_minutes, previousSummary.avg_minutes),
    avg_cost: avgCostComparison,
  };

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const detail = filtered.slice(start, start + pageSize);
  const today = new Date().toISOString().slice(0, 10);
  const currentRateResolved = rateForDate(today, tariffs);
  const currentRate = currentRateResolved == null ? 0 : round(currentRateResolved, 6);

  return {
    range: input.range,
    previous_range: prevRange,
    summary,
    previous_summary: previousSummary,
    comparison,
    current_rate: currentRate,
    tariffs: tariffs.map((row) => ({ id: String(row.id), rate_per_minute: round(safeNumber(row.rate_per_minute), 6), effective_from: String(row.effective_from) })),
    daily: buildDaily(filtered, input.range),
    detail,
    pagination: { page: safePage, page_size: pageSize, total, pages },
    filter_options: {
      telefonistas: Array.from(new Set(currentAll.map((row) => row.telefonista_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")),
      methods: Array.from(new Set(currentAll.map((row) => row.payment_method).filter((value) => value && value !== "—"))).sort((a, b) => a.localeCompare(b, "es")),
      types: Array.from(new Set(currentAll.map((row) => row.type).filter((value) => value && value !== "—"))).sort((a, b) => a.localeCompare(b, "es")),
    },
    source: {
      calls: "tc_rendimiento_list",
      stable_call_flag: "llamada_call",
      minutes: "tiempo",
      correction_revision: "edit_revision",
    },
  };
}
