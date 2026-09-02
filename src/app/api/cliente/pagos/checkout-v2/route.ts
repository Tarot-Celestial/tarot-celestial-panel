import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getActiveClientPaymentProvider } from "@/lib/server/client-payment-settings";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { redsysCurrencyLabel } from "@/lib/server/redsys";

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

function makeRedsysOrder() {
  // Redsys: 4-12 posiciones; las cuatro primeras deben ser numéricas.
  const time = String(Date.now()).slice(-10);
  const random = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${time}${random}`;
}

export async function POST(req: Request) {
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

    const provider = await getActiveClientPaymentProvider(gate.admin);
    const appUrl = baseUrl(req);

    if (provider === "stripe") {
      const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        success_url: `${appUrl}/cliente/dashboard?checkout=ok`,
        cancel_url: `${appUrl}/cliente/dashboard?checkout=cancelled`,
        customer_email: gate.cliente.email || undefined,
        phone_number_collection: { enabled: true },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              product_data: {
                name: pack.nombre,
                description: pack.descripcion,
                metadata: { source: "cliente_panel", pack_id: pack.id },
              },
              unit_amount: Math.round(pack.priceUsd * 100),
            },
          },
        ],
        metadata: {
          source: "cliente_panel",
          cliente_id: gate.cliente.id,
          pack_id: pack.id,
          total_minutes: String(pack.totalMinutes),
          roulette_level: pack.totalMinutes <= 30 ? "1" : "2",
        },
      });

      return NextResponse.json({ ok: true, provider, url: session.url, session_id: session.id });
    }

    let attempt: any = null;
    let lastError: any = null;

    for (let tries = 0; tries < 5 && !attempt; tries += 1) {
      const orderId = makeRedsysOrder();
      const publicToken = randomUUID();
      const { data, error } = await gate.admin
        .from("cliente_payment_attempts")
        .insert({
          cliente_id: gate.cliente.id,
          provider: "redsys",
          order_id: orderId,
          public_token: publicToken,
          pack_id: pack.id,
          amount: pack.priceUsd,
          currency: redsysCurrencyLabel(),
          total_minutes: pack.totalMinutes,
          status: "pending",
        })
        .select("id,public_token,order_id")
        .single();

      if (!error && data) attempt = data;
      else lastError = error;
    }

    if (!attempt) throw lastError || new Error("NO_SE_PUDO_CREAR_OPERACION_REDSYS");

    return NextResponse.json({
      ok: true,
      provider,
      url: `${appUrl}/api/cliente/pagos/redsys/start?token=${encodeURIComponent(attempt.public_token)}`,
      order_id: attempt.order_id,
    });
  } catch (error: any) {
    console.error("[cliente/pagos/checkout-v2]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "ERR_CHECKOUT" },
      { status: 500 },
    );
  }
}
