import { adminClient } from "@/lib/server/auth-cliente";
import { applyConfiguredMinutePurchase } from "@/lib/server/client-minute-purchase";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { getMolliePayment } from "@/lib/server/mollie";
import { getOraclePack, grantOracleCredits } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack, grantOracleQuestions } from "@/lib/server/oracle-questions";

export const runtime = "nodejs";

function okResponse() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function metadataObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Metadata antigua o no JSON: se ignora.
    }
  }
  return {};
}

export async function POST(req: Request) {
  const admin = adminClient();
  let attemptId = "";

  try {
    const contentType = String(req.headers.get("content-type") || "").toLowerCase();
    let paymentId = "";

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      paymentId = String(body?.id || "").trim();
    } else {
      const form = await req.formData().catch(() => null);
      paymentId = String(form?.get("id") || "").trim();
    }

    if (!paymentId) return new Response("MOLLIE_PAYMENT_ID_REQUIRED", { status: 400 });

    // La notificación no se considera una confirmación de pago por sí sola.
    // Consultamos siempre el estado real directamente a Mollie.
    const payment = await getMolliePayment(paymentId);
    const metadata = metadataObject(payment.metadata);

    let attempt: any = null;
    const metadataAttemptId = String(metadata.attempt_id || "").trim();
    if (metadataAttemptId) {
      const { data, error } = await admin
        .from("cliente_payment_attempts")
        .select("*")
        .eq("id", metadataAttemptId)
        .eq("provider", "mollie")
        .maybeSingle();
      if (error) throw error;
      attempt = data;
    }

    if (!attempt) {
      const { data, error } = await admin
        .from("cliente_payment_attempts")
        .select("*")
        .eq("provider", "mollie")
        .eq("order_id", paymentId)
        .maybeSingle();
      if (error) throw error;
      attempt = data;
    }

    if (!attempt) return new Response("MOLLIE_PAYMENT_NOT_FOUND", { status: 404 });
    attemptId = String(attempt.id || "");

    const paymentAmount = Number(payment.amount?.value || 0);
    const paymentCurrency = String(payment.amount?.currency || "").toUpperCase();
    const expectedAmount = Number(attempt.amount || 0);
    const expectedCurrency = String(attempt.currency || "EUR").toUpperCase();
    if (!Number.isFinite(paymentAmount) || Math.abs(paymentAmount - expectedAmount) > 0.001) {
      throw new Error("MOLLIE_AMOUNT_MISMATCH");
    }
    if (paymentCurrency !== expectedCurrency) throw new Error("MOLLIE_CURRENCY_MISMATCH");

    if (attempt.status === "completed") return okResponse();

    const status = String(payment.status || "").toLowerCase();
    if (["failed", "expired", "canceled", "cancelled"].includes(status)) {
      await admin
        .from("cliente_payment_attempts")
        .update({
          status: status.startsWith("cancel") ? "cancelled" : "failed",
          provider_response: payment,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id);
      return okResponse();
    }

    if (status !== "paid") {
      await admin
        .from("cliente_payment_attempts")
        .update({ provider_response: payment, updated_at: new Date().toISOString() })
        .eq("id", attempt.id);
      return okResponse();
    }

    const { data: locked, error: lockError } = await admin
      .from("cliente_payment_attempts")
      .update({ status: "processing", provider_response: payment, updated_at: new Date().toISOString() })
      .eq("id", attempt.id)
      .in("status", ["pending", "failed", "processing"])
      .select("*")
      .maybeSingle();
    if (lockError) throw lockError;
    if (!locked) return okResponse();

    const minutePack = getConfiguredMinutePack(locked.pack_id);
    const oraclePack = getOraclePack(locked.pack_id);
    const questionPack = getOracleQuestionPack(locked.pack_id);
    const pack = minutePack || oraclePack || questionPack;
    if (!pack) throw new Error("PACK_MOLLIE_NO_ENCONTRADO");

    let duplicated = false;
    if (questionPack) {
      await grantOracleQuestions(admin, {
        clienteId: locked.cliente_id,
        questions: questionPack.questions,
        reference: `mollie:${paymentId}`,
        notes: `Mollie completado · ${questionPack.nombre}`,
        meta: { mollie_payment_id: paymentId, amount_eur: paymentAmount },
      });
    } else if (oraclePack) {
      await grantOracleCredits(admin, {
        clienteId: locked.cliente_id,
        credits: oraclePack.credits,
        reference: `mollie:${paymentId}`,
        packId: oraclePack.id,
        notes: `Mollie completado · ${oraclePack.nombre}`,
        meta: { mollie_payment_id: paymentId, amount_eur: paymentAmount },
      });
    } else {
      const purchase = await applyConfiguredMinutePurchase(admin, {
        clienteId: locked.cliente_id,
        packId: minutePack!.id,
        paymentRef: `mollie:${paymentId}`,
        paymentIntent: paymentId,
        stripeSessionId: null,
        amount: paymentAmount,
        currency: paymentCurrency === "USD" ? "USD" : "EUR",
        metodo: "mollie_checkout",
        notas: `Mollie completado · ${minutePack!.nombre}`,
      });
      duplicated = purchase.duplicated;
    }

    await Promise.allSettled([
      admin
        .from("cliente_payment_attempts")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          order_id: paymentId,
          provider_response: payment,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", locked.id),
      duplicated
        ? Promise.resolve()
        : admin.from("crm_client_notes").insert({
            cliente_id: locked.cliente_id,
            texto: `🟣 Compra web: ha comprado ${pack.nombre} (${paymentAmount.toFixed(2)} ${paymentCurrency}) mediante Mollie`,
            author_user_id: null,
            author_name: "Sistema",
            author_email: null,
            is_pinned: false,
          }),
    ]);

    return okResponse();
  } catch (error: any) {
    console.error("[webhooks/mollie]", error);
    if (attemptId) {
      try {
        await admin
          .from("cliente_payment_attempts")
          .update({
            status: "pending",
            last_error: error?.message || "ERR_MOLLIE",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attemptId)
          .eq("status", "processing");
      } catch {
        // No ocultamos el error original si falla la recuperación del intento.
      }
    }
    return new Response(error?.message || "ERR_MOLLIE_WEBHOOK", { status: 500 });
  }
}
