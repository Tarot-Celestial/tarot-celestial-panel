import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { brandFromRequest, filterRowsByBrand } from "@/lib/server/brand-filter";
import { isValidEconomicPayment } from "@/lib/server/economic-payments";
import { monthToDateComparison } from "@/lib/server/madrid-reporting-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MADRID_TIME_ZONE = "Europe/Madrid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GeneratedRow = { name: string; count: number; importe: number };
type DailyRow = {
  id: string;
  payment_id: string;
  source_rendimiento_id: string | null;
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
    { auth: { persistSession: false } },
  );
}

function pad2(value: number) { return String(value).padStart(2, "0"); }
function dateKey(year: number, month: number, day: number) { return `${year}-${pad2(month)}-${pad2(day)}`; }
function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > maxDay) return null;
  return { year, month, day };
}
function madridTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: MADRID_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shiftDateKey(value: string, days: number) {
  const parsed = parseDateKey(value); if (!parsed) return madridTodayKey();
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
  const parsed = parseDateKey(value); if (!parsed) return value;
  const anchor = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  const year = anchor.getUTCFullYear(); const month = anchor.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return dateKey(year, month, Math.min(parsed.day, lastDay));
}
function previousMonthKey(value: string) {
  const parsed = parseDateKey(`${value}-01`); if (!parsed) return value;
  const previous = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  return `${previous.getUTCFullYear()}-${pad2(previous.getUTCMonth() + 1)}`;
}
function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour) === 24 ? 0 : Number(values.hour), Number(values.minute), Number(values.second));
  return representedAsUtc - date.getTime();
}
function madridMidnightUtc(value: string) {
  const parsed = parseDateKey(value); if (!parsed) throw new Error("Fecha no válida");
  let utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  for (let i = 0; i < 2; i += 1) utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) - timeZoneOffsetMs(utc, MADRID_TIME_ZONE));
  return utc;
}
function dayRangeFromKey(value: string) { return { start: madridMidnightUtc(value), end: madridMidnightUtc(shiftDateKey(value, 1)) }; }
function monthRangeFromKey(month: string) {
  const parsed = parseDateKey(`${month}-01`); if (!parsed) throw new Error("Mes no válido");
  const next = new Date(Date.UTC(parsed.year, parsed.month, 1));
  return { start: madridMidnightUtc(`${month}-01`), end: madridMidnightUtc(dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, 1)) };
}
function cleanName(value: unknown, fallback = "—") { const text = String(value || "").trim(); return text || fallback; }
function roundMoney(value: unknown) { return Math.round((Number(value) || 0) * 100) / 100; }
function isUuid(value: unknown) { return UUID_RE.test(String(value || "").trim()); }

async function fetchPayments(supabase: ReturnType<typeof adminClient>, start: Date, end: Date) {
  const rows: any[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await supabase
      .from("crm_cliente_pagos")
      .select("id,cliente_id,importe,moneda,metodo,estado,created_at,created_by_user_id,created_by_role,referencia_externa,source_rendimiento_id")
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString())
      .order("created_at", { ascending: false }).range(offset, offset + 999);
    if (error) throw error;
    const chunk = data || []; rows.push(...chunk); if (chunk.length < 1000) break;
  }
  return rows;
}

