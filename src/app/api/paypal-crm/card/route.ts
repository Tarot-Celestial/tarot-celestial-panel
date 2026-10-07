import { NextResponse } from "next/server";
import { PAYPAL_TABLE, PayPalError, paypalAdmin, paypalConfig, paypalRequest, reconcilePayPal, validateOrder } from "@/lib/server/paypal-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The unguessable public token grants access to this checkout, never to CRM data.
// PAN, CVV, expiry and billing are sent by PayPal's iframes directly to PayPal.
export async function POST(req: Request) {
  try {
    const config = paypalConfig();
    if (req.headers.get("origin") !== config.origin) return new NextResponse(null, { status: 403, headers });
    const body = await req.json();
    if (!uuid.test(body.ref || "") || !["session", "order", "status", "capture"].includes(body.action))
      return NextResponse.json({ error: "Enlace de pago no válido." }, { status: 400, headers });
    const admin = paypalAdmin();
    const { data: attempt, error } = await admin.from(PAYPAL_TABLE).select("*")
      .eq("public_token", body.ref).eq("environment", config.environment).maybeSingle();
    if (error) throw error;
    if (!attempt?.order_id || !attempt.create_payload?.payment_source?.card)
      return NextResponse.json({ error: "Este enlace de tarjeta no está disponible. Contacta con tu central." }, { status: 404, headers });
    // Never accept an order ID, price, client ID or benefits supplied by the browser.
    const current = await reconcilePayPal(admin, attempt, body.action === "capture");
    const summary = { status: current.status, remote_status: current.remote_status,
      amount: Number(current.amount), currency: current.currency, description: current.pack_name };
    const canPay = current.status === "pending" && current.remote_status === "CREATED";
    if (body.action === "status" || body.action === "capture" || !canPay)
      return NextResponse.json({ ...summary, can_pay: false }, { headers });
    const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(current.order_id)}`);
    validateOrder(current, order);
    if (order.status !== "CREATED") return NextResponse.json({ ...summary, can_pay: false }, { headers });
    // Do not silently replace expired orders: the operator must reconcile first.
    if (Date.now() - Date.parse(order.create_time || current.created_at) > 3 * 60 * 60 * 1000)
      return NextResponse.json({ error: "Este enlace ha caducado. Contacta con tu central para revisar el cobro." }, { status: 410, headers });
    if (body.action === "order") return NextResponse.json({ order_id: current.order_id }, { headers });
    const token = await paypalRequest("/v1/identity/generate-token", {});
    if (typeof token.client_token !== "string" || !token.client_token) throw new Error("Missing client token");
    return NextResponse.json({ ...summary, can_pay: true, client_id: config.client,
      client_token: token.client_token, environment: config.environment }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PayPalError && error.status === 409 ? error.message
      : "No se pudo preparar o confirmar el pago. Si ya has pulsado Pagar, comprueba su estado antes de intentarlo de nuevo." },
      { status: error instanceof PayPalError && error.status === 409 ? 409 : 503, headers });
  }
}
