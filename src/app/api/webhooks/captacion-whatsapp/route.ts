import { validateRequest } from "twilio";
import { CAPTACION_WHATSAPP_ORIGIN, CAPTACION_WHATSAPP_CALLBACK_PATH, captacionWhatsAppAdmin } from "@/lib/server/captacion-whatsapp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set(["accepted", "queued", "sending", "sent", "delivered", "read", "failed", "undelivered"]);
export async function POST(req: Request) {
  const secret = process.env.TWILIO_AUTH_TOKEN, account = process.env.TWILIO_ACCOUNT_SID;
  if (!secret || !account) return new Response("Unavailable", { status: 503 });
  try {
    const url = new URL(req.url);
    if (url.pathname !== CAPTACION_WHATSAPP_CALLBACK_PATH || !UUID.test(url.searchParams.get("delivery_id") || "") || !UUID.test(url.searchParams.get("token") || "")) return new Response("Invalid request", { status: 400 });
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string" || key in params) return new Response("Invalid request", { status: 400 });
      params[key] = value;
    }
    // Validate the exact externally registered URL, including the original query
    // ordering. Never trust Host/X-Forwarded-Host to construct the signed URL.
    if (!validateRequest(secret, req.headers.get("x-twilio-signature") || "", `${CAPTACION_WHATSAPP_ORIGIN}${url.pathname}${url.search}`, params)) return new Response("Unauthorized", { status: 403 });
    if (params.AccountSid !== account || !/^SM[0-9a-f]{32}$/i.test(params.MessageSid || "")) return new Response("Conflict", { status: 409 });
    if (!statuses.has(params.MessageStatus)) return new Response("OK");
    const admin = captacionWhatsAppAdmin();
    const { data: delivery, error } = await admin.from("captacion_whatsapp_deliveries").select("id,callback_token,message_sid,from_number,to_number").eq("id", url.searchParams.get("delivery_id")).maybeSingle();
    if (error) return new Response("Retry", { status: 503 });
    if (!delivery || delivery.callback_token !== url.searchParams.get("token") || (delivery.message_sid && delivery.message_sid !== params.MessageSid)
      || (params.From && params.From !== delivery.from_number) || (params.To && params.To !== delivery.to_number)) return new Response("Conflict", { status: 409 });
    const recorded = await admin.rpc("tc_captacion_whatsapp_record", { p_delivery_id: delivery.id, p_callback_token: delivery.callback_token, p_message_sid: params.MessageSid,
      p_status: params.MessageStatus === "sending" ? "accepted" : params.MessageStatus, p_error_code: params.ErrorCode || null, p_source: "provider_callback" });
    return new Response(recorded.error ? "Retry" : "OK", { status: recorded.error ? 503 : 200 });
  } catch { return new Response("Retry", { status: 503 }); }
}
