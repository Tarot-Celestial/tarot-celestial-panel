import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getClientPushSubscriptions, sendPushToSubscriptions } from "@/lib/server/web-push";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const subscriptions = await getClientPushSubscriptions(gate.cliente.id);
    if (!subscriptions.length) {
      return NextResponse.json({ ok: false, error: "NO_PUSH_SUBSCRIPTIONS" }, { status: 400 });
    }

    const result = await sendPushToSubscriptions(subscriptions, {
      title: "✨ Tarot Celestial",
      body: "Tus notificaciones push ya están activas en este dispositivo.",
      url: "/cliente/dashboard",
      tag: "push-test",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_PUSH_TEST" }, { status: 500 });
  }
}
