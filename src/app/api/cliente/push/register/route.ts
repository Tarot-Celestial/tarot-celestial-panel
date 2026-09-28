import { NextResponse } from "next/server";
import { campaignIdentity, campaignResponseError } from "@/lib/server/campaign-auth";
import { isTrustedPushEndpoint } from "@/lib/campaigns";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { db: admin, clientId } = await campaignIdentity(req, "client");

    const body = await req.json().catch(() => null);
    const endpoint = String(body?.endpoint || "").trim();
    const p256dh = String(body?.keys?.p256dh || "").trim();
    const auth = String(body?.keys?.auth || "").trim();

    if (!isTrustedPushEndpoint(endpoint) || endpoint.length > 2048 || !/^[A-Za-z0-9_=-]{40,150}$/.test(p256dh) || !/^[A-Za-z0-9_=-]{16,100}$/.test(auth)) {
      return NextResponse.json({ ok: false, error: "INVALID_SUBSCRIPTION" }, { status: 400 });
    }

    const removed = await admin.from("cliente_push_subscriptions").delete().eq("endpoint", endpoint);
    if (removed.error) throw removed.error;

    const { error } = await admin.from("cliente_push_subscriptions").insert({
      cliente_id: clientId,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent"),
      created_at: new Date().toISOString(),
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return campaignResponseError(e);
  }
}
