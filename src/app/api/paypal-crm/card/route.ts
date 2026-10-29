import { NextResponse } from "next/server";
import { PAYPAL_TABLE, PayPalError, paypalAdmin, paypalConfigForAttempt, paypalPublicOrigin, paypalRequest, reconcilePayPal, validateOrder, cancelPayPalLink, clientPayPalOriginAllowed } from "@/lib/server/paypal-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The unguessable public token grants access to this checkout, never to CRM data.
// PAN, CVV, expiry and billing are sent by PayPal's iframes directly to PayPal.
export async function POST(req: Request) {
  try {
    const configuredOrigin = paypalPublicOrigin();
    const origin = req.headers.get("origin");
    if (!clientPayPalOriginAllowed(origin, configuredOrigin)) return new NextResponse(null, { status: 403, headers });
    const body = await req.json();
    if (!uuid.test(body.ref || "") || !["session", "order", "status", "capture", "cancel"].includes(body.action))
      return NextResponse.json({ error: "Enlace de pago no válido." }, { status: 400, headers });
    const admin = paypalAdmin();
    const { data: attempt, error } = await admin.from(PAYPAL_TABLE).select("*")
      .eq("public_token", body.ref).maybeSingle();
    if (error) throw error;
    if (!attempt?.order_id || !attempt.create_payload?.payment_source?.card)
      return NextResponse.json({ error: "Este enlace de tarjeta no está disponible. Contacta con tu central." }, { status: 404, headers });
    if (attempt.checkout_kind !== "client_purchase" && origin !== configuredOrigin)
      return new NextResponse(null, { status: 403, headers });
    const config = paypalConfigForAttempt(attempt);
    // Never accept an order ID, price, client ID or benefits supplied by the browser.
    if (body.action === "cancel" && attempt.checkout_kind !== "client_purchase")
      return NextResponse.json({ error: "Contacta con tu central para cancelar este enlace." }, { status: 403, headers });
    const current = body.action === "cancel" ? await cancelPayPalLink(admin, attempt, "client")
      : await reconcilePayPal(admin, attempt, body.action === "capture");
    const isPurchase = current.checkout_kind === "client_purchase";
    const purchaseKind = current.purchase_payload?.purchase_kind === "oracle" ? "oracle" : "minutes";
    const summary = { status: current.status, remote_status: current.remote_status,
      amount: Number(current.amount), currency: current.currency, description: current.pack_name, last_error: current.last_error || null,
      attempt_id: current.id, checkout_kind: isPurchase ? "client_purchase" : "crm_collection",
      can_cancel: isPurchase && current.status === "pending" && ["CREATED", "SAVED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(current.remote_status),
      credited: isPurchase && current.status === "completed" && !!current.payment_id,
      ...(isPurchase ? { purchase_kind: purchaseKind, purchase_summary: {
        purchaseKind, packName: current.pack_name, totalMinutes: current.purchase_payload.total_minutes,
        normalMinutes: current.purchase_payload.normal, freeMinutes: current.purchase_payload.free,
        oracleCredits: Number(current.purchase_payload.oracle_credits || 0), oracleQuestions: Number(current.purchase_payload.oracle_questions || 0),
      } } : {}) };
    const canPay = current.status === "pending" && current.remote_status === "CREATED";
    if (body.action === "status" || body.action === "capture" || body.action === "cancel" || !canPay)
      return NextResponse.json({ ...summary, can_pay: false }, { headers });
    const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(current.order_id)}`, undefined, undefined, config.account);
    validateOrder(current, order);
    if (order.status !== "CREATED") return NextResponse.json({ ...summary, can_pay: false }, { headers });
    // Do not silently replace expired orders: the operator must reconcile first.
    if (Date.now() - Date.parse(order.create_time || current.created_at) > 3 * 60 * 60 * 1000) {
      // Keep cancellation available for an expired customer checkout. Otherwise
      // its pending-order lock would prevent the customer choosing a new pack.
      if (isPurchase) return NextResponse.json({ ...summary, can_pay: false,
        last_error: "Este formulario ha caducado. Cancela esta compra para volver a elegir tu paquete." }, { headers });
      return NextResponse.json({ error: "Este enlace ha caducado. Contacta con tu central para revisar el cobro." }, { status: 410, headers });
    }
    if (body.action === "order") return NextResponse.json({ order_id: current.order_id }, { headers });
    const token = await paypalRequest("/v1/identity/generate-token", {}, undefined, config.account);
    if (typeof token.client_token !== "string" || !token.client_token) throw new Error("Missing client token");
    return NextResponse.json({ ...summary, can_pay: true, client_id: config.client,
      client_token: token.client_token, environment: config.environment, paypal_account: config.account }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PayPalError && (error.status === 409 || error.paymentReason) ? error.message
      : "No se pudo preparar o confirmar el pago. Si ya has pulsado Pagar, comprueba su estado antes de intentarlo de nuevo." },
      { status: error instanceof PayPalError && error.status === 409 ? 409 : 503, headers });
  }
}
