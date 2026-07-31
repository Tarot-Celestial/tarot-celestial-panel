import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { calcClientRank, loadRolling30ClientTotals } from "@/lib/server/client-ranks";

export const runtime = "nodejs";

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

function number(value: any) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedMethod(value: any) {
  const method = String(value || "OTROS").trim().toUpperCase();
  if (method.includes("PAYPAL")) return "PayPal";
  if (method.includes("BIZUM")) return "Bizum";
  if (method.includes("TPV") || method.includes("TARJETA")) return "TPV";
  if (method.includes("WEB")) return "Web";
  return method || "Otros";
}

function monthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function extractMinutes(row: any) {
  const free = number(row?.minutos_guardados_free ?? row?.minutos_free ?? 0);
  const normal = number(row?.minutos_guardados_normales ?? row?.minutos_normales ?? 0);
  const used = number(row?.minutos_1) + number(row?.minutos_2);
  return { free, normal, total: free + normal || used };
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
      admin
        .from("crm_cliente_pagos")
        .select("id, cliente_id, importe, moneda, metodo, estado, notas, referencia_externa, created_at")
        .eq("cliente_id", clientId)
        .order("created_at", { ascending: false }),
      admin
        .from("rendimiento_llamadas")
        .select("id, cliente_id, fecha_hora, fecha, created_at, importe, forma_pago, cliente_compra_minutos, guarda_minutos, minutos_guardados_free, minutos_guardados_normales, minutos_1, minutos_2, resumen_codigo, telefonista_nombre, tarotista_nombre, tipo_registro")
        .eq("cliente_id", clientId)
        .eq("cliente_compra_minutos", true)
        .order("fecha_hora", { ascending: false }),
    ]);
    if (paymentsResult.error) throw paymentsResult.error;
    if (callsResult.error) throw callsResult.error;

    const paymentRows = (paymentsResult.data || []).map((row: any) => ({
      id: row.id,
      source: "crm_cliente_pagos",
      created_at: row.created_at,
      amount: number(row.importe),
      currency: row.moneda || "EUR",
      method: normalizedMethod(row.metodo),
      status: String(row.estado || "unknown"),
      reference: row.referencia_externa || null,
      notes: row.notas || null,
      package: row.notas || null,
      minutes_free: 0,
      minutes_normal: 0,
      minutes_total: 0,
      registered_by: null,
      tarotist: null,
    }));

    const callRows = (callsResult.data || []).map((row: any) => {
      const minutes = extractMinutes(row);
      return {
        id: row.id,
        source: "rendimiento_llamadas",
        created_at: row.fecha_hora || row.created_at || row.fecha,
        amount: number(row.importe),
        currency: "EUR",
        method: normalizedMethod(row.forma_pago),
        status: "completed",
        reference: null,
        notes: row.resumen_codigo || null,
        package: row.resumen_codigo || null,
        minutes_free: minutes.free,
        minutes_normal: minutes.normal,
        minutes_total: minutes.total,
        registered_by: row.telefonista_nombre || null,
        tarotist: row.tarotista_nombre || null,
      };
    });

    const allRows = [...paymentRows, ...callRows]
      .filter((row) => row.created_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const validRows = allRows.filter((row) => ["completed", "completado", "paid", "pagado"].includes(String(row.status).toLowerCase()));
    const totalSpent = validRows.reduce((sum, row) => sum + row.amount, 0);
    const totalFree = validRows.reduce((sum, row) => sum + row.minutes_free, 0);
    const totalNormal = validRows.reduce((sum, row) => sum + row.minutes_normal, 0);

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const previousMonth = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;

    const monthlyMap = new Map<string, { amount: number; purchases: number; minutes: number }>();
    const methodMap = new Map<string, number>();
    const packageMap = new Map<string, number>();
    for (const row of validRows) {
      const key = monthKey(row.created_at);
      const month = monthlyMap.get(key) || { amount: 0, purchases: 0, minutes: 0 };
      month.amount += row.amount;
      month.purchases += 1;
      month.minutes += row.minutes_total;
      monthlyMap.set(key, month);
      methodMap.set(row.method, (methodMap.get(row.method) || 0) + 1);
      if (row.package) packageMap.set(row.package, (packageMap.get(row.package) || 0) + 1);
    }

    const favoriteMethod = [...methodMap.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const favoritePackage = [...packageMap.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const currentStats = monthlyMap.get(currentMonth) || { amount: 0, purchases: 0, minutes: 0 };
    const previousStats = monthlyMap.get(previousMonth) || { amount: 0, purchases: 0, minutes: 0 };
    const difference = currentStats.amount - previousStats.amount;
    const percentage = previousStats.amount > 0 ? (difference / previousStats.amount) * 100 : null;

    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rankTotals = await loadRolling30ClientTotals(admin, [client], sinceIso, new Date().toISOString());
    const rankInfo = rankTotals.get(clientId) || { total: 0, compras: 0 };
    const rank = calcClientRank(rankInfo.total);

    const total = allRows.length;
    const start = (page - 1) * pageSize;
    const rows = allRows.slice(start, start + pageSize);

    return NextResponse.json({
      ok: true,
      client,
      rows,
      pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
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
        monthly: [...monthlyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([month, value]) => ({ month, ...value, amount: Number(value.amount.toFixed(2)) })),
        methods: [...methodMap.entries()].map(([method, count]) => ({ method, count })),
      },
      rank: {
        current: rank,
        spent_30d: Number(number(rankInfo.total).toFixed(2)),
        purchases_30d: number(rankInfo.compras),
        from: sinceIso.slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
      },
      tarotists: [],
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_PURCHASES" }, { status: 500 });
  }
}
