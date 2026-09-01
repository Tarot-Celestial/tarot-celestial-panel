import { NextResponse } from "next/server";
import Stripe from "stripe";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getOraclePack, ORACLE_PACKS } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack, ORACLE_QUESTION_PACK } from "@/lib/server/oracle-questions";

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
  if (process.env.CLIENTE_AUTOMATED_CHECKOUT_ENABLED !== "true") {
    return NextResponse.json(
      {
        ok: false,
        error: "CHECKOUT_TEMPORALMENTE_DESACTIVADO",
        message: "El cobro se realiza manualmente por teléfono con el código Cliente web.",
      },
      { status: 503 }
    );
  }

  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const questionPack = getOracleQuestionPack(body?.pack_id);
    const pack = questionPack || getOraclePack(body?.pack_id);
    if (!pack) return NextResponse.json({ ok: false, error: "ORACLE_PACK_NO_ENCONTRADO", packs: [...ORACLE_PACKS, ORACLE_QUESTION_PACK] }, { status: 400 });
    const isQuestions = Boolean(questionPack);

    const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url: isQuestions ? `${baseUrl(req)}/cliente/oraculo?questions_checkout=ok` : `${baseUrl(req)}/cliente/dashboard?oracle_checkout=ok#comprar-tiradas`,
      cancel_url: isQuestions ? `${baseUrl(req)}/cliente/oraculo?questions_checkout=cancelled` : `${baseUrl(req)}/cliente/dashboard?oracle_checkout=cancelled#comprar-tiradas`,
      customer_email: gate.cliente.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: {
            name: pack.nombre,
            description: pack.descripcion,
            metadata: { source: isQuestions ? "cliente_oracle_questions" : "cliente_oracle", pack_id: pack.id },
          },
          unit_amount: Math.round(pack.priceEur * 100),
        },
      }],
      metadata: {
        source: isQuestions ? "cliente_oracle_questions" : "cliente_oracle",
        cliente_id: gate.cliente.id,
        pack_id: pack.id,
        ...(isQuestions ? { oracle_questions: String(questionPack!.questions) } : { oracle_credits: String((pack as any).credits) }),
      },
    });

    return NextResponse.json({ ok: true, url: session.url, session_id: session.id });
  } catch (error: any) {
    console.error("[cliente/oraculo/checkout]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ORACLE_CHECKOUT" }, { status: 500 });
  }
}
