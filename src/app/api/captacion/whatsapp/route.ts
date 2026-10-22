import { NextResponse } from "next/server";
import { CaptacionWhatsAppError, captacionWhatsAppAdmin, captacionWhatsAppWorker, captacionWhatsAppLead, captacionWhatsAppQrSession, currentCaptacionWhatsAppDelivery, syncCaptacionWhatsAppQrDelivery, publicCaptacionWhatsAppDelivery, captacionWhatsAppRecipient, captacionWhatsAppName, CAPTACION_WHATSAPP_BODY, CAPTACION_WHATSAPP_IMAGE, sendCaptacionWhatsApp } from "@/lib/server/captacion-whatsapp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function failure(error: unknown) {
  return error instanceof CaptacionWhatsAppError ? reply({ ok: false, error: error.code }, error.status) : reply({ ok: false, error: "UNAVAILABLE" }, 503);
}
export async function GET(req: Request) {
  try {
    const admin = captacionWhatsAppAdmin(), worker = await captacionWhatsAppWorker(req, admin);
    const url = new URL(req.url), leadId = url.searchParams.get("lead_id");
    const context = leadId ? await captacionWhatsAppLead(admin, worker, leadId, url.searchParams.get("brand") || "celestial") : null;
    const settings = await captacionWhatsAppQrSession(worker);
    let delivery = null, reason = settings.reason;
    if (context) {
      try { delivery = await syncCaptacionWhatsAppQrDelivery(admin, await currentCaptacionWhatsAppDelivery(admin, context)); }
      catch (error) { if (error instanceof CaptacionWhatsAppError && error.code === "DATABASE_NOT_READY") reason = "DATABASE_NOT_READY"; else throw error; }
      if (delivery) reason = ["sending", "unknown"].includes(delivery.status) ? "PENDING_CONFIRMATION" : ["failed", "undelivered"].includes(delivery.status) ? "DELIVERY_FAILED" : "ALREADY_SENT";
      else if (!captacionWhatsAppRecipient(context.client)) reason = "INVALID_PHONE";
      else if (context.lead.closed_at && (!context.submitted_at || Date.parse(context.lead.closed_at) >= Date.parse(context.submitted_at))) reason = "LEAD_CLOSED";
    }
    return reply({ ok: true, provider: "qr", configured: settings.configured, ready: settings.ready && !reason, reason, session: settings.session, delivery: publicCaptacionWhatsAppDelivery(delivery),
      preview_message: context ? CAPTACION_WHATSAPP_BODY.replace("{{1}}", () => captacionWhatsAppName(context.client)) : null,
      media_url: CAPTACION_WHATSAPP_IMAGE,
    });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const admin = captacionWhatsAppAdmin(), worker = await captacionWhatsAppWorker(req, admin);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["lead_id", "request_id"].includes(key)) || typeof body.lead_id !== "string" || typeof body.request_id !== "string") return reply({ ok: false, error: "INVALID_REQUEST" }, 400);
    const context = await captacionWhatsAppLead(admin, worker, body.lead_id, new URL(req.url).searchParams.get("brand") || "celestial");
    return reply(await sendCaptacionWhatsApp(admin, worker, context, body.request_id));
  } catch (error) { return failure(error); }
}
