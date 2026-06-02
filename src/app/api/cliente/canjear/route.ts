import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

function toNum(value: unknown): number {
  const n = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function inferMinutesFromRewardName(name: unknown): number {
  const text = String(name || "").toLowerCase();
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(min|minuto|minutos|free)/i);
  if (!match?.[1]) return 0;
  return Math.max(0, Math.floor(toNum(match[1])));
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

    const { data: clienteActual, error: clienteError } = await gate.admin
      .from("crm_clientes")
      .select("id, puntos, minutos_free_pendientes, minutos_normales_pendientes")
      .eq("id", gate.cliente.id)
      .maybeSingle();

    if (clienteError) throw clienteError;
    if (!clienteActual?.id) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const puntosActuales = toNum(clienteActual.puntos);
    const coste = toNum(recompensa.puntos_coste);
    const minutosOtorgados = Math.max(
      0,
      Math.floor(toNum(recompensa.minutos_otorgados) || inferMinutesFromRewardName(recompensa.nombre))
    );

    if (coste <= 0) {
      return NextResponse.json({ ok: false, error: "RECOMPENSA_SIN_COSTE_VALIDO" }, { status: 400 });
    }

    if (minutosOtorgados <= 0) {
      return NextResponse.json({ ok: false, error: "RECOMPENSA_SIN_MINUTOS_VALIDOS" }, { status: 400 });
    }

    if (puntosActuales < coste) {
      return NextResponse.json({ ok: false, error: "PUNTOS_INSUFICIENTES" }, { status: 400 });
    }

    // Los canjes de puntos SIEMPRE se suman como minutos free.
    const nextPuntos = puntosActuales - coste;
    const nextFree = toNum(clienteActual.minutos_free_pendientes) + minutosOtorgados;
    const nowIso = new Date().toISOString();

    const { data: updated, error: updateError } = await gate.admin
      .from("crm_clientes")
      .update({
        puntos: nextPuntos,
        minutos_free_pendientes: nextFree,
        updated_at: nowIso,
      })
      .eq("id", clienteActual.id)
      .select("*")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "NO_SE_PUDO_ACTUALIZAR_CLIENTE" },
        { status: 409 }
      );
    }

    const descripcionCanje = `Canjeado ${recompensa.nombre} por ${minutosOtorgados} minutos free.`;

    await gate.admin.from("cliente_puntos_historial").insert({
      cliente_id: clienteActual.id,
      tipo: "canjeado",
      puntos: coste,
      descripcion: descripcionCanje,
      created_at: nowIso,
    });

    const { error: noteError } = await gate.admin.from("crm_client_notes").insert({
      cliente_id: clienteActual.id,
      texto: `🎁 Cliente canjea ${coste} puntos por ${minutosOtorgados} minutos free. Se suman como FREE. Total free pendiente: ${nextFree}`,
      author_user_id: null,
      author_name: "Sistema",
      author_email: null,
      is_pinned: false,
      created_at: nowIso,
    });

    if (noteError) throw noteError;

    return NextResponse.json({
      ok: true,
      cliente: updated,
      recompensa,
      minutos_free_sumados: minutosOtorgados,
      minutos_free_pendientes: nextFree,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_CLIENTE_CANJEAR" },
      { status: 500 }
    );
  }
}
