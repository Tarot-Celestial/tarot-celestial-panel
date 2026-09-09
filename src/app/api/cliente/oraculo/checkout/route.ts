import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getOraclePack, ORACLE_PACKS } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack, ORACLE_QUESTION_PACK } from "@/lib/server/oracle-questions";
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
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const questionPack = getOracleQuestionPack(body?.pack_id);
    const pack = questionPack || getOraclePack(body?.pack_id);
    if (!pack) return NextResponse.json({ ok: false, error: "ORACLE_PACK_NO_ENCONTRADO", packs: [...ORACLE_PACKS, ORACLE_QUESTION_PACK] }, { status: 400 });
    const isQuestions = Boolean(questionPack);
    const appUrl = baseUrl(req);

    const { data: attempt, error: attemptError } = await gate.admin
      .from("cliente_payment_attempts")
      .insert({
        cliente_id: gate.cliente.id,
        provider: "mollie",
        order_id: `mollie-init-${randomUUID()}`,
        public_token: randomUUID(),
        pack_id: pack.id,
        amount: pack.priceEur,
        currency: "EUR",
        total_minutes: 0,
        status: "pending",
      })
      .select("id")
      .single();
    if (attemptError) throw attemptError;
    attemptId = String(attempt?.id || "");

    const { payment, checkoutUrl } = await createMolliePayment({
      amount: pack.priceEur,
      currency: "EUR",
      description: `Tarot Celestial · ${pack.nombre}`,
      redirectUrl: isQuestions
        ? `${appUrl}/cliente/oraculo?questions_checkout=ok`
        : `${appUrl}/cliente/dashboard?oracle_checkout=ok#comprar-tiradas`,
      webhookUrl: `${appUrl}/api/webhooks/mollie`,
      metadata: {
        source: isQuestions ? "cliente_oracle_questions" : "cliente_oracle",
        attempt_id: attemptId,
        cliente_id: gate.cliente.id,
        pack_id: pack.id,
        ...(isQuestions
          ? { oracle_questions: questionPack!.questions }
          : { oracle_credits: Number((pack as any).credits || 0) }),
      },
    });

    const { error: updateError } = await gate.admin
      .from("cliente_payment_attempts")
      .update({ order_id: payment.id, provider_response: payment, updated_at: new Date().toISOString() })
      .eq("id", attemptId);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, provider: "mollie", url: checkoutUrl, payment_id: payment.id });
  } catch (error: any) {
    console.error("[cliente/oraculo/checkout]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ORACLE_CHECKOUT" }, { status: 500 });
  }
}
