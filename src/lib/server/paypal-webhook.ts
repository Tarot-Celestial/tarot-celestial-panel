import { NextResponse } from "next/server";
import { PAYPAL_TABLE, paypalAdmin, paypalConfig, paypalAccountForAttempt, verifyPayPalWebhook, reconcilePayPal, type PayPalAccount } from "@/lib/server/paypal-crm";

// The endpoint fixes the account before signature verification. Event content
// cannot choose credentials or redirect a notification to another account.
export async function handlePayPalWebhook(req: Request, account: PayPalAccount) {
  try {
    const raw = await req.text();
    if (raw.length > 1000000) return new NextResponse(null, { status: 413 });
    let event;
    try { event = JSON.parse(raw); } catch { return new NextResponse(null, { status: 400 }); }
    if (!await verifyPayPalWebhook(req, event, account)) return new NextResponse(null, { status: 401 });
    const supported = ["CHECKOUT.ORDER.APPROVED", "CHECKOUT.PAYMENT-APPROVAL.REVERSED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.DENIED"];
    if (!supported.includes(event.event_type)) return NextResponse.json({ ok: true });
    const orderId = event.event_type.startsWith("CHECKOUT.") ? event.resource?.id : event.resource?.supplementary_data?.related_ids?.order_id;
    if (typeof orderId !== "string" || !orderId) return new NextResponse(null, { status: 400 });
    const config = paypalConfig(account);
    const admin = paypalAdmin();
    const { data, error } = await admin.from(PAYPAL_TABLE).select("*").eq("order_id", orderId).eq("environment", config.environment).maybeSingle();
    if (error) throw error;
    // A verified notification is still insufficient for another account's row.
    // Legacy customer purchases have no marker and remain on the old endpoint.
    if (data && paypalAccountForAttempt(data) === account) await reconcilePayPal(admin, data);
    return NextResponse.json({ ok: true });
  } catch {
    // Non-2xx makes PayPal retry. Never acknowledge a failed purchase commit.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
