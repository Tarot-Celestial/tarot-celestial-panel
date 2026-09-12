import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

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
    const operationId = String(body?.operation_id || randomUUID()).trim();

    if (!recompensaId) {
      return NextResponse.json({ ok: false, error: "RECOMPENSA_REQUIRED" }, { status: 400 });
    }

    const { data: result, error: redeemError } = await gate.admin.rpc("cliente_canjear_coins_minutos_v1", {
      p_cliente_id: gate.cliente.id,
      p_recompensa_id: recompensaId,
      p_operation_id: operationId,
    });
    if (redeemError) throw redeemError;

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e: any) {
    const message = String(e?.message || "ERR_CLIENTE_CANJEAR");
    const clientError = [
      "CANJE_DATOS_INVALIDOS",
      "RECOMPENSA_NO_ENCONTRADA",
      "RECOMPENSA_SIN_COSTE_VALIDO",
      "RECOMPENSA_SIN_MINUTOS_VALIDOS",
      "PUNTOS_INSUFICIENTES",
    ].find((code) => message.includes(code));
    return NextResponse.json(
      { ok: false, error: clientError || message },
      { status: clientError ? (clientError === "RECOMPENSA_NO_ENCONTRADA" ? 404 : 400) : 500 }
    );
  }
}
