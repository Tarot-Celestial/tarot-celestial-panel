import { createClient } from "@supabase/supabase-js";

export const PAYPAL_TABLE = "crm_paypal_orders";
export class PayPalError extends Error {
  constructor(message: string, public status = 502, public paymentReason?: string) { super(message); }
}
// Translate only documented codes, never arbitrary provider descriptions or card data.
export function paymentFailureReason(value: any): string | undefined {
  const codes: Record<string, string> = {
    "5120": "Saldo insuficiente. Prueba otra tarjeta o consulta con tu banco.",
    "5110": "El código de seguridad (CVV) no coincide. Revisa los datos de la tarjeta.",
    "5400": "La tarjeta está caducada. Utiliza una tarjeta vigente.",
    "5100": "El emisor ha rechazado la tarjeta sin indicar un motivo específico. Consulta con tu banco.",
    INSTRUMENT_DECLINED: "El medio de pago ha sido rechazado. PayPal no ha facilitado el motivo concreto.",
    CARD_EXPIRED: "La tarjeta está caducada. Utiliza una tarjeta vigente.",
    CARD_NUMBER_INVALID: "El número de tarjeta no es válido. Revisa los datos.",
    TRANSACTION_REFUSED: "La operación ha sido rechazada. PayPal no ha facilitado un motivo más concreto.",
    PAYER_CANNOT_PAY: "PayPal no permite completar este pago con el medio seleccionado.",
  };
  const code = value?.processor_response?.response_code;
  if (typeof code === "string" && /^[A-Z0-9]{4}$/.test(code) && code !== "0000")
    return `${codes[code] || "Pago rechazado. PayPal no ha facilitado una explicación específica para este código."} (PayPal: ${code})`;
  const issue = value?.details?.find((d: any) => codes[d?.issue])?.issue;
  return issue ? `${codes[issue]} (PayPal: ${issue})` : undefined;
}
function configuredValue(name: string) {
  let value = (process.env[name] || "").trim();
  // Pasted .env values can accidentally include enclosing quotes.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return value;
}
function paypalAuthConfig() {
  const environment = configuredValue("PAYPAL_ENVIRONMENT");
  if (environment !== "sandbox" && environment !== "live") throw new PayPalError("Configura PAYPAL_ENVIRONMENT (sandbox o live).", 503);
  const client = configuredValue("PAYPAL_CLIENT_ID"), secret = configuredValue("PAYPAL_CLIENT_SECRET");
  for (const [name, value] of [["PAYPAL_CLIENT_ID", client], ["PAYPAL_CLIENT_SECRET", secret]]) {
    if (!value) throw new PayPalError(`Falta ${name} en este despliegue. Guarda la variable y redespliega.`, 503);
    if (/\s|[\u200B-\u200F\uFEFF]|\\[rn]/u.test(value)) throw new PayPalError(`${name} contiene espacios o saltos dentro del valor. Copia de nuevo el dato completo con el botón de PayPal.`, 503);
    if (/[•*…]/u.test(value) || value.includes("...")) throw new PayPalError(`${name} parece un valor oculto o recortado. Usa el botón de copiar de PayPal.`, 503);
  }
  if (client === secret) throw new PayPalError("PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET contienen el mismo valor. Son dos datos distintos de la misma aplicación PayPal.", 503);
  return { environment, client, secret, api: environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com" };
}
export function paypalConfig() {
  const auth = paypalAuthConfig();
  const webhook = configuredValue("PAYPAL_WEBHOOK_ID");
  if (!webhook) throw new PayPalError("Falta configurar PAYPAL_WEBHOOK_ID.", 503);
  let base: URL;
  try { base = new URL(configuredValue("PAYPAL_PUBLIC_BASE_URL")); }
  catch { throw new PayPalError("Configura PAYPAL_PUBLIC_BASE_URL con el dominio HTTPS del panel.", 503); }
  if (base.protocol !== "https:" || base.hostname === "invalid.invalid" || base.username || base.password) throw new PayPalError("Configura PAYPAL_PUBLIC_BASE_URL con el dominio HTTPS del panel.", 503);
  return { ...auth, webhook, origin: base.origin };
}
export function paypalAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function paypalAccessToken(config: ReturnType<typeof paypalAuthConfig>): Promise<string> {
  const label = `PP-AUTH-2 · ${config.environment.toUpperCase()}`;
  let auth: Response;
  try {
    auth = await fetch(`${config.api}/v1/oauth2/token`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Basic ${Buffer.from(`${config.client}:${config.secret}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  } catch {
    throw new PayPalError(`[${label} · NETWORK] No se pudo obtener respuesta de PayPal. Puede ser un fallo de red o tiempo de espera; no confirma que las claves sean incorrectas.`, 503);
  }
  const token = await auth.json().catch(() => null);
  if (auth.ok && typeof token?.access_token === "string" && token.access_token.length > 0) return token.access_token;
  // Only known protocol codes are shown. Never echo response text, credentials,
  // access tokens, headers or error_description, including in server logs.
  const known = ["invalid_client", "unauthorized_client", "invalid_request", "unsupported_grant_type", "invalid_scope", "access_denied", "server_error", "temporarily_unavailable"];
  const code = known.includes(token?.error) ? token.error : "UNEXPECTED_RESPONSE";
  const reason = code === "invalid_client" ? "PayPal rechazó la pareja Client ID / Secret de este despliegue. Deben pertenecer a la misma aplicación y al entorno indicado. Este error no permite identificar cuál de los dos valores falla."
    : ["unauthorized_client", "access_denied"].includes(code) ? "PayPal no autoriza esta aplicación para obtener acceso. Revisa el estado de la aplicación y sus permisos con PayPal."
    : auth.status === 429 ? "PayPal ha limitado temporalmente las solicitudes. Espera antes de volver a comprobar."
    : auth.status >= 500 ? "PayPal ha devuelto un fallo de su servicio. Reintenta más tarde; no cambies las claves por este mensaje."
    : "PayPal no devolvió un token de acceso válido. Comparte este código de diagnóstico, sin tus credenciales.";
  throw new PayPalError(`[${label} · HTTP ${auth.status} · ${code}] ${reason}`, 502);
}
export async function testPayPalConnection() {
  const config = paypalAuthConfig();
  await paypalAccessToken(config);
  return { environment: config.environment, diagnostic_version: "PP-AUTH-2", message: `Conexión de autenticación correcta · ${config.environment.toUpperCase()} · PP-AUTH-2. No se ha creado ni cobrado ningún pago. Falta comprobar el circuito de compra y webhook.` };
}
export async function paypalRequest(path: string, body?: unknown, requestId?: string): Promise<any> {
  const config = paypalConfig();
  const accessToken = await paypalAccessToken(config);
  const response = await fetch(`${config.api}${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Never expose provider payloads, tokens or payer information to a browser.
    const issue = data.details?.[0]?.issue;
    const reason = paymentFailureReason(data);
    throw new PayPalError(reason || `PayPal no pudo completar la operación (${String(issue || data.name || response.status).replace(/[^A-Z0-9_]/g, "").slice(0, 80)}).`, 502, reason);
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
// Applied centrally: staff reconciliation, callbacks and webhooks cannot bypass 3DS.
export function validateCardAuthentication(attempt: any, order: any) {
  if (!attempt.create_payload?.payment_source?.card) return;
  const card = order.payment_source?.card;
  if (!card) throw new PayPalError("PayPal no ha confirmado la tarjeta de este pago.", 409);
  const result = card.authentication_result;
  // With SCA_WHEN_REQUIRED, PayPal may not require authentication for this card.
  if (!result) return;
  const auth = result.three_d_secure?.authentication_status;
  const enrollment = result.three_d_secure?.enrollment_status;
  if (result.liability_shift === "POSSIBLE" && (!auth || ["Y", "A"].includes(auth))) return;
  if (result.liability_shift === "NO" && ["N", "U", "B"].includes(enrollment) && !auth) return;
  throw new PayPalError("La verificación bancaria no se ha completado. No se ha solicitado la captura del pago.", 409);
}
export async function reconcilePayPal(admin: any, attempt: any, captureApproved = true) {
  if (attempt.status === "completed" || !attempt.order_id) return attempt;
  if (attempt.environment !== paypalConfig().environment) throw new PayPalError("Este cobro pertenece a otro entorno de PayPal.", 409);
  let order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}`);
  validateOrder(attempt, order);
  if (order.status === "APPROVED" && captureApproved && attempt.status === "pending") {
    validateCardAuthentication(attempt, order);
    // Atomic competition with cancellation. A stale callback cannot capture a
    // cancelled link. Passive polling must never clear this in-flight marker.
    const claim = await admin.from(PAYPAL_TABLE).update({ remote_status: "CAPTURE_REQUESTED" })
      .eq("id", attempt.id).eq("status", "pending").eq("remote_status", attempt.remote_status).select("*").maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) {
      const latest = await admin.from(PAYPAL_TABLE).select("*").eq("id", attempt.id).single();
      if (latest.error) throw latest.error;
      return latest.data;
    }
    attempt = claim.data;
    try { await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}/capture`, {}, `capture-${attempt.id}`); }
    catch (error) {
      // A concurrent callback or a timeout may already have captured this order.
      order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(attempt.order_id)}`);
      validateOrder(attempt, order);
      if (order.status !== "COMPLETED") {
        if (error instanceof PayPalError && error.paymentReason && !order.purchase_units?.[0]?.payments?.captures?.length) {
          const saved = await admin.from(PAYPAL_TABLE).update({ status: "cancelled", remote_status: "CAPTURE_REJECTED", last_error: error.paymentReason })
            .eq("id", attempt.id).eq("status", "pending").eq("remote_status", "CAPTURE_REQUESTED");
          if (saved.error) throw saved.error;
        }
        throw error;
      }
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
      await admin.from(PAYPAL_TABLE).update({ remote_status: "CAPTURE_COMPLETED", last_error: "Pago recibido. Pendiente de guardar la confirmación del cobro; no solicites otro pago." }).eq("id", attempt.id).neq("status", "completed");
      throw new PayPalError("Pago recibido. Falta guardar su confirmación; pulsa Comprobar sin crear otro cobro.", 503);
    }
  } else {
    const rejected = ["DECLINED", "FAILED", "DENIED"].includes(capture?.status) || order.status === "VOIDED";
    const manuallyCancelled = attempt.remote_status === "CANCELLED_BY_STAFF";
    const remoteStatus = manuallyCancelled ? attempt.remote_status : capture ? `CAPTURE_${capture.status}`
      : attempt.remote_status === "CAPTURE_REQUESTED" ? "CAPTURE_REQUESTED"
      : attempt.status === "cancelled" ? attempt.remote_status : order.status;
    const reason = manuallyCancelled ? attempt.last_error : rejected
      ? paymentFailureReason(capture) || attempt.last_error || "Pago rechazado o anulado. PayPal no ha facilitado el motivo específico."
      : attempt.last_error;
    const { error } = await admin.from(PAYPAL_TABLE).update({ remote_status: remoteStatus,
      ...(rejected ? { status: "cancelled" } : {}), last_error: reason, checked_at: new Date().toISOString() })
      .eq("id", attempt.id).eq("remote_status", attempt.remote_status).neq("status", "completed").neq("remote_status", "CAPTURE_COMPLETED");
    if (error) throw error;
  }
  const { data, error } = await admin.from(PAYPAL_TABLE).select("*").eq("id", attempt.id).single();
  if (error) throw error;
  return data;
}
export async function cancelPayPalLink(admin: any, attempt: any) {
  // No PayPal capture is requested while checking whether cancellation is safe.
  const current = await reconcilePayPal(admin, attempt, false);
  if (current.status === "completed" || ["CAPTURE_REQUESTED", "CAPTURE_PENDING", "CAPTURE_COMPLETED"].includes(current.remote_status))
    throw new PayPalError("El pago ya está cobrado o procesándose. Comprueba su estado; no se puede cancelar ni cambiar de tarifa todavía.", 409);
  if (current.status === "cancelled") return current;
  if (!current.order_id || !["CREATED", "SAVED", "PAYER_ACTION_REQUIRED", "APPROVED", "VOIDED"].includes(current.remote_status))
    throw new PayPalError("No se ha podido confirmar que el cobro esté sin procesar. Comprueba su estado antes de cancelar.", 409);
  const saved = await admin.from(PAYPAL_TABLE).update({ status: "cancelled", remote_status: "CANCELLED_BY_STAFF",
    last_error: "Enlace cancelado por la central. Solicita un nuevo enlace si deseas continuar." })
    .eq("id", current.id).eq("status", "pending").eq("remote_status", current.remote_status).select("*").maybeSingle();
  if (saved.error) throw saved.error;
  if (!saved.data) throw new PayPalError("El estado cambió mientras cancelabas. Pulsa Comprobar antes de crear otro cobro.", 409);
  return saved.data;
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
