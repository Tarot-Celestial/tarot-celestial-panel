import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

function toNum(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    if (!gate.cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const cliente = gate.cliente;
    const minutosTotales = toNum(cliente.minutos_free_pendientes) + toNum(cliente.minutos_normales_pendientes);

    const [{ data: historial }, { data: recompensas }] = await Promise.all([
      gate.admin
        .from("cliente_puntos_historial")
        .select("id, tipo, puntos, descripcion, created_at")
        .eq("cliente_id", cliente.id)
        .order("created_at", { ascending: false })
        .limit(10),
      gate.admin
        .from("recompensas")
        .select("id, nombre, puntos_coste, minutos_otorgados, activo")
        .eq("activo", true)
        .order("puntos_coste", { ascending: true }),
    ]);

    return NextResponse.json({
      ok: true,
      cliente: {
        ...cliente,
        minutos_totales: minutosTotales,
        puntos: toNum(cliente.puntos),
      },
      historial: historial || [],
      recompensas: recompensas || [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ME" }, { status: 500 });
  }
}
