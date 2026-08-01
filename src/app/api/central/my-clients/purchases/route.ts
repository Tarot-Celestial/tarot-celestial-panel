import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { calcClientRank, loadRolling30ClientTotals } from "@/lib/server/client-ranks";
import { loadEffectiveClientRank } from "@/lib/server/client-rank-effective";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function adminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function authenticatedWorker(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker || !["admin", "central"].includes(String(worker.role || ""))) return null;
  return worker;
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function normalizeMethod(value: unknown) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "Otros";
  if (raw.includes("PAYPAL")) return "PayPal";
  if (raw.includes("BIZUM")) return "Bizum";
  if (raw.includes("TPV") || raw.includes("TARJETA") || raw.includes("CARD")) return "TPV";
  if (raw.includes("WEB") || raw.includes("ONLINE")) return "Web";
  if (raw.includes("CANJE")) return "Canje";
  if (raw.includes("EFECTIVO")) return "Efectivo";
  if (raw.includes("TRANSFER")) return "Transferencia";
  return String(value || "Otros").trim() || "Otros";
}

function normalizedStatus(value: unknown) {
  return String(value || "unknown").trim().toLowerCase();
}

function isValidPaymentStatus(value: unknown) {
  // Mismo criterio que usa actualmente el CRM al acreditar una compra.
  return normalizedStatus(value) === "completed";
}

function getDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function madridMonthKey(value: unknown) {
  const date = getDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : "";
}

function currentMadridMonth(now = new Date()) {
  return madridMonthKey(now.toISOString());
}

function previousMonthKey(key: string) {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return "";
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function recentMonthKeys(lastKey: string, count: number) {
  const [year, month] = lastKey.split("-").map(Number);
  if (!year || !month) return [] as string[];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function readFirstNumber(row: any, keys: string[]) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      return toNumber(row[key]);
    }
  }
  return 0;
}

function extractStructuredMinutes(row: any) {
  const free = readFirstNumber(row, [
    "minutos_free",
    "free_minutes",
    "minutos_gratis",
    "bonus_minutes",
    "minutos_guardados_free",
  ]);
  const normal = readFirstNumber(row, [
    "minutos_normales",
    "normal_minutes",
    "paid_minutes",
    "minutos_pagados",
    "minutos_guardados_normales",
  ]);
  const explicitTotal = readFirstNumber(row, ["minutos_totales", "total_minutes", "minutes_total"]);
  return { free, normal, total: explicitTotal || free + normal };
}

function extractStructuredPackage(row: any) {
  return text(
    row?.paquete_nombre ??
      row?.package_name ??
      row?.paquete ??
      row?.package ??
      row?.producto_nombre ??
      row?.product_name
  );
}

type PurchaseRow = {
  id: string;
  source: "crm_cliente_pagos" | "rendimiento_llamadas";
  created_at: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  source_rendimiento_id?: string | null;
  notes: string | null;
  package: string | null;
  minutes_free: number;
  minutes_normal: number;
  minutes_total: number;
  registered_by: string | null;
  tarotist: string | null;
};

function duplicateOperationalPurchase(call: PurchaseRow, payments: PurchaseRow[]) {
  const callDate = getDate(call.created_at)?.getTime();
  if (!callDate || !(call.amount > 0)) return false;
  return payments.some((payment) => {
    const paymentDate = getDate(payment.created_at)?.getTime();
    if (!paymentDate) return false;
    const sameAmount = Math.abs(payment.amount - call.amount) < 0.005;
    const sameMethod = payment.method === call.method || payment.method === "Otros" || call.method === "Otros";
    const closeInTime = Math.abs(paymentDate - callDate) <= 15 * 60 * 1000;
    return sameAmount && sameMethod && closeInTime;
  });
}

