import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const destino = String(body?.destino || "").trim();
    const mercado = String(body?.mercado || "").trim();

    const { error } = await gate.admin.from("cliente_call_clicks").insert({
      cliente_id: gate.cliente.id,
      destino: destino || null,
      mercado: mercado || null,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_CALL_CLICK" }, { status: 500 });
  }
}
