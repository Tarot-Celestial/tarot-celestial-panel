import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { brandFromRequest, filterRowsByBrand } from "@/lib/server/brand-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MADRID_TIME_ZONE = "Europe/Madrid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminClient = ReturnType<typeof adminClient>;
type GeneratedRow = { name: string; count: number; importe: number };
type DailyRow = {
  id: string;
  source: "operador" | "web";
  cliente_id: string | null;
  client_key: string;
  nombre: string;
  telefono: string | null;
  fecha_pago: string | null;
  importe: number;
  metodo: string;
  central: string;
  tarotista: string | null;
  estado: string;
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > maxDay) return null;
  return { year, month, day };
}

function madridTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(value: string, days: number) {
  const parsed = parseDateKey(value);
  if (!parsed) return madridTodayKey();
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return dateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function selectedDateKey(mode: string, rawDate: string | null) {
  const today = madridTodayKey();
  if (mode === "ayer") return shiftDateKey(today, -1);
  if (mode === "fecha" && rawDate && parseDateKey(rawDate)) return rawDate;
  return today;
}

function previousMonthEquivalentKey(value: string) {
  const parsed = parseDateKey(value);
  if (!parsed) return value;
  const previousMonthAnchor = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  const year = previousMonthAnchor.getUTCFullYear();
  const month = previousMonthAnchor.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return dateKey(year, month, Math.min(parsed.day, lastDay));
}

function previousMonthKey(value: string) {
  const parsed = parseDateKey(`${value}-01`);
  if (!parsed) return value;
  const previous = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  return `${previous.getUTCFullYear()}-${pad2(previous.getUTCMonth() + 1)}`;
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute),
    Number(values.second)
  );
  return representedAsUtc - date.getTime();
}

function madridMidnightUtc(value: string) {
  const parsed = parseDateKey(value);
  if (!parsed) throw new Error("Fecha no válida");
  let utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0));
  for (let index = 0; index < 2; index += 1) {
    utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0) - timeZoneOffsetMs(utc, MADRID_TIME_ZONE));
  }
  return utc;
}

function dayRangeFromKey(value: string) {
  return {
    start: madridMidnightUtc(value),
    end: madridMidnightUtc(shiftDateKey(value, 1)),
  };
}

function monthRangeFromKey(month: string) {
  const startKey = `${month}-01`;
  const parsed = parseDateKey(startKey);
  if (!parsed) throw new Error("Mes no válido");
  const nextMonth = new Date(Date.UTC(parsed.year, parsed.month, 1));
  const nextKey = dateKey(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1);
  return { start: madridMidnightUtc(startKey), end: madridMidnightUtc(nextKey) };
}

function cleanName(value: unknown, fallback = "—") {
  const text = String(value || "").trim();
  return text || fallback;
}

function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeState(value: unknown) {
  return String(value || "completed").trim().toLowerCase();
}

function normalizePaidRow(row: { estado?: unknown }) {
  const state = normalizeState(row?.estado);
  return ![
    "cancelled",
    "canceled",
    "cancelado",
    "cancelada",
    "anulado",
    "anulada",
    "rechazado",
    "rechazada",
    "failed",
    "fallido",
    "fallida",
    "error",
    "refunded",
    "reembolsado",
    "reembolsada",
    "pending",
    "pendiente",
  ].includes(state);
}

function isUuid(value: unknown) {
  return UUID_RE.test(String(value || "").trim());
}

