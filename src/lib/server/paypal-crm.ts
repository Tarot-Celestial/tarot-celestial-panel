import { createClient } from "@supabase/supabase-js";

export const PAYPAL_TABLE = "crm_paypal_orders";
export class PayPalError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export function paypalConfig() {
  const environment = process.env.PAYPAL_ENVIRONMENT;
  if (environment !== "sandbox" && environment !== "live") throw new PayPalError("Configura PAYPAL_ENVIRONMENT (sandbox o live).", 503);
  const client = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  const webhook = process.env.PAYPAL_WEBHOOK_ID;
  if (!client || !secret || !webhook) throw new PayPalError("Falta configurar PayPal: Client ID, secreto o Webhook ID.", 503);
  const base = new URL(process.env.PAYPAL_PUBLIC_BASE_URL || "https://invalid.invalid");
  if (base.protocol !== "https:" || base.hostname === "invalid.invalid" || base.username || base.password) throw new PayPalError("Configura PAYPAL_PUBLIC_BASE_URL con el dominio HTTPS del panel.", 503);
  return { environment, client, secret, webhook, origin: base.origin,
    api: environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com" };
}
export function paypalAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function paypalRequest(path: string, body?: unknown, requestId?: string): Promise<any> {
  const config = paypalConfig();
  const auth = await fetch(`${config.api}/v1/oauth2/token`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Basic ${Buffer.from(`${config.client}:${config.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const token = await auth.json();
  if (!auth.ok || !token.access_token) throw new PayPalError("No se pudo autenticar con PayPal. Revisa las credenciales del entorno.");
  const response = await fetch(`${config.api}${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Never expose provider payloads, tokens or payer information to a browser.
    const issue = data.details?.[0]?.issue;
    throw new PayPalError(`PayPal no pudo completar la operación (${String(issue || data.name || response.status).replace(/[^A-Z0-9_]/g, "").slice(0, 80)}).`);
  }
  return data;
}
export function approvalUrl(order: any): string {
  const href = order.links?.find((l: any) => ["payer-action", "approve"].includes(l.rel))?.href;
  if (!href) throw new PayPalError("PayPal no devolvió el enlace de aprobación.");
  const url = new URL(href);
  const host = paypalConfig().environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com";
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password) throw new PayPalError("Enlace de PayPal no válido.");
  return url.href;
}
export function validateOrder(attempt: any, order: any) {
  const unit = order.purchase_units?.[0];
  if (order.id !== attempt.order_id || order.intent !== "CAPTURE" || order.purchase_units?.length !== 1 ||
      unit.custom_id !== attempt.id || unit.invoice_id !== `TC-${attempt.id}` ||
      unit.amount?.currency_code !== attempt.currency || Number(unit.amount?.value) !== Number(attempt.amount)) {
    throw new PayPalError("La referencia o el importe de PayPal no coincide. Revisión necesaria.");
  }
  return unit;
}
export async function reconcilePayPal(admin: any, attempt: any, captureApproved = true) {
  if (attempt.status === "completed" || !attempt.order_id) return attempt;
  if (attempt.environment !== paypalConfig().environment) throw new PayPalError("Este cobro pertenece a otro entorno de PayPal.", 409);
  let order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}`);
  validateOrder(attempt, order);
  if (order.status === "APPROVED" && captureApproved) {
    try { await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}/capture`, {}, `capture-${attempt.id}`); }
    catch (error) {
      // A concurrent callback or a timeout may already have captured this order.
      order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}`);
      if (order.status !== "COMPLETED") throw error;
    }
    order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}`);
  }
  const unit = validateOrder(attempt, order);
  const captures = unit.payments?.captures || [];
  const capture = captures[0];
  if (captures.length > 1) throw new PayPalError("PayPal tiene varias capturas. Revisión necesaria.");
  if (capture?.status === "COMPLETED") {
    if (order.status !== "COMPLETED" || !capture.id || capture.amount?.currency_code !== attempt.currency || Number(capture.amount?.value) !== Number(attempt.amount)) throw new PayPalError("La captura de PayPal no coincide con el cobro.");
    const { error } = await admin.rpc("tc_complete_paypal_crm", { p_id: attempt.id, p_order_id: order.id, p_capture_id: capture.id, p_amount: Number(capture.amount.value), p_currency: capture.amount.currency_code });
    if (error) {
      await admin.from(PAYPAL_TABLE).update({ remote_status: "CAPTURE_COMPLETED", last_error: "Pago recibido. Pendiente de registrar los beneficios; no solicites otro pago." }).eq("id", attempt.id).neq("status", "completed");
      throw new PayPalError("Pago recibido. La acreditación está pendiente; pulsa Comprobar sin crear otro cobro.", 503);
    }
  } else {
    const rejected = ["DECLINED", "FAILED", "DENIED"].includes(capture?.status) || order.status === "VOIDED";
    const { error } = await admin.from(PAYPAL_TABLE).update({ remote_status: capture ? `CAPTURE_${capture.status}` : order.status,
      ...(rejected ? { status: "cancelled" } : {}), last_error: null, checked_at: new Date().toISOString() })
      .eq("id", attempt.id).neq("status", "completed").neq("remote_status", "CAPTURE_COMPLETED");
    if (error) throw error;
  }
  const { data, error } = await admin.from(PAYPAL_TABLE).select("*").eq("id", attempt.id).single();
  if (error) throw error;
  return data;
}
export async function verifyPayPalWebhook(req: Request, event: any) {
  const fields = ["auth-algo", "cert-url", "transmission-id", "transmission-sig", "transmission-time"];
  if (fields.some(key => !req.headers.get(`paypal-${key}`))) return false;
  const result = await paypalRequest("/v1/notifications/verify-webhook-signature", {
    auth_algo: req.headers.get("paypal-auth-algo"), cert_url: req.headers.get("paypal-cert-url"),
    transmission_id: req.headers.get("paypal-transmission-id"), transmission_sig: req.headers.get("paypal-transmission-sig"),
    transmission_time: req.headers.get("paypal-transmission-time"), webhook_id: paypalConfig().webhook, webhook_event: event,
  });
  return result.verification_status === "SUCCESS";
}
