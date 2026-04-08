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
    .select("id, role, display_name")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function firstDayOfMonthUTC(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addMonthsUTC(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function calcRank(total: number, purchases: number) {
  if (purchases <= 0 || total <= 0) return null;
  if (total >= 500) return "oro";
  if (total >= 100) return "plata";
  return "bronce";
}

async function runRecalc() {
  const admin = adminClient();
  const now = new Date();
  const currentMonthStart = firstDayOfMonthUTC(now);
  const prevMonthStart = addMonthsUTC(currentMonthStart, -1);
  const nextMonthStart = addMonthsUTC(currentMonthStart, 1);

  const { data: rows, error } = await admin
    .from("rendimiento_llamadas")
    .select("cliente_id, importe, fecha_hora, tipo_registro, forma_pago, cliente_compra_minutos")
    .gte("fecha_hora", prevMonthStart.toISOString())
    .lt("fecha_hora", currentMonthStart.toISOString())
    .not("cliente_id", "is", null);
  if (error) throw error;

  const byCliente = new Map<string, { total: number; purchases: number }>();
  for (const row of rows || []) {
    const clienteId = String(row?.cliente_id || "").trim();
    if (!clienteId) continue;
    const importe = Number(row?.importe || 0);
    if (!(importe > 0)) continue;
    const prev = byCliente.get(clienteId) || { total: 0, purchases: 0 };
    prev.total += importe;
    prev.purchases += 1;
    byCliente.set(clienteId, prev);
  }

  await admin
    .from("crm_clientes")
    .update({
      rango_actual: null,
      rango_gasto_mes_anterior: 0,
      rango_compras_mes_anterior: 0,
      rango_actual_desde: currentMonthStart.toISOString().slice(0, 10),
      rango_actual_hasta: addMonthsUTC(currentMonthStart, 1).toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  let bronce = 0;
  let plata = 0;
  let oro = 0;
  let updated = 0;

  for (const [clienteId, info] of Array.from(byCliente.entries())) {
    const rank = calcRank(info.total, info.purchases);
    if (!rank) continue;
    if (rank === "bronce") bronce += 1;
    if (rank === "plata") plata += 1;
    if (rank === "oro") oro += 1;

    const payload = {
      cliente_id: clienteId,
      periodo_mes: currentMonthStart.toISOString().slice(0, 10),
      calculado_desde_mes: prevMonthStart.toISOString().slice(0, 10),
      gasto_mes_anterior: Number(info.total.toFixed(2)),
      compras_mes_anterior: info.purchases,
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

    const { error: histErr } = await admin
      .from("cliente_rangos_mensuales")
      .upsert(payload, { onConflict: "cliente_id,periodo_mes" });
    if (histErr) throw histErr;

    const { error: updErr } = await admin
      .from("crm_clientes")
      .update({
        rango_actual: rank,
        rango_gasto_mes_anterior: Number(info.total.toFixed(2)),
        rango_compras_mes_anterior: info.purchases,
        rango_actual_desde: currentMonthStart.toISOString().slice(0, 10),
        rango_actual_hasta: nextMonthStart.toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", clienteId);
    if (updErr) throw updErr;
    updated += 1;
  }

  return {
    ok: true,
    periodo_actual: currentMonthStart.toISOString().slice(0, 10),
    calculado_desde: prevMonthStart.toISOString().slice(0, 10),
    clientes_actualizados: updated,
    rangos: { bronce, plata, oro },
  };
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!['admin','central'].includes(String(worker.role || ''))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    const result = await runRecalc();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
