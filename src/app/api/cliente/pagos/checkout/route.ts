import { NextResponse } from "next/server";
import Stripe from "stripe";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { CLIENTE_PACKS, getClientePack } from "@/lib/server/cliente-platform";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function getBaseUrl(req: Request) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const packId = String(body?.pack_id || "").trim();
    const pack = getClientePack(packId);

    if (!pack) {
      return NextResponse.json({ ok: false, error: "PACK_NO_ENCONTRADO", packs: CLIENTE_PACKS }, { status: 400 });
    }

    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const baseUrl = getBaseUrl(req);
    const customerName = [gate.cliente?.nombre, gate.cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente Tarot Celestial";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${baseUrl}/cliente/dashboard?checkout=ok`,
      cancel_url: `${baseUrl}/cliente/dashboard?checkout=cancelled`,
      customer_email: gate.cliente?.email || undefined,
      phone_number_collection: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: pack.nombre,
              description: pack.descripcion,
              metadata: {
                pack_id: pack.id,
                source: "cliente_panel",
              },
            },
            unit_amount: Math.round(pack.priceUsd * 100),
          },
        },
      ],
      custom_text: {
        submit: { message: `Comprar ${pack.totalMinutes} minutos en Tarot Celestial` },
      },
      metadata: {
        source: "cliente_panel",
        cliente_id: gate.cliente.id,
        cliente_nombre: customerName,
        pack_id: pack.id,
        total_minutes: String(pack.totalMinutes),
        bonus_minutes: String(pack.bonusMinutes),
        phone: gate.cliente?.telefono_normalizado || gate.cliente?.telefono || "",
      },
    });

    return NextResponse.json({ ok: true, url: session.url, session_id: session.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_STRIPE_CHECKOUT" }, { status: 500 });
  }
}
