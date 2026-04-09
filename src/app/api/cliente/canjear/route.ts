import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

function toNum(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);

    if (!gate.uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!gate.cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const recompensaId = String(body?.recompensa_id || "").trim();

    if (!recompensaId) {
      return NextResponse.json({ ok: false, error: "RECOMPENSA_REQUIRED" }, { status: 400 });
    }

    // 🔍 Obtener recompensa
    const { data: recompensa, error: recompensaError } = await gate.admin
      .from("recompensas")
      .select("id, nombre, puntos_coste, minutos_otorgados, activo")
      .eq("id", recompensaId)
      .eq("activo", true)
      .maybeSingle();

    if (recompensaError) throw recompensaError;

    if (!recompensa) {
      return NextResponse.json({ ok: false, error: "RECOMPENSA_NO_ENCONTRADA" }, { status: 404 });
    }

    const puntosActuales = toNum(gate.cliente.puntos);
    const coste = toNum(recompensa.puntos_coste);
    const minutosOtorgados = toNum(recompensa.minutos_otorgados);

    if (puntosActuales < coste) {
      return NextResponse.json({ ok: false, error: "PUNTOS_INSUFICIENTES" }, { status: 400 });
    }

    // 🔒 Cálculo seguro
    const nextPuntos = puntosActuales - coste;
    const nextFree = toNum(gate.cliente.minutos_free_pendientes) + minutosOtorgados;

    // 🧠 IMPORTANTE: update con condición para evitar race conditions
    const { data: updated, error: updateError } = await gate.admin
      .from("crm_clientes")
      .update({
        puntos: nextPuntos,
        minutos_free_pendientes: nextFree,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gate.cliente.id)
      .eq("puntos", puntosActuales) // 👈 evita doble canje simultáneo
      .select("*")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "CONFLICTO_CANJE_INTENTAR_DE_NUEVO" },
        { status: 409 }
      );
    }

    // 📝 Historial
    await gate.admin.from("cliente_puntos_historial").insert({
      cliente_id: gate.cliente.id,
      tipo: "canjeado",
      puntos: coste,
      descripcion: `Canjeado ${recompensa.nombre} por ${minutosOtorgados} minutos free.`,
    });

    return NextResponse.json({
      ok: true,
      cliente: updated,
      recompensa,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_CLIENTE_CANJEAR" },
      { status: 500 }
    );
  }
}
