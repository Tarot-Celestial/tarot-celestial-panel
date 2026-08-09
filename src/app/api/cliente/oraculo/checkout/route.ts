import { NextResponse } from "next/server";
import Stripe from "stripe";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getOraclePack, ORACLE_PACKS } from "@/lib/server/oracle-premium";

export const runtime = "nodejs";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function baseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const pack = getOraclePack(body?.pack_id);
    if (!pack) return NextResponse.json({ ok: false, error: "ORACLE_PACK_NO_ENCONTRADO", packs: ORACLE_PACKS }, { status: 400 });

    const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${baseUrl(req)}/cliente/dashboard?oracle_checkout=ok#comprar-tiradas`,
      cancel_url: `${baseUrl(req)}/cliente/dashboard?oracle_checkout=cancelled#comprar-tiradas`,
      customer_email: gate.cliente.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: {
            name: pack.nombre,
            description: pack.descripcion,
            metadata: { source: "cliente_oracle", pack_id: pack.id },
          },
          unit_amount: Math.round(pack.priceEur * 100),
        },
      }],
      metadata: {
        source: "cliente_oracle",
        cliente_id: gate.cliente.id,
        pack_id: pack.id,
        oracle_credits: String(pack.credits),
      },
    });

    return NextResponse.json({ ok: true, url: session.url, session_id: session.id });
  } catch (error: any) {
    console.error("[cliente/oraculo/checkout]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ORACLE_CHECKOUT" }, { status: 500 });
  }
}