async function fetchDailySources(supabase: AdminClient, start: Date, end: Date) {
  const [{ data: rendimiento, error: rendimientoError }, { data: pagos, error: pagosError }] = await Promise.all([
    supabase
      .from("rendimiento_llamadas")
      .select("id, cliente_id, cliente_nombre, telefonista_nombre, tarotista_nombre, tarotista_manual_call, fecha_hora, fecha, importe, forma_pago, resumen_codigo, cliente_compra_minutos")
      .gte("fecha_hora", start.toISOString())
      .lt("fecha_hora", end.toISOString())
      .or("cliente_compra_minutos.eq.true,importe.gt.0")
      .order("fecha_hora", { ascending: false }),
    supabase
      .from("crm_cliente_pagos")
      .select("id, cliente_id, importe, moneda, metodo, estado, created_at, created_by_user_id, created_by_role, referencia_externa, source_rendimiento_id")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false }),
  ]);

  if (rendimientoError) throw rendimientoError;
  if (pagosError) throw pagosError;
  return { rendimiento: rendimiento || [], pagos: pagos || [] };
}

async function fetchAllRendimiento(supabase: AdminClient, startIso: string, endIso: string) {
  const pageSize = 1000;
  const maxRows = 50000;
  const allRows: any[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from("rendimiento_llamadas")
      .select(
        "id, cliente_id, cliente_nombre, telefonista_worker_id, telefonista_nombre, tarotista_worker_id, tarotista_nombre, tarotista_manual_call, fecha_hora, fecha, importe, forma_pago, resumen_codigo, cliente_compra_minutos"
      )
      .gte("fecha_hora", startIso)
      .lt("fecha_hora", endIso)
      .gt("importe", 0)
      .order("fecha_hora", { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, maxRows - 1));

    if (error) throw error;
    const chunk = data || [];
    allRows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return allRows;
}

function addGenerated(map: Map<string, GeneratedRow>, rawName: unknown, amount: number, fallback: string) {
  const name = cleanName(rawName, fallback);
  const current = map.get(name) || { name, count: 0, importe: 0 };
  current.count += 1;
  current.importe = roundMoney(current.importe + amount);
  map.set(name, current);
}

function buildMonthlySummary(rows: any[], month: string) {
  const paidRows = (rows || []).filter((row) => normalizePaidRow(row));
  const byTelefonista = new Map<string, GeneratedRow>();
  const byTarotista = new Map<string, GeneratedRow>();

  for (const row of paidRows) {
    const amount = Number(row.importe || 0) || 0;
    if (amount <= 0) continue;
    addGenerated(byTelefonista, row.telefonista_nombre, amount, "Telefonista sin asignar");
    addGenerated(byTarotista, row.tarotista_nombre || row.tarotista_manual_call, amount, "Tarotista sin asignar");
  }

  const sortByAmount = (a: GeneratedRow, b: GeneratedRow) => b.importe - a.importe;
  return {
    month,
    total_importe_rendimiento: roundMoney(paidRows.reduce((sum, row) => sum + (Number(row.importe || 0) || 0), 0)),
    total_registros_rendimiento: paidRows.length,
    byTelefonista: Array.from(byTelefonista.values()).sort(sortByAmount),
    byTarotista: Array.from(byTarotista.values()).sort(sortByAmount),
  };
}

function mergePreviousRanking(currentRows: GeneratedRow[], previousRows: GeneratedRow[]) {
  const previousMap = new Map(previousRows.map((row) => [row.name, row]));
  return currentRows.map((row) => ({
    ...row,
    previous_count: previousMap.get(row.name)?.count ?? 0,
    previous_importe: previousMap.get(row.name)?.importe ?? 0,
  }));
}

function buildDailyResult(rows: DailyRow[]) {
  const completedRows = rows.filter(normalizePaidRow);
  const uniqueClients = new Set(completedRows.map((row) => row.client_key));
  const byCentralMap = new Map<string, GeneratedRow>();

  for (const row of completedRows) {
    addGenerated(byCentralMap, row.central, Number(row.importe || 0), row.source === "web" ? "Web automática" : "Central sin asignar");
  }

  return {
    rows: completedRows,
    totals: {
      total_clientes: uniqueClients.size,
      total_pagos: completedRows.length,
      total_importe: roundMoney(completedRows.reduce((sum, row) => sum + Number(row.importe || 0), 0)),
    },
    byCentral: Array.from(byCentralMap.values()).sort((a, b) => b.importe - a.importe),
  };
}

function mergePreviousCentral(currentRows: GeneratedRow[], previousRows: GeneratedRow[]) {
  const previousMap = new Map(previousRows.map((row) => [row.name, row]));
  return currentRows.map((row) => ({
    ...row,
    previous_count: previousMap.get(row.name)?.count ?? 0,
    previous_importe: previousMap.get(row.name)?.importe ?? 0,
  }));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = String(searchParams.get("mode") || "hoy");
    const selectedDay = selectedDateKey(mode, searchParams.get("date"));
    const comparisonDay = previousMonthEquivalentKey(selectedDay);
    const selectedMonth = selectedDay.slice(0, 7);
    const comparisonMonth = previousMonthKey(selectedMonth);
    const selectedDayRange = dayRangeFromKey(selectedDay);
    const comparisonDayRange = dayRangeFromKey(comparisonDay);
    const selectedMonthRange = monthRangeFromKey(selectedMonth);
    const comparisonMonthRange = monthRangeFromKey(comparisonMonth);
    const supabase = adminClient();
    const brand = brandFromRequest(req);

    const [currentSources, previousSources, monthlyCurrentRaw, monthlyPreviousRaw] = await Promise.all([
      fetchDailySources(supabase, selectedDayRange.start, selectedDayRange.end),
      fetchDailySources(supabase, comparisonDayRange.start, comparisonDayRange.end),
      fetchAllRendimiento(supabase, selectedMonthRange.start.toISOString(), selectedMonthRange.end.toISOString()),
      fetchAllRendimiento(supabase, comparisonMonthRange.start.toISOString(), comparisonMonthRange.end.toISOString()),
    ]);

    const [currentRendimiento, currentPagos, previousRendimiento, previousPagos, monthlyCurrent, monthlyPrevious] = await Promise.all([
      filterRowsByBrand(supabase, currentSources.rendimiento, brand),
      filterRowsByBrand(supabase, currentSources.pagos, brand),
      filterRowsByBrand(supabase, previousSources.rendimiento, brand),
      filterRowsByBrand(supabase, previousSources.pagos, brand),
      filterRowsByBrand(supabase, monthlyCurrentRaw, brand),
      filterRowsByBrand(supabase, monthlyPreviousRaw, brand),
    ]);

    const allDailyRows = [...currentRendimiento, ...currentPagos, ...previousRendimiento, ...previousPagos];
    const clientIds = Array.from(
      new Set(allDailyRows.map((row: any) => String(row?.cliente_id || "").trim()).filter(isUuid))
    );
    const workerIds = Array.from(
      new Set([...currentPagos, ...previousPagos].map((row: any) => String(row?.created_by_user_id || "").trim()).filter(isUuid))
    );

    const [{ data: clients, error: clientsError }, { data: workers, error: workersError }] = await Promise.all([
      clientIds.length
        ? supabase.from("crm_clientes").select("id, nombre, apellido, telefono, email").in("id", clientIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      workerIds.length
        ? supabase.from("workers").select("id, display_name, role, email").in("id", workerIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (clientsError) throw clientsError;
    if (workersError) throw workersError;

    const clientMap = new Map<string, any>((clients || []).map((client: any) => [String(client.id), client]));
    const workerMap = new Map<string, any>((workers || []).map((worker: any) => [String(worker.id), worker]));

    const hydrateDailyRows = (rendimientoRows: any[], paymentRows: any[]): DailyRow[] => [
      ...rendimientoRows.map((row: any) => {
        const clientId = String(row.cliente_id || "").trim();
        const client = clientMap.get(clientId);
        const name = cleanName(row.cliente_nombre, [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim() || "Cliente");
        const phone = String(client?.telefono || "").trim() || null;
        return {
          id: `rend-${row.id}`,
          source: "operador" as const,
          cliente_id: clientId || null,
          client_key: clientId || `${name.toLowerCase()}|${phone || ""}`,
          nombre: name,
          telefono: phone,
          fecha_pago: row.fecha_hora || row.fecha || null,
          importe: Number(row.importe || 0),
          metodo: cleanName(row.forma_pago || row.resumen_codigo, "Rendimiento"),
          central: cleanName(row.telefonista_nombre, "Central sin asignar"),
          tarotista: cleanName(row.tarotista_nombre || row.tarotista_manual_call, "—"),
          estado: "completed",
        };
      }),
      ...paymentRows.map((row: any) => {
        const clientId = String(row.cliente_id || "").trim();
        const client = clientMap.get(clientId);
        const worker = workerMap.get(String(row.created_by_user_id || ""));
        const role = String(row.created_by_role || "").toLowerCase();
        const isWeb = !row.created_by_user_id || role.includes("web") || role.includes("cliente");
        const name = cleanName([client?.nombre, client?.apellido].filter(Boolean).join(" ").trim(), "Cliente");
        const phone = String(client?.telefono || "").trim() || null;
        return {
          id: `pago-${row.id}`,
          source: isWeb ? ("web" as const) : ("operador" as const),
          cliente_id: clientId || null,
          client_key: clientId || `${name.toLowerCase()}|${phone || ""}`,
          nombre: name,
          telefono: phone,
          fecha_pago: row.created_at || null,
          importe: Number(row.importe || 0),
          metodo: cleanName(row.metodo || row.referencia_externa, "Pago web"),
          central: isWeb ? "Web automática" : cleanName(worker?.display_name, "Central sin asignar"),
          tarotista: null,
          estado: normalizeState(row.estado),
        };
      }),
    ].sort((a, b) => new Date(b.fecha_pago || 0).getTime() - new Date(a.fecha_pago || 0).getTime());

    // Los cobros creados desde Registrar llamada tienen una fila operativa en
    // rendimiento_llamadas y una fila económica oficial en crm_cliente_pagos.
    // En Diario se conserva la fila operativa (incluye tarotista y telefonista)
    // y se excluye únicamente su pago enlazado para no duplicar el importe.
    const withoutLinkedCallPayments = (rows: any[]) => rows.filter((row: any) =>
      !String(row?.source_rendimiento_id || "").trim()
    );

    const currentDaily = buildDailyResult(
      hydrateDailyRows(currentRendimiento, withoutLinkedCallPayments(currentPagos))
    );
    const previousDaily = buildDailyResult(
      hydrateDailyRows(previousRendimiento, withoutLinkedCallPayments(previousPagos))
    );
    const currentMonthSummary = buildMonthlySummary(monthlyCurrent, selectedMonth);
    const previousMonthSummary = buildMonthlySummary(monthlyPrevious, comparisonMonth);

    const response = NextResponse.json({
      ok: true,
      rows: currentDaily.rows.map(({ client_key: _clientKey, ...row }) => row),
      totals: currentDaily.totals,
      byCentral: mergePreviousCentral(currentDaily.byCentral, previousDaily.byCentral),
      dailyComparison: {
        date: comparisonDay,
        totals: previousDaily.totals,
      },
      monthlySummary: {
        ...currentMonthSummary,
        previous_month: comparisonMonth,
        previous_total_importe_rendimiento: previousMonthSummary.total_importe_rendimiento,
        previous_total_registros_rendimiento: previousMonthSummary.total_registros_rendimiento,
        byTelefonista: mergePreviousRanking(currentMonthSummary.byTelefonista, previousMonthSummary.byTelefonista),
        byTarotista: mergePreviousRanking(currentMonthSummary.byTarotista, previousMonthSummary.byTarotista),
      },
      period: {
        mode,
        selected_date: selectedDay,
        comparison_date: comparisonDay,
        selected_month: selectedMonth,
        comparison_month: comparisonMonth,
        time_zone: MADRID_TIME_ZONE,
      },
      brand,
    });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error: any) {
    console.error("[Diario] Error cargando datos", error);
    const response = NextResponse.json({ ok: false, error: error?.message || "Error cargando diario" }, { status: 500 });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  }
}
