import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminClient } from "@/lib/server/auth-cliente";
import { applyClientPurchase, getClientePack } from "@/lib/server/cliente-platform";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const signature = headers().get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ ok: false, error: "MISSING_STRIPE_SIGNATURE" }, { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, getEnv("STRIPE_WEBHOOK_SECRET"));

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const clienteId = String(session.metadata?.cliente_id || "").trim();
      const packId = String(session.metadata?.pack_id || "").trim();
      const pack = getClientePack(packId);
      if (!clienteId || !pack) {
        return NextResponse.json({ ok: false, error: "INVALID_STRIPE_METADATA" }, { status: 400 });
      }

      const admin = adminClient();
      const paymentRef = String(session.id || session.payment_intent || "").trim();
      const amountTotal = Number(session.amount_total || 0) / 100;

      await applyClientPurchase(admin, {
        clienteId,
        packId,
        paymentRef,
        paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
        stripeSessionId: session.id,
        amountUsd: amountTotal || pack.priceUsd,
        totalMinutes: Number(session.metadata?.total_minutes || pack.totalMinutes),
        metodo: "stripe_checkout",
        notas: `Stripe checkout completado · ${pack.nombre}`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_STRIPE_WEBHOOK" }, { status: 400 });
  }
}
