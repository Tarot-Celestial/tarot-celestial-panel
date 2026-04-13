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
async function notifyRankChange(admin: any, params: {
  clienteId: string;
  clientName: string;
  rank: string;
  previousRank?: string | null;
}) {
  const { clienteId, clientName, rank, previousRank } = params;

  const order: any = {
    bronce: 1,
    plata: 2,
    oro: 3,
  };

  // ❌ si no hay previo → no notificar (primer cálculo)
  if (!previousRank) return;

  // ❌ si no sube → no notificar
  if (order[rank] <= order[previousRank]) return;

  await admin.from("notifications").insert({
    type: "rank_upgrade",
    title: "Cliente sube de rango",
    message: `🔥 ${clientName} ha subido a ${rank.toUpperCase()}`,
    cliente_id: clienteId,
    rango: rank,
    read: false,
    created_at: new Date().toISOString(),
  });
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
    .select("id, role, display_name")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function firstDayOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function calcRank(total: number) {
  if (total >= 500) return "oro";
  if (total >= 100) return "plata";
  if (total > 0) return "bronce";
  return null;
}

function normalizeName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function runRecalc() {
  const admin = adminClient();
  const now = new Date();
  // 🔥 mes anterior
const prevMonth = addMonths(now, -1);
const currentMonthStart = firstDayOfMonth(prevMonth);
const nextMonthStart = firstDayOfMonth(now);

  const { data: rows, error } = await admin
    .from("rendimiento_llamadas")
    .select("cliente_id, cliente_nombre, importe, fecha_hora");
  if (error) throw error;

  const { data: clientes, error: cliErr } = await admin
    .from("crm_clientes")
    .select("id, nombre, apellido, rango_actual");
  if (cliErr) throw cliErr;

  const prevRanks = new Map<string, string | null>();
  for (const c of clientes || []) {
    prevRanks.set(String(c.id), c?.rango_actual ? String(c.rango_actual) : null);
  }

  const clienteByNormalized = new Map<string, string>();
  for (const c of clientes || []) {
    const full = [c?.nombre, c?.apellido].filter(Boolean).join(" ").trim();
    const key1 = normalizeName(full);
    const key2 = normalizeName(c?.nombre);
    if (key1) clienteByNormalized.set(key1, String(c.id));
    if (key2 && !clienteByNormalized.has(key2)) clienteByNormalized.set(key2, String(c.id));
  }

  const gastos = new Map<string, { total: number; compras: number }>();

  for (const row of rows || []) {
    const fecha = new Date(row.fecha_hora);
    if (!(fecha >= currentMonthStart && fecha < nextMonthStart)) continue;

    const importe = Number(row.importe || 0);
    if (!(importe > 0)) continue;

    let clienteId = String(row.cliente_id || "").trim();
    if (!clienteId) {
      clienteId = clienteByNormalized.get(normalizeName(row.cliente_nombre)) || "";
    }
    if (!clienteId) continue;

    const prev = gastos.get(clienteId) || { total: 0, compras: 0 };
    prev.total += importe;
    prev.compras += 1;
    gastos.set(clienteId, prev);
  }

  await admin
    .from("crm_clientes")
    .update({
      rango_actual: null,
      rango_gasto_mes_anterior: 0,
      rango_compras_mes_anterior: 0,
      rango_actual_desde: currentMonthStart.toISOString().slice(0, 10),
      rango_actual_hasta: nextMonthStart.toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  let bronce = 0;
  let plata = 0;
  let oro = 0;
  let updated = 0;
  let gastoMesAnterior = 0;
  let comprasMesAnterior = 0;

  for (const [clienteId, info] of Array.from(gastos.entries())) {
    const rank = calcRank(info.total);
    if (!rank) continue;
    if (rank === "bronce") bronce += 1;
    if (rank === "plata") plata += 1;
    if (rank === "oro") oro += 1;
    gastoMesAnterior += info.total;
    comprasMesAnterior += info.compras;
    
const payload = {
  cliente_id: clienteId,
  periodo_mes: periodoActual.toISOString().slice(0, 10), // abril
  calculado_desde_mes: currentMonthStart.toISOString().slice(0, 10), // marzo
  gasto_mes_anterior: Number(info.total.toFixed(2)),
  compras_mes_anterior: info.compras,
  rango: rank,
  beneficios: rank === "oro"
    ? {
        nuevos_minutos_tarotista: 12,
        minutos_extra_regulares: 12,
        pases_gratis_mes: 3,
        minutos_por_pase: 7,
        seguimiento_post_ritual: true,
        sorteos_activos: 1,
      }
    : rank === "plata"
    ? {
        nuevos_minutos_tarotista: 10,
        minutos_extra_regulares: 10,
        pases_gratis_mes: 3,
        minutos_por_pase: 7,
        seguimiento_post_ritual: true,
        sorteos_activos: 0,
      }
    : {
        nuevos_minutos_tarotista: 0,
        minutos_extra_regulares: 0,
        pases_gratis_mes: 3,
        minutos_por_pase: 7,
        seguimiento_post_ritual: false,
        sorteos_activos: 0,
      },
  recalculated_at: new Date().toISOString(),
};

    await admin
      .from("cliente_rangos_mensuales")
      .upsert(payload, { onConflict: "cliente_id,periodo_mes" });

    const { error: updErr } = await admin
      .from("crm_clientes")
      .update({
        rango_actual: rank,
        rango_gasto_mes_anterior: Number(info.total.toFixed(2)),
        rango_compras_mes_anterior: info.compras,
        rango_actual_desde: currentMonthStart.toISOString().slice(0, 10),
        rango_actual_hasta: nextMonthStart.toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", clienteId);
    if (updErr) throw updErr;

    const previousRank = prevRanks.get(clienteId) || null;
    if (previousRank !== rank) {
      const clientRow = (clientes || []).find((x: any) => String(x.id) === clienteId);
      const clientName = [clientRow?.nombre, clientRow?.apellido].filter(Boolean).join(" ").trim() || `Cliente ${clienteId}`;
      await notifyRankChange(admin, { clienteId, clientName, rank, previousRank });
      prevRanks.set(clienteId, rank);
    }

    updated += 1;
  }

  return {
    ok: true,
    periodo_actual: currentMonthStart.toISOString().slice(0, 10),
    calculado_desde: currentMonthStart.toISOString().slice(0, 10),
    clientes_actualizados: updated,
    gastoMesAnterior: Number(gastoMesAnterior.toFixed(2)),
    comprasMesAnterior,
    rangos: { bronce, plata, oro },
  };
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    const result = await runRecalc();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
