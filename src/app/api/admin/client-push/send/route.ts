import { NextResponse } from "next/server";
import { workerFromRequest, getAdminClient } from "@/lib/server/auth-worker";
import { sendPushToSubscriptions } from "@/lib/server/web-push";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const verified = await getAdminClient().auth.getUser(token);
    if (verified.error || !verified.data.user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const worker = await workerFromRequest(req);
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body?.cliente_id || "").trim();
    if (!clienteId) return NextResponse.json({ ok: false, error: "Para envíos a varios clientes, utiliza Admin > Campañas." }, { status: 400 });
    const title = String(body?.title || "").trim();
    const message = String(body?.body || body?.mensaje || "").trim();
    const url = String(body?.url || "/cliente/dashboard").trim() || "/cliente/dashboard";
    const saveInternal = body?.save_internal !== false;

    if (!title || !message) {
      return NextResponse.json({ ok: false, error: "TITLE_AND_BODY_REQUIRED" }, { status: 400 });
    }

    const admin = getAdminClient();
    let query = admin
      .from("cliente_push_subscriptions")
      .select("id, cliente_id, endpoint, p256dh, auth, user_agent");

    if (clienteId) query = query.eq("cliente_id", clienteId);

    const { data: subscriptions, error } = await query;
    if (error) throw error;

    const result = await sendPushToSubscriptions(subscriptions || [], {
      title,
      body: message,
      url,
      tag: clienteId ? `client-${clienteId}` : "bulk-admin",
    });

    if (saveInternal) {
      const rows = clienteId
        ? [{ cliente_id: clienteId, titulo: title, mensaje: message, tipo: "push_manual", leida: false }]
        : Array.from(new Set((subscriptions || []).map((item: any) => item.cliente_id))).map((id) => ({
            cliente_id: id,
            titulo: title,
            mensaje: message,
            tipo: "push_manual",
            leida: false,
          }));

      if (rows.length) {
        await admin.from("cliente_notificaciones").insert(rows);
      }
    }

    return NextResponse.json({ ok: true, total: (subscriptions || []).length, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_PUSH_SEND" }, { status: 500 });
  }
}
