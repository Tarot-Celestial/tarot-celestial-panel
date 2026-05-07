import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim();
    const nombre = String(body?.nombre || "").trim();
    const fechaNacimiento = String(body?.fechaNacimiento || "").trim();
    const horaNacimiento = String(body?.horaNacimiento || "").trim();
    const ciudadNacimiento = String(body?.ciudadNacimiento || "").trim();

    if (!email || !nombre || !fechaNacimiento || !horaNacimiento || !ciudadNacimiento) {
      return NextResponse.json({ ok: false, message: "Completa tus datos antes de iniciar el pago." }, { status: 400 });
    }

    const secret = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_CARTA_ASTRAL_PRICE_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

    if (!secret || !priceId) {
      return NextResponse.json({
        ok: true,
        url: null,
        message: "La landing ya está lista. Falta configurar STRIPE_SECRET_KEY y STRIPE_CARTA_ASTRAL_PRICE_ID para activar el pago real.",
      });
    }

    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/carta-astral?success=1`,
      cancel_url: `${appUrl}/carta-astral?cancelled=1`,
      metadata: {
        producto: "carta_astral",
        nombre,
        email,
        fechaNacimiento,
        horaNacimiento,
        ciudadNacimiento,
        telefono: String(body?.telefono || ""),
        temaPrincipal: String(body?.temaPrincipal || "general"),
      },
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error: any) {
    return NextResponse.json({ ok: false, message: error?.message || "Error creando pago." }, { status: 500 });
  }
}
