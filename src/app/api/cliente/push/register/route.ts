import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const endpoint = String(body?.endpoint || "").trim();
    const p256dh = String(body?.keys?.p256dh || "").trim();
    const auth = String(body?.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ ok: false, error: "INVALID_SUBSCRIPTION" }, { status: 400 });
    }

    await gate.admin.from("cliente_push_subscriptions").delete().eq("endpoint", endpoint);

    const { error } = await gate.admin.from("cliente_push_subscriptions").insert({
      cliente_id: gate.cliente.id,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent"),
      created_at: new Date().toISOString(),
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_PUSH_REGISTER" }, { status: 500 });
  }
}
