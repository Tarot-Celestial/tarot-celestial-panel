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
    const id = String(body?.id || "").trim();

    if (id) {
      const { error } = await gate.admin
        .from("cliente_notificaciones")
        .update({ leida: true })
        .eq("id", id)
        .eq("cliente_id", gate.cliente.id);
      if (error) throw error;
    } else {
      const { error } = await gate.admin
        .from("cliente_notificaciones")
        .update({ leida: true })
        .eq("cliente_id", gate.cliente.id)
        .eq("leida", false);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_NOTIFS_READ" }, { status: 500 });
  }
}
