import { NextResponse } from "next/server";
import Stripe from "stripe";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { getActiveClientPaymentProvider } from "@/lib/server/client-payment-settings";

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
    if (!pack) return NextResponse.json({ ok: false, error: "PACK_NO_ENCONTRADO" }, { status: 400 });

    const provider = await getActiveClientPaymentProvider(gate.admin);

    if (provider === "stripe") {
      const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        success_url: `${baseUrl(req)}/cliente/dashboard?checkout=ok`,
        cancel_url: `${baseUrl(req)}/cliente/dashboard?checkout=cancelled`,
        customer_email: gate.cliente.email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: pack.nombre,
              description: pack.descripcion,
              metadata: { source: "cliente_panel_v2", pack_id: String(pack.id) },
            },
            unit_amount: Math.round(Number(pack.priceUsd) * 100),
          },
        }],
        metadata: {
          source: "cliente_panel_v2",
          cliente_id: gate.cliente.id,
          pack_id: String(pack.id),
          total_minutes: String(pack.totalMinutes),
        },
      });

      return NextResponse.json({ ok: true, provider, url: session.url, session_id: session.id });
    }

    let attempt: any = null;
    let lastError: any = null;
    for (let tries = 0; tries < 5 && !attempt; tries += 1) {
      const orderId = makeRedsysOrder();
      const publicToken = crypto.randomUUID();
      const { data, error } = await gate.admin
        .from("cliente_payment_attempts")
        .insert({
          cliente_id: gate.cliente.id,
          provider: "redsys",
          order_id: orderId,
          public_token: publicToken,
          pack_id: String(pack.id),
          amount: Number(pack.priceUsd),
          currency: String(process.env.REDSYS_CURRENCY || "840") === "978" ? "EUR" : "USD",
          total_minutes: Number(pack.totalMinutes),
          status: "pending",
        })
        .select("id,public_token,order_id")
        .single();
      if (!error && data) attempt = data;
      else lastError = error;
    }
    if (!attempt) throw lastError || new Error("No se pudo crear la operación Redsys");

    return NextResponse.json({
      ok: true,
      provider,
      url: `${baseUrl(req)}/api/cliente/pagos/redsys/start?token=${encodeURIComponent(attempt.public_token)}`,
      order_id: attempt.order_id,
    });
  } catch (error: any) {
    console.error("[cliente/pagos/checkout-v2]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CHECKOUT" }, { status: 500 });
  }
}
