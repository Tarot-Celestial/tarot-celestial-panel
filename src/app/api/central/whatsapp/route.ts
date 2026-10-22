import { NextResponse } from "next/server";
import { CaptacionWhatsAppError, captacionWhatsAppAdmin, captacionWhatsAppWorker } from "@/lib/server/captacion-whatsapp";
import { whatsappGatewayFetch, whatsappSessionId } from "@/lib/server/whatsapp-gateway";
import { parseWhatsAppAttention } from "@/lib/server/whatsapp-attention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rutas (todas con ?action=...):
//   GET  status | attention | chats | messages&jid=...&limit=...
//   POST start | logout | read&jid=... | send   (body: { jid | phone, text })

const JID_RE = /^[0-9A-Za-z.:_-]{1,80}@(s\.whatsapp\.net|lid|g\.us)$/;

async function authorize(req: Request) {
  try {
    // Validate the signature/session with Supabase; never authorize decoded JWT claims.
    const me = await captacionWhatsAppWorker(req, captacionWhatsAppAdmin());
    return { me };
  } catch (error) {
    const status = error instanceof CaptacionWhatsAppError ? error.status : 503;
    return { error: NextResponse.json({ ok: false, error: status === 401 ? "NO_AUTH" : status === 403 ? "FORBIDDEN" : "UNAVAILABLE" }, { status }) };
  }
}

function reply(result: { status: number; json: any }) {
  return NextResponse.json(result.json, { status: result.status, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization" } });
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

    if (action === "attention") {
      try {
        const result = await whatsappGatewayFetch(`${base}/attention`);
        if (result.status !== 200 || result.json?.ok !== true) {
          return reply({ status: result.status === 409 ? 409 : 503, json: { ok: false,
            error: result.json?.error === "NOT_CONNECTED" ? "NOT_CONNECTED" : "WHATSAPP_ATTENTION_UNAVAILABLE" } });
        }
        const summary = parseWhatsAppAttention(result.json, whatsappSessionId(auth.me));
        return reply({ status: 200, json: { ...summary, worker_id: String(auth.me.id), user_id: auth.me.user_id } });
      } catch { return reply({ status: 503, json: { ok: false, error: "WHATSAPP_ATTENTION_UNAVAILABLE" } }); }
    }
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
    return fail("INTERNAL_ERROR", 500);
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
    return fail("INTERNAL_ERROR", 500);
  }
}
