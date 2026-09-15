import { randomUUID } from "crypto";
import { buildInternationalPhone } from "@/lib/countries";

export function paymentWhatsappConfig() {
  const required = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "TWILIO_WHATSAPP_PAYMENT_CONTENT_SID", "MOLLIE_PUBLIC_BASE_URL"];
  const missing = required.filter(key => !process.env[key]?.trim());
  return { enabled: missing.length === 0, missing };
}

export async function sendPaymentLink(admin: any, attempt: any, cliente: any) {
  const config = paymentWhatsappConfig();
  if (!config.enabled) {
    const result = { status: "manual", missing: config.missing };
    const { error } = await admin.from("cliente_payment_attempts").update({ whatsapp: result }).eq("id", attempt.id).eq("whatsapp", JSON.stringify(attempt.whatsapp || {}));
    if (error) throw error;
    return result;
  }
  if (["sending", "accepted", "queued", "sent", "delivered", "read", "unknown"].includes(attempt.whatsapp?.status)) return attempt.whatsapp;
  if (attempt.status !== "pending" || !["open", "pending"].includes(attempt.provider_response?.status)) return { status: "unavailable" };
  const to = buildInternationalPhone(cliente.pais, cliente.telefono_normalizado || cliente.telefono || "");
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { status: "invalid_phone" };
  const deliveryToken = randomUUID();
  const claim = { status: "sending", delivery_token: deliveryToken, updated_at: new Date().toISOString() };
  const { data, error } = await admin.from("cliente_payment_attempts").update({ whatsapp: claim })
    .eq("id", attempt.id).eq("whatsapp", JSON.stringify(attempt.whatsapp || {})).select("id").maybeSingle();
  if (error) throw error;
  if (!data) return { status: "sending" };
  // Approved template: {{1}} customer, {{2}} amount and currency, {{3}} full checkout URL.
  const params = new URLSearchParams({
    From: process.env.TWILIO_WHATSAPP_FROM!, To: `whatsapp:${to}`,
    ContentSid: process.env.TWILIO_WHATSAPP_PAYMENT_CONTENT_SID!,
    ContentVariables: JSON.stringify({ "1": [cliente.nombre, cliente.apellido].filter(Boolean).join(" ") || "Clienta", "2": `${Number(attempt.amount).toFixed(2)} ${attempt.currency}`, "3": attempt.provider_response._links.checkout.href }),
    StatusCallback: `${process.env.MOLLIE_PUBLIC_BASE_URL!.replace(/\/$/, "")}/api/webhooks/payment-whatsapp?attempt_id=${attempt.id}&delivery_token=${deliveryToken}`,
  });
  let result: any;
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params, signal: AbortSignal.timeout(15000),
    });
    const json = await response.json();
    result = response.ok && json.sid ? { status: "accepted", sid: json.sid } : { status: response.status >= 500 ? "unknown" : "failed", code: json.code || response.status };
  } catch { result = { status: "unknown" }; }
  // Unknown must not be retried automatically: Twilio may have accepted the message.
  const { error: saveError } = await admin.from("cliente_payment_attempts")
    .update({ whatsapp: { ...result, delivery_token: deliveryToken, updated_at: new Date().toISOString() } }).eq("id", attempt.id).eq("whatsapp", JSON.stringify(claim));
  if (saveError) throw saveError;
  return result;
}
