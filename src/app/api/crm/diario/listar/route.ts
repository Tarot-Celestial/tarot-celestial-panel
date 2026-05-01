import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function dayRange(mode: string, dateValue: string | null) {
  const now = new Date();
  if (mode === "ayer") now.setDate(now.getDate() - 1);
  if (mode === "fecha" && dateValue) {
    const [y, m, d] = dateValue.split("-").map(Number);
    now.setFullYear(y || now.getFullYear(), (m || 1) - 1, d || 1);
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function cleanName(v: any, fallback = "—") {
  const s = String(v || "").trim();
  return s || fallback;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = String(searchParams.get("mode") || "hoy");
    const dateValue = searchParams.get("date");
    const { start, end } = dayRange(mode, dateValue);
    const supabase = adminClient();

    const [{ data: rendimiento, error: rendError }, { data: pagos, error: pagosError }] = await Promise.all([
      supabase
        .from("rendimiento_llamadas")
        .select("id, cliente_id, cliente_nombre, telefonista_nombre, tarotista_nombre, tarotista_manual_call, fecha_hora, fecha, importe, forma_pago, resumen_codigo, cliente_compra_minutos")
        .gte("fecha_hora", start.toISOString())
        .lte("fecha_hora", end.toISOString())
        .or("cliente_compra_minutos.eq.true,importe.gt.0")
        .order("fecha_hora", { ascending: false }),
      supabase
        .from("crm_cliente_pagos")
        .select("id, cliente_id, importe, moneda, metodo, estado, created_at, created_by_user_id, created_by_role, referencia_externa")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false }),
    ]);

    if (rendError) throw rendError;
    if (pagosError) throw pagosError;

    const clienteIds = Array.from(new Set([...(rendimiento || []), ...(pagos || [])].map((x: any) => String(x?.cliente_id || "")).filter(Boolean)));
    const workerIds = Array.from(new Set((pagos || []).map((x: any) => String(x?.created_by_user_id || "")).filter(Boolean)));

    const [{ data: clientes }, { data: workers }] = await Promise.all([
      clienteIds.length
        ? supabase.from("crm_clientes").select("id, nombre, apellido, telefono, email").in("id", clienteIds)
        : Promise.resolve({ data: [] as any[] }),
      workerIds.length
        ? supabase.from("workers").select("id, display_name, role, email").in("id", workerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const clientMap = new Map<string, any>((clientes || []).map((c: any) => [String(c.id), c]));
    const workerMap = new Map<string, any>((workers || []).map((w: any) => [String(w.id), w]));

    const rows = [
      ...(rendimiento || []).map((row: any) => {
        const c = clientMap.get(String(row.cliente_id || ""));
        const nombre = cleanName(row.cliente_nombre, [c?.nombre, c?.apellido].filter(Boolean).join(" ").trim() || "Cliente");
        return {
          id: `rend-${row.id}`,
          source: "operador" as const,
          nombre,
          telefono: c?.telefono || null,
          fecha_pago: row.fecha_hora || row.fecha || null,
          importe: Number(row.importe || 0),
          metodo: row.forma_pago || row.resumen_codigo || "Rendimiento",
          central: cleanName(row.telefonista_nombre, "Central sin asignar"),
          tarotista: cleanName(row.tarotista_nombre || row.tarotista_manual_call, "—"),
          estado: "completed",
        };
      }),
      ...(pagos || []).map((row: any) => {
        const c = clientMap.get(String(row.cliente_id || ""));
        const w = workerMap.get(String(row.created_by_user_id || ""));
        const isWeb = !row.created_by_user_id || String(row.created_by_role || "").toLowerCase().includes("web") || String(row.metodo || "").toLowerCase().includes("paypal");
        return {
          id: `pago-${row.id}`,
          source: isWeb ? ("web" as const) : ("operador" as const),
          nombre: cleanName([c?.nombre, c?.apellido].filter(Boolean).join(" ").trim(), "Cliente"),
          telefono: c?.telefono || null,
          fecha_pago: row.created_at || null,
          importe: Number(row.importe || 0),
          metodo: row.metodo || row.referencia_externa || "Pago web",
          central: isWeb ? "Web automática" : cleanName(w?.display_name, "Central sin asignar"),
          tarotista: null,
          estado: row.estado || "completed",
        };
      }),
    ].sort((a, b) => new Date(b.fecha_pago || 0).getTime() - new Date(a.fecha_pago || 0).getTime());

    const completedRows = rows.filter((r: any) => String(r.estado || "completed") !== "cancelled");
    const uniqueClients = new Set(completedRows.map((r: any) => `${r.nombre}-${r.telefono || ""}`));
    const byCentralMap = new Map<string, { name: string; count: number; importe: number }>();
    for (const row of completedRows) {
      const name = cleanName(row.central, row.source === "web" ? "Web automática" : "Central sin asignar");
      const current = byCentralMap.get(name) || { name, count: 0, importe: 0 };
      current.count += 1;
      current.importe += Number(row.importe || 0);
      byCentralMap.set(name, current);
    }

    return NextResponse.json({
      ok: true,
      rows: completedRows,
      byCentral: Array.from(byCentralMap.values()).sort((a, b) => b.count - a.count),
      totals: {
        total_clientes: uniqueClients.size,
        total_pagos: completedRows.length,
        total_importe: completedRows.reduce((acc: number, row: any) => acc + Number(row.importe || 0), 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error cargando diario" }, { status: 500 });
  }
}
