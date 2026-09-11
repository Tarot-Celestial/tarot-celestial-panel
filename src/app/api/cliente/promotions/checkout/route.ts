import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { createMolliePayment } from "@/lib/server/mollie";
import { loadActivePromotion, promotionPackageSnapshot } from "@/lib/server/client-promotions";

export const runtime = "nodejs";

function baseUrl(req: Request) {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || url.host;
  const protocol = forwardedProto || url.protocol.replace(":", "") || "https";
  return `${protocol}://${host}`;
}

export async function POST(req: Request) {
  let attemptId = "";
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const packageId = String(body?.package_id || "").trim();
    if (!packageId) return NextResponse.json({ ok: false, error: "PACKAGE_ID_REQUIRED" }, { status: 400 });

    const promotion = await loadActivePromotion(gate.admin);
    if (!promotion) return NextResponse.json({ ok: false, error: "PROMOCION_NO_ACTIVA" }, { status: 409 });
    const pack = (promotion.packages || []).find((row: any) => String(row.id) === packageId && row.is_active !== false);
    if (!pack) return NextResponse.json({ ok: false, error: "PAQUETE_PROMO_NO_DISPONIBLE" }, { status: 404 });
    const snapshot = promotionPackageSnapshot(promotion, pack);

    const internalOrder = `mollie-promo-${randomUUID()}`;
    const { data: attempt, error: attemptError } = await gate.admin.from("cliente_payment_attempts").insert({
      cliente_id: gate.cliente.id,
      provider: "mollie",
      order_id: internalOrder,
      public_token: randomUUID(),
      pack_id: `promo:${snapshot.package_id}`,
      amount: snapshot.price,
      currency: snapshot.currency,
      total_minutes: snapshot.paid_minutes + snapshot.free_minutes,
      status: "pending",
      promotion_id: snapshot.promotion_id,
      promotion_package_id: snapshot.package_id,
      promotion_snapshot: snapshot,
    }).select("id").single();
    if (attemptError) throw attemptError;
    attemptId = String(attempt.id || "");

    const appUrl = baseUrl(req);
    const { payment, checkoutUrl } = await createMolliePayment({
      amount: snapshot.price,
      currency: snapshot.currency,
      description: `Tarot Celestial · ${snapshot.promotion_name} · ${snapshot.package_name}`,
      redirectUrl: `${appUrl}/cliente/dashboard?checkout=ok&promo=1`,
      webhookUrl: `${appUrl}/api/webhooks/mollie`,
      metadata: {
        source: "cliente_promotion",
        attempt_id: attemptId,
        cliente_id: gate.cliente.id,
        promotion_id: snapshot.promotion_id,
        package_id: snapshot.package_id,
      },
    });

    const { error: updateError } = await gate.admin.from("cliente_payment_attempts").update({
      order_id: payment.id,
      provider_response: payment,
      updated_at: new Date().toISOString(),
    }).eq("id", attemptId);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, provider: "mollie", url: checkoutUrl, payment_id: payment.id });
  } catch (error: any) {
    console.error("[cliente/promotions/checkout]", error);
    if (attemptId) {
      try {
        const gate = await clientFromRequest(req);
        if (gate.admin) await gate.admin.from("cliente_payment_attempts").update({ status: "failed", last_error: error?.message || "PROMO_CHECKOUT_FAILED", updated_at: new Date().toISOString() }).eq("id", attemptId);
      } catch {}
    }
    return NextResponse.json({ ok: false, error: error?.message || "PROMO_CHECKOUT_FAILED" }, { status: 500 });
  }
}
