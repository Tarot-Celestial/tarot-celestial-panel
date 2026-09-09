import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { createMolliePayment } from "@/lib/server/mollie";

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
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const pack = getConfiguredMinutePack(body?.pack_id);
    if (!pack) {
      return NextResponse.json({ ok: false, error: "PACK_NO_ENCONTRADO" }, { status: 400 });
    }

    const appUrl = baseUrl(req);
    const internalOrder = `mollie-init-${randomUUID()}`;
    const { data: attempt, error: attemptError } = await gate.admin
      .from("cliente_payment_attempts")
      .insert({
        cliente_id: gate.cliente.id,
        provider: "mollie",
        order_id: internalOrder,
        public_token: randomUUID(),
        pack_id: pack.id,
        amount: pack.priceUsd,
        currency: "EUR",
        total_minutes: pack.totalMinutes,
        status: "pending",
      })
      .select("id")
      .single();
    if (attemptError) throw attemptError;
    attemptId = String(attempt?.id || "");

    const { payment, checkoutUrl } = await createMolliePayment({
      amount: pack.priceUsd,
      currency: "EUR",
      description: `Tarot Celestial · ${pack.nombre}`,
      redirectUrl: `${appUrl}/cliente/dashboard?checkout=ok`,
      webhookUrl: `${appUrl}/api/webhooks/mollie`,
      metadata: {
        source: "cliente_panel",
        attempt_id: attemptId,
        cliente_id: gate.cliente.id,
        pack_id: pack.id,
        total_minutes: pack.totalMinutes,
      },
    });

    const { error: updateError } = await gate.admin
      .from("cliente_payment_attempts")
      .update({
        order_id: payment.id,
        provider_response: payment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attemptId);
    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      provider: "mollie",
      url: checkoutUrl,
      payment_id: payment.id,
    });
  } catch (error: any) {
    console.error("[cliente/pagos/checkout-v2]", error);
    if (attemptId) {
      try {
        const gate = await clientFromRequest(req);
        await gate.admin
          .from("cliente_payment_attempts")
          .update({ status: "failed", last_error: error?.message || "ERR_MOLLIE", updated_at: new Date().toISOString() })
          .eq("id", attemptId);
      } catch {
        // El error original es el que debe devolverse al cliente.
      }
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "ERR_CHECKOUT" },
      { status: 500 },
    );
  }
}