export async function GET(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = new URL(req.url);
    const clientId = String(url.searchParams.get("client_id") || "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get("page_size") || 10)));
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const { data: client, error: clientError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, minutos_free_pendientes, minutos_normales_pendientes, origen")
      .eq("id", clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    const [paymentsResult, callsResult] = await Promise.all([
      // Es la misma fuente de verdad que usa /api/crm/pagos/listar.
      admin
        .from("crm_cliente_pagos")
        .select("*")
        .eq("cliente_id", clientId)
        .order("created_at", { ascending: false }),
      admin
        .from("rendimiento_llamadas")
        .select("id, cliente_id, fecha_hora, fecha, created_at, importe, forma_pago, cliente_compra_minutos, guarda_minutos, minutos_guardados_free, minutos_guardados_normales, resumen_codigo, telefonista_nombre, tarotista_nombre, tipo_registro")
        .eq("cliente_id", clientId)
        .eq("cliente_compra_minutos", true)
        .order("fecha_hora", { ascending: false }),
    ]);
    if (paymentsResult.error) throw paymentsResult.error;
    if (callsResult.error) throw callsResult.error;

    const rawPaymentRows: PurchaseRow[] = (paymentsResult.data || [])
      .map((row: any) => {
        const minutes = extractStructuredMinutes(row);
        return {
          id: String(row.id),
          source: "crm_cliente_pagos" as const,
          created_at: String(row.created_at || row.updated_at || ""),
          amount: toNumber(row.importe),
          currency: String(row.moneda || "EUR"),
          method: normalizeMethod(row.metodo),
          status: String(row.estado || "unknown"),
          reference: text(row.referencia_externa ?? row.paypal_capture_id ?? row.paypal_order_id),
          source_rendimiento_id: text(row.source_rendimiento_id),
          notes: text(row.notas),
          package: extractStructuredPackage(row),
          minutes_free: minutes.free,
          minutes_normal: minutes.normal,
          minutes_total: minutes.total,
          registered_by: text(row.created_by_name ?? row.created_by_email),
          tarotist: null,
        };
      })
      .filter((row: PurchaseRow) => Boolean(getDate(row.created_at)));

    const operationalRows: PurchaseRow[] = (callsResult.data || [])
      .map((row: any) => {
        const minutes = extractStructuredMinutes(row);
        return {
          id: String(row.id),
          source: "rendimiento_llamadas" as const,
          created_at: String(row.fecha_hora || row.created_at || row.fecha || ""),
          amount: toNumber(row.importe),
          currency: "EUR",
          method: normalizeMethod(row.forma_pago),
          status: toNumber(row.importe) > 0 ? "completed" : "adjustment",
          reference: null,
          notes: text(row.resumen_codigo),
          package: minutes.total > 0 ? `${minutes.normal} + ${minutes.free} minutos` : null,
          minutes_free: minutes.free,
          minutes_normal: minutes.normal,
          minutes_total: minutes.total,
          registered_by: text(row.telefonista_nombre),
          tarotist: text(row.tarotista_nombre),
        };
      })
      .filter((row: PurchaseRow) => Boolean(getDate(row.created_at)));

    const operationalById = new Map(operationalRows.map((row) => [row.id, row]));
    const paymentRows: PurchaseRow[] = rawPaymentRows.map((payment) => {
      const linkedId = payment.source_rendimiento_id || "";
      const linked = linkedId ? operationalById.get(linkedId) : null;
      if (!linked) return payment;
      return {
        ...payment,
        minutes_free: linked.minutes_free,
        minutes_normal: linked.minutes_normal,
        minutes_total: linked.minutes_total,
        package: linked.package || payment.package,
        registered_by: linked.registered_by || payment.registered_by,
        tarotist: linked.tarotist,
      };
    });

    const unlinkedOperationalRows = operationalRows.filter((row) => {
      if (paymentRows.some((payment) => payment.source_rendimiento_id === row.id)) return false;
      return !duplicateOperationalPurchase(row, paymentRows);
    });

    const allRows = [...paymentRows, ...unlinkedOperationalRows].sort(
      (a, b) => (getDate(b.created_at)?.getTime() || 0) - (getDate(a.created_at)?.getTime() || 0)
    );

    const validRows = allRows.filter((row) => {
      if (row.source === "crm_cliente_pagos") return isValidPaymentStatus(row.status);
      return row.status === "completed" && row.amount > 0;
    });

    const totalSpent = validRows.reduce((sum, row) => sum + row.amount, 0);
    const totalFree = validRows.reduce((sum, row) => sum + row.minutes_free, 0);
    const totalNormal = validRows.reduce((sum, row) => sum + row.minutes_normal, 0);

    const currentMonth = currentMadridMonth();
    const previousMonth = previousMonthKey(currentMonth);
    const monthlyMap = new Map<string, { amount: number; purchases: number; minutes: number }>();
    const methodMap = new Map<string, number>();
    const packageMap = new Map<string, number>();

    for (const row of validRows) {
      const key = madridMonthKey(row.created_at);
      if (key) {
        const month = monthlyMap.get(key) || { amount: 0, purchases: 0, minutes: 0 };
        month.amount += row.amount;
        month.purchases += 1;
        month.minutes += row.minutes_total;
        monthlyMap.set(key, month);
      }
      methodMap.set(row.method, (methodMap.get(row.method) || 0) + 1);
      if (row.package) packageMap.set(row.package, (packageMap.get(row.package) || 0) + 1);
    }

    const favoriteMethod = [...methodMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    const favoritePackage = [...packageMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    const currentStats = monthlyMap.get(currentMonth) || { amount: 0, purchases: 0, minutes: 0 };
    const previousStats = monthlyMap.get(previousMonth) || { amount: 0, purchases: 0, minutes: 0 };
    const difference = currentStats.amount - previousStats.amount;
    const percentage = previousStats.amount > 0 ? (difference / previousStats.amount) * 100 : null;

    const monthly = recentMonthKeys(currentMonth, 12).map((month) => {
      const value = monthlyMap.get(month) || { amount: 0, purchases: 0, minutes: 0 };
      return { month, ...value, amount: Number(value.amount.toFixed(2)) };
    });

    const now = new Date();
    const sinceIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rankTotals = await loadRolling30ClientTotals(admin, [client], sinceIso, now.toISOString());
    const rankInfo = rankTotals.get(clientId) || { total: 0, compras: 0 };
    const effectiveRank = await loadEffectiveClientRank(admin, clientId, rankInfo.total);
    const rank = effectiveRank.effective;

    const total = allRows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const rows = allRows.slice(start, start + pageSize);

    return NextResponse.json(
      {
        ok: true,
        client,
        rows,
        pagination: { page: safePage, page_size: pageSize, total, total_pages: totalPages },
        stats: {
          total_spent: Number(totalSpent.toFixed(2)),
          total_purchases: validRows.length,
          average_purchase: validRows.length ? Number((totalSpent / validRows.length).toFixed(2)) : 0,
          minutes_free: totalFree,
          minutes_normal: totalNormal,
          minutes_total: totalFree + totalNormal,
          last_purchase: validRows[0] || null,
          current_month: { ...currentStats, amount: Number(currentStats.amount.toFixed(2)) },
          previous_month: { ...previousStats, amount: Number(previousStats.amount.toFixed(2)) },
          difference: Number(difference.toFixed(2)),
          percentage: percentage === null ? null : Number(percentage.toFixed(1)),
          favorite_method: favoriteMethod ? { method: favoriteMethod[0], count: favoriteMethod[1] } : null,
          favorite_package: favoritePackage ? { package: favoritePackage[0], count: favoritePackage[1] } : null,
          monthly,
          methods: [...methodMap.entries()].map(([method, count]) => ({ method, count })),
        },
        rank: {
          current: rank,
          automatic: effectiveRank.automatic,
          effective: effectiveRank.effective,
          override: effectiveRank.override,
          spent_30d: Number(toNumber(rankInfo.total).toFixed(2)),
          purchases_30d: toNumber(rankInfo.compras),
          from: sinceIso.slice(0, 10),
          to: now.toISOString().slice(0, 10),
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_PURCHASES" }, { status: 500 });
  }
}
