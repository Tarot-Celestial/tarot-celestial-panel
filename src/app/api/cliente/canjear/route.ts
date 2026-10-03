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

    // Leemos de nuevo la ficha tras el RPC. Así la respuesta HTTP siempre devuelve
    // el saldo persistido en base de datos, aunque el objeto inicial de autenticación
    // se hubiera cargado antes del canje.
    const { data: freshCliente, error: freshError } = await gate.admin
      .from("crm_clientes")
      .select("*")
      .eq("id", gate.cliente.id)
      .maybeSingle();
    if (freshError) throw freshError;
    if (!freshCliente) throw new Error("CLIENTE_NO_ENCONTRADO");

    const minutosTotales =
      Number(freshCliente.minutos_free_pendientes || 0) +
      Number(freshCliente.minutos_normales_pendientes || 0);

    return NextResponse.json(
      {
        ok: true,
        ...result,
        cliente: {
          ...freshCliente,
          minutos_totales: minutosTotales,
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
          Vary: "Authorization",
        },
      }
    );
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
