import { NextResponse } from "next/server";
import { workerFromRequest } from "@/lib/server/auth-worker";
import { whatsappGatewayFetch, whatsappSessionId } from "@/lib/server/whatsapp-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rutas (todas con ?action=...):
//   GET  status | chats | messages&jid=...&limit=...
//   POST start | logout | read&jid=... | send   (body: { jid | phone, text })

const JID_RE = /^[0-9A-Za-z.:_-]{3,80}@(s\.whatsapp\.net|lid|g\.us)$/;

async function authorize(req: Request) {
  const me = await workerFromRequest(req);
  if (!me) return { error: NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 }) };
  if (!["central", "admin"].includes(String(me.role || ""))) {
    return { error: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { me };
}

function reply(result: { status: number; json: any }) {
  return NextResponse.json(result.json, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    const auth = await authorize(req);
    if (auth.error) return auth.error;
    const base = `/sessions/${whatsappSessionId(auth.me)}`;
    const params = new URL(req.url).searchParams;
    const action = params.get("action");

    if (action === "status") return reply(await whatsappGatewayFetch(`${base}/status`));
    if (action === "chats") return reply(await whatsappGatewayFetch(`${base}/chats`));
    if (action === "messages") {
      const jid = String(params.get("jid") || "");
      if (!JID_RE.test(jid)) return fail("INVALID_JID");
      const limit = Math.min(300, Math.max(1, Number(params.get("limit") || 120)));
      return reply(await whatsappGatewayFetch(`${base}/chats/${encodeURIComponent(jid)}/messages?limit=${limit}`));
    }
    return fail("NOT_FOUND", 404);
  } catch (error: any) {
    return fail(error?.message || "INTERNAL_ERROR", 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authorize(req);
    if (auth.error) return auth.error;
    const base = `/sessions/${whatsappSessionId(auth.me)}`;
    const params = new URL(req.url).searchParams;
    const action = params.get("action");

    if (action === "start") return reply(await whatsappGatewayFetch(`${base}/start`, { method: "POST" }));

    if (action === "logout") {
      const body = await req.json().catch(() => ({}));
      return reply(await whatsappGatewayFetch(`${base}/logout`, { method: "POST", body: { restart: body?.restart !== false } }));
    }

    if (action === "read") {
      const jid = String(params.get("jid") || "");
      if (!JID_RE.test(jid)) return fail("INVALID_JID");
      return reply(await whatsappGatewayFetch(`${base}/chats/${encodeURIComponent(jid)}/read`, { method: "POST" }));
    }

    if (action === "send") {
      const body = await req.json().catch(() => null);
      const text = String(body?.text || "").trim();
      const targetJid = body?.jid ? String(body.jid) : "";
      const phone = body?.phone ? String(body.phone) : "";
      if (!text) return fail("EMPTY_TEXT");
      if (targetJid && !JID_RE.test(targetJid)) return fail("INVALID_JID");
      if (!targetJid && !phone) return fail("MISSING_TARGET");
      return reply(
        await whatsappGatewayFetch(`${base}/send`, {
          method: "POST",
          body: targetJid ? { jid: targetJid, text } : { phone, text },
        })
      );
    }

    return fail("NOT_FOUND", 404);
  } catch (error: any) {
    return fail(error?.message || "INTERNAL_ERROR", 500);
  }
}
