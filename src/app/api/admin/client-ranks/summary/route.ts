import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function firstDayOfMonthUTC(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

async function buildSummaryFromMonthlyTable(admin: ReturnType<typeof adminClient>, period: string) {
  const { data, error } = await admin
    .from("cliente_rangos_mensuales")
    .select("cliente_id, rango, gasto_mes_anterior, compras_mes_anterior, recalculated_at")
    .eq("periodo_mes", period)
    .order("recalculated_at", { ascending: false });
  if (error) throw error;

  if (!(data || []).length) return null;

  const seen = new Set<string>();
  const counts = { bronce: 0, plata: 0, oro: 0 };
  let gasto = 0;
  let compras = 0;

  for (const row of data || []) {
    const clienteId = String(row?.cliente_id || "");
    if (!clienteId || seen.has(clienteId)) continue;
    seen.add(clienteId);
    const rank = String(row?.rango || "").toLowerCase();
    if (rank in counts) counts[rank as keyof typeof counts] += 1;
    gasto += Number(row?.gasto_mes_anterior || 0);
    compras += Number(row?.compras_mes_anterior || 0);
  }

  return {
    totalConRango: seen.size,
    bronce: counts.bronce,
    plata: counts.plata,
    oro: counts.oro,
    gastoMesAnterior: Number(gasto.toFixed(2)),
    comprasMesAnterior: compras,
  };
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();
    const period = firstDayOfMonthUTC(new Date()).toISOString().slice(0, 10);

    const monthlySummary = await buildSummaryFromMonthlyTable(admin, period);
    if (monthlySummary) {
      return NextResponse.json({ ok: true, period, source: "cliente_rangos_mensuales", summary: monthlySummary });
    }

    const { data: rows, error } = await admin
      .from("crm_clientes")
      .select("id, rango_actual, rango_gasto_mes_anterior, rango_compras_mes_anterior")
      .not("rango_actual", "is", null);
    if (error) throw error;

    const counts = { bronce: 0, plata: 0, oro: 0 };
    let gasto = 0;
    let compras = 0;

    for (const row of rows || []) {
      const rank = String(row?.rango_actual || "").toLowerCase();
      if (rank in counts) counts[rank as keyof typeof counts] += 1;
      gasto += Number(row?.rango_gasto_mes_anterior || 0);
      compras += Number(row?.rango_compras_mes_anterior || 0);
    }

    return NextResponse.json({
      ok: true,
      period,
      source: "crm_clientes",
      summary: {
        totalConRango: (rows || []).length,
        bronce: counts.bronce,
        plata: counts.plata,
        oro: counts.oro,
        gastoMesAnterior: Number(gasto.toFixed(2)),
        comprasMesAnterior: compras,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
