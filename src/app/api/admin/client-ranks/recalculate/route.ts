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

async function runRecalc() {
  const admin = adminClient();

  const now = new Date();
  const currentMonthStart = firstDayOfMonth(now);
  const prevMonthStart = addMonths(currentMonthStart, -1);
  const nextMonthStart = addMonths(currentMonthStart, 1);

  // 🔥 TRAEMOS TODAS LAS LLAMADAS
  const { data: rows, error } = await admin
    .from("rendimiento_llamadas")
    .select("cliente_nombre, importe, fecha_hora");

  if (error) throw error;

  const gastos: Record<string, number> = {};

  // 🔥 FILTRAMOS MES ANTERIOR EN JS (más fiable)
  for (const row of rows || []) {
    const fecha = new Date(row.fecha_hora);

    if (fecha >= prevMonthStart && fecha < currentMonthStart) {
      const nombre = (row.cliente_nombre || "").toLowerCase().trim();
      if (!nombre) continue;

      gastos[nombre] = (gastos[nombre] || 0) + Number(row.importe || 0);
    }
  }

  let updated = 0;
  let bronce = 0;
  let plata = 0;
  let oro = 0;

  // 🔥 ASIGNAMOS RANGOS
  for (const nombre in gastos) {
    const total = gastos[nombre];
    const rank = calcRank(total);
    if (!rank) continue;

    if (rank === "bronce") bronce++;
    if (rank === "plata") plata++;
    if (rank === "oro") oro++;

    // 🔥 BUSCAMOS CLIENTE POR NOMBRE
    const { data: cliente } = await admin
      .from("crm_clientes")
      .select("id, nombre")
      .ilike("nombre", `%${nombre}%`)
      .maybeSingle();

    if (!cliente) continue;

    // 🔥 ACTUALIZAMOS CLIENTE
    await admin
      .from("crm_clientes")
      .update({
        rango_actual: rank,
        rango_gasto_mes_anterior: Number(total.toFixed(2)),
        rango_actual_desde: currentMonthStart.toISOString().slice(0, 10),
        rango_actual_hasta: nextMonthStart.toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", cliente.id);

    updated++;
  }

  return {
    ok: true,
    clientes_actualizados: updated,
    rangos: { bronce, plata, oro },
  };
}

export async function POST(req: Request) {
  try {
    const result = await runRecalc();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
