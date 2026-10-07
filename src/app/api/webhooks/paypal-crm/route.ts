import { NextResponse } from "next/server";
import { PAYPAL_TABLE, paypalAdmin, paypalConfig, verifyPayPalWebhook, reconcilePayPal } from "@/lib/server/paypal-crm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 1000000) return new NextResponse(null, { status: 413 });
    let event;
    try { event = JSON.parse(raw); } catch { return new NextResponse(null, { status: 400 }); }
    if (!await verifyPayPalWebhook(req, event)) return new NextResponse(null, { status: 401 });
    const supported = ["CHECKOUT.ORDER.APPROVED", "CHECKOUT.PAYMENT-APPROVAL.REVERSED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.DENIED"];
    if (!supported.includes(event.event_type)) return NextResponse.json({ ok: true });
    const orderId = event.event_type.startsWith("CHECKOUT.") ? event.resource?.id : event.resource?.supplementary_data?.related_ids?.order_id;
    if (!orderId) return new NextResponse(null, { status: 400 });
    const admin = paypalAdmin();
    const { data, error } = await admin.from(PAYPAL_TABLE).select("*").eq("order_id", orderId).eq("environment", paypalConfig().environment).maybeSingle();
    if (error) throw error;
    if (data) await reconcilePayPal(admin, data);
    // Other PayPal integrations in the same account keep their own handlers.
    return NextResponse.json({ ok: true });
  } catch {
    // Non-2xx makes PayPal retry. Never acknowledge a failed purchase commit.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