async function hydratePaymentRows(supabase: ReturnType<typeof adminClient>, payments: any[]): Promise<DailyRow[]> {
  const validPayments = payments.filter(isValidEconomicPayment).filter((row) => Number(row?.importe || 0) > 0);
  const clientIds = Array.from(new Set(validPayments.map((row) => String(row?.cliente_id || "")).filter(isUuid)));
  const rendimientoIds = Array.from(new Set(validPayments.map((row) => String(row?.source_rendimiento_id || "")).filter(isUuid)));
  const creatorIds = Array.from(new Set(validPayments.map((row) => String(row?.created_by_user_id || "")).filter(isUuid)));

  const [clientsRes, rendimientoRes, workersByIdRes, workersByUserRes] = await Promise.all([
    clientIds.length ? supabase.from("crm_clientes").select("id,nombre,apellido,telefono,email").in("id", clientIds) : Promise.resolve({ data: [], error: null }),
    rendimientoIds.length ? supabase.from("rendimiento_llamadas").select("id,cliente_nombre,telefonista_nombre,tarotista_nombre,tarotista_manual_call,fecha_hora,fecha,forma_pago").in("id", rendimientoIds) : Promise.resolve({ data: [], error: null }),
    creatorIds.length ? supabase.from("workers").select("id,user_id,display_name,email").in("id", creatorIds) : Promise.resolve({ data: [], error: null }),
    creatorIds.length ? supabase.from("workers").select("id,user_id,display_name,email").in("user_id", creatorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [clientsRes, rendimientoRes, workersByIdRes, workersByUserRes]) if (result.error) throw result.error;

  const clientMap = new Map<string, any>((clientsRes.data || []).map((row: any) => [String(row.id), row]));
  const rendimientoMap = new Map<string, any>((rendimientoRes.data || []).map((row: any) => [String(row.id), row]));
  const workerMap = new Map<string, any>();
  for (const row of [...(workersByIdRes.data || []), ...(workersByUserRes.data || [])] as any[]) {
    workerMap.set(String(row.id), row); if (row.user_id) workerMap.set(String(row.user_id), row);
  }

  return validPayments.map((payment: any) => {
    const clientId = String(payment.cliente_id || "");
    const client = clientMap.get(clientId);
    const rendimiento = rendimientoMap.get(String(payment.source_rendimiento_id || ""));
    const worker = workerMap.get(String(payment.created_by_user_id || ""));
    const role = String(payment.created_by_role || "").toLowerCase();
    const isWeb = !payment.created_by_user_id || role.includes("web") || role.includes("cliente");
    const nombre = cleanName(rendimiento?.cliente_nombre || [client?.nombre, client?.apellido].filter(Boolean).join(" "), "Cliente");
    const telefono = String(client?.telefono || "").trim() || null;
    return {
      id: `pago-${payment.id}`,
      payment_id: String(payment.id),
      source_rendimiento_id: isUuid(payment.source_rendimiento_id) ? String(payment.source_rendimiento_id) : null,
      source: isWeb ? "web" : "operador",
      cliente_id: clientId || null,
      client_key: clientId || `${nombre.toLowerCase()}|${telefono || ""}`,
      nombre,
      telefono,
      fecha_pago: payment.created_at,
      importe: Number(payment.importe || 0),
      metodo: cleanName(payment.metodo || rendimiento?.forma_pago, "Pago"),
      central: isWeb ? "Web automática" : cleanName(rendimiento?.telefonista_nombre || worker?.display_name, "Central sin asignar"),
      tarotista: rendimiento ? cleanName(rendimiento.tarotista_nombre || rendimiento.tarotista_manual_call, "—") : null,
      estado: String(payment.estado || "completed").trim().toLowerCase(),
    } as DailyRow;
  }).sort((a, b) => new Date(b.fecha_pago || 0).getTime() - new Date(a.fecha_pago || 0).getTime());
}

function addGenerated(map: Map<string, GeneratedRow>, rawName: unknown, amount: number, fallback: string) {
  const name = cleanName(rawName, fallback); const current = map.get(name) || { name, count: 0, importe: 0 };
  current.count += 1; current.importe = roundMoney(current.importe + amount); map.set(name, current);
}
function buildDailyResult(rows: DailyRow[]) {
  const uniqueClients = new Set(rows.map((row) => row.client_key)); const byCentral = new Map<string, GeneratedRow>();
  for (const row of rows) addGenerated(byCentral, row.central, row.importe, row.source === "web" ? "Web automática" : "Central sin asignar");
  return { rows, totals: { total_clientes: uniqueClients.size, total_pagos: rows.length, total_importe: roundMoney(rows.reduce((sum, row) => sum + row.importe, 0)) }, byCentral: Array.from(byCentral.values()).sort((a, b) => b.importe - a.importe) };
}
function buildMonthlySummary(rows: DailyRow[], month: string) {
  const byTelefonista = new Map<string, GeneratedRow>(); const byTarotista = new Map<string, GeneratedRow>();
  for (const row of rows) { addGenerated(byTelefonista, row.central, row.importe, row.source === "web" ? "Web automática" : "Telefonista sin asignar"); addGenerated(byTarotista, row.tarotista, row.importe, "Tarotista sin asignar"); }
  const sort = (a: GeneratedRow, b: GeneratedRow) => b.importe - a.importe;
  return { month, total_importe_rendimiento: roundMoney(rows.reduce((sum, row) => sum + row.importe, 0)), total_registros_rendimiento: rows.length, byTelefonista: Array.from(byTelefonista.values()).sort(sort), byTarotista: Array.from(byTarotista.values()).sort(sort) };
}
function mergePrevious(current: GeneratedRow[], previous: GeneratedRow[]) {
  const map = new Map(previous.map((row) => [row.name, row]));
  return current.map((row) => ({ ...row, previous_count: map.get(row.name)?.count ?? 0, previous_importe: map.get(row.name)?.importe ?? 0 }));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url); const mode = String(searchParams.get("mode") || "hoy");
    const selectedDay = selectedDateKey(mode, searchParams.get("date")); const comparisonDay = previousMonthEquivalentKey(selectedDay);
    const selectedMonth = selectedDay.slice(0, 7); const comparisonMonth = previousMonthKey(selectedMonth);
    const mtd = monthToDateComparison(selectedDay);
    const ranges = {
      currentDay: dayRangeFromKey(selectedDay),
      previousDay: dayRangeFromKey(comparisonDay),
      currentMonth: { start: new Date(mtd.currentStartIso), end: new Date(mtd.currentEndExclusiveIso) },
      previousMonth: { start: new Date(mtd.previousStartIso), end: new Date(mtd.previousEndExclusiveIso) },
    };
    const supabase = adminClient(); const brand = brandFromRequest(req);

    const [currentDayRaw, previousDayRaw, currentMonthRaw, previousMonthRaw] = await Promise.all([
      fetchPayments(supabase, ranges.currentDay.start, ranges.currentDay.end), fetchPayments(supabase, ranges.previousDay.start, ranges.previousDay.end),
      fetchPayments(supabase, ranges.currentMonth.start, ranges.currentMonth.end), fetchPayments(supabase, ranges.previousMonth.start, ranges.previousMonth.end),
    ]);
    const [currentDayPayments, previousDayPayments, currentMonthPayments, previousMonthPayments] = await Promise.all([
      filterRowsByBrand(supabase, currentDayRaw, brand), filterRowsByBrand(supabase, previousDayRaw, brand),
      filterRowsByBrand(supabase, currentMonthRaw, brand), filterRowsByBrand(supabase, previousMonthRaw, brand),
    ]);
    const [currentRows, previousRows, currentMonthRows, previousMonthRows] = await Promise.all([
      hydratePaymentRows(supabase, currentDayPayments), hydratePaymentRows(supabase, previousDayPayments),
      hydratePaymentRows(supabase, currentMonthPayments), hydratePaymentRows(supabase, previousMonthPayments),
    ]);

    const currentDaily = buildDailyResult(currentRows); const previousDaily = buildDailyResult(previousRows);
    const currentMonthly = buildMonthlySummary(currentMonthRows, selectedMonth); const previousMonthly = buildMonthlySummary(previousMonthRows, comparisonMonth);
    const response = NextResponse.json({
      ok: true,
      rows: currentDaily.rows.map(({ client_key: _key, ...row }) => row), totals: currentDaily.totals,
      byCentral: mergePrevious(currentDaily.byCentral, previousDaily.byCentral), dailyComparison: { date: comparisonDay, totals: previousDaily.totals },
      monthlySummary: { ...currentMonthly, previous_month: comparisonMonth, previous_total_importe_rendimiento: previousMonthly.total_importe_rendimiento, previous_total_registros_rendimiento: previousMonthly.total_registros_rendimiento, byTelefonista: mergePrevious(currentMonthly.byTelefonista, previousMonthly.byTelefonista), byTarotista: mergePrevious(currentMonthly.byTarotista, previousMonthly.byTarotista) },
      period: { mode, selected_date: selectedDay, comparison_date: comparisonDay, selected_month: selectedMonth, comparison_month: comparisonMonth, current_month_start: mtd.currentStartKey, current_month_end: mtd.currentEndKey, comparison_month_start: mtd.previousStartKey, comparison_month_end: mtd.previousEndKey, time_zone: MADRID_TIME_ZONE }, brand,
    });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate"); return response;
  } catch (error: any) {
    console.error("[Diario] Error cargando datos", error);
    const response = NextResponse.json({ ok: false, error: error?.message || "Error cargando diario" }, { status: 500 });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate"); return response;
  }
}
