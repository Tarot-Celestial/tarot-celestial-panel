import { savePaymentLinkNote } from "@/lib/server/payment-link-note";
import { adminClient } from "@/lib/server/auth-cliente";
import { applyConfiguredMinutePurchase } from "@/lib/server/client-minute-purchase";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { getMolliePayment } from "@/lib/server/mollie";
import { getOraclePack, grantOracleCredits } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack, grantOracleQuestions } from "@/lib/server/oracle-questions";
import { applyPromotionMinutePurchase, type PromotionPackageSnapshot } from "@/lib/server/client-promotions";
import { pointsFromAmount, splitMinutes } from "@/lib/server/cliente-platform";



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

export async function processMolliePayment(paymentId: string) {
  const admin = adminClient();
  let attemptId = "";
  let processingVersion = "";
  try {
    if (!/^tr_[a-zA-Z0-9]+$/.test(paymentId)) return new Response("MOLLIE_PAYMENT_ID_REQUIRED", { status: 400 });
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

    if (String(attempt.order_id).startsWith("tr_") && attempt.order_id !== payment.id) throw new Error("MOLLIE_PAYMENT_ID_MISMATCH");
    if (metadata.cliente_id && metadata.cliente_id !== attempt.cliente_id) throw new Error("MOLLIE_CLIENT_MISMATCH");
    if (metadata.pack_id && metadata.pack_id !== attempt.pack_id) throw new Error("MOLLIE_PACK_MISMATCH");
    if (attempt.status === "completed") return okResponse();

    const status = String(payment.status || "").toLowerCase();
    if (["failed", "expired", "canceled", "cancelled"].includes(status)) {
      const { error: persistError } = await admin
        .from("cliente_payment_attempts")
        .update({
          status: status.startsWith("cancel") ? "cancelled" : "failed",
          provider_response: payment,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id).eq("updated_at", attempt.updated_at);
      if (persistError) throw persistError;
      return okResponse();
    }

    if (status !== "paid") {
      const { error: persistError } = await admin
        .from("cliente_payment_attempts")
        .update({ provider_response: payment, updated_at: new Date().toISOString() })
        .eq("id", attempt.id).eq("updated_at", attempt.updated_at);
      if (persistError) throw persistError;
      return okResponse();
    }

    // Atomic compare-and-swap; only reclaim a crashed processor after its lease expires.
    if (attempt.status === "processing" && Date.now() - Date.parse(attempt.updated_at) < 120000) return new Response("PROCESSING_RETRY", { status: 503 });
    processingVersion = new Date().toISOString();
    const { data: locked, error: lockError } = await admin.from("cliente_payment_attempts")
      .update({ status: "processing", order_id: paymentId, provider_response: payment, last_error: null, updated_at: processingVersion })
      .eq("id", attempt.id).eq("updated_at", attempt.updated_at).neq("status", "completed")
      .select("*").maybeSingle();
    if (lockError) throw lockError;
    if (!locked) return new Response("PROCESSING_RETRY", { status: 503 });

    if (metadata.source === "crm_cobrador") {
      const { data: existing, error: existingError } = await admin.from("crm_cliente_pagos")
        .select("id,cliente_id,importe,moneda").eq("referencia_externa", `mollie:${paymentId}`).limit(1);
      if (existingError) throw existingError;
      if (existing?.length && (existing[0].cliente_id !== locked.cliente_id || Number(existing[0].importe) !== paymentAmount || existing[0].moneda !== paymentCurrency)) throw new Error("PAYMENT_REQUIRES_REVIEW");
      // Old links may already have been settled manually. Never infer that they are unpaid.
      if (!existing?.length) {
        const { data: manual, error: manualError } = await admin.from("crm_cliente_pagos")
          .select("id").eq("cliente_id", locked.cliente_id).eq("estado", "completed")
          .eq("importe", paymentAmount).eq("moneda", paymentCurrency)
          .gte("created_at", new Date(Date.parse(locked.created_at) - 86400000).toISOString())
          .lte("created_at", new Date(Date.parse(payment.paidAt || locked.created_at) + 86400000).toISOString())
          .not("metodo", "like", "mollie%")
          .limit(1);
        if (manualError) throw manualError;
        if (metadata.link_version !== 2 || manual?.length) throw new Error("PAYMENT_REQUIRES_REVIEW");
      }
    }

    const promotionSnapshot = locked.promotion_snapshot && typeof locked.promotion_snapshot === "object"
      ? locked.promotion_snapshot as PromotionPackageSnapshot
      : null;
    if (promotionSnapshot && promotionSnapshot.kind !== "promotion_minute_pack") {
      throw new Error("PROMOTION_SNAPSHOT_INVALID");
    }
    const crmManualAmount = String(locked.pack_id || "") === "crm_manual_amount" && String(metadata.source || "") === "crm_cobrador";
    const minutePack = promotionSnapshot || crmManualAmount ? null : getConfiguredMinutePack(locked.pack_id);
    const oraclePack = promotionSnapshot || crmManualAmount ? null : getOraclePack(locked.pack_id);
    const questionPack = promotionSnapshot || crmManualAmount ? null : getOracleQuestionPack(locked.pack_id);
    const pack = promotionSnapshot
      ? { nombre: `${promotionSnapshot.promotion_name} · ${promotionSnapshot.package_name}` }
      : crmManualAmount
      ? { nombre: `Cobro personalizado ${paymentAmount.toFixed(2)} ${paymentCurrency}` }
      : minutePack || oraclePack || questionPack;
    if (!pack) throw new Error("PACK_MOLLIE_NO_ENCONTRADO");

    let duplicated = false;
    let completedPaymentId = "";
    let creditedMinutes = { normal: 0, free: 0 };
    if (promotionSnapshot?.kind === "promotion_minute_pack") {
      const purchase = await applyPromotionMinutePurchase(admin, {
        attemptId: String(locked.id),
        clienteId: locked.cliente_id,
        snapshot: promotionSnapshot,
        paymentRef: `mollie:${paymentId}`,
        amount: paymentAmount,
        currency: paymentCurrency === "USD" ? "USD" : "EUR",
      });
      duplicated = Boolean(purchase.duplicated);
      completedPaymentId = String((purchase as any)?.payment?.id || "");
      // The promotion RPC commits benefits, CRM note and attempt completion
      // atomically, changing updated_at. Do not close it again with the old lease.
      const { data: committed, error: committedError } = await admin
        .from("cliente_payment_attempts").select("status")
        .eq("id", locked.id).eq("order_id", paymentId).maybeSingle();
      if (committedError) throw committedError;
      if (committed?.status !== "completed") throw new Error("PROMOTION_COMPLETION_RETRY");
      return okResponse();
    } else if (crmManualAmount) {
      const { data: transaction, error: transactionError } = await admin.rpc("cliente_confirmar_compra_ruleta_v2", {
        p: {
          cliente_id: locked.cliente_id,
          payment_ref: `mollie:${paymentId}`,
          amount: paymentAmount,
          currency: paymentCurrency === "USD" ? "USD" : "EUR",
          metodo: "mollie_crm_manual",
          free: 0,
          normal: 0,
          points: pointsFromAmount(paymentAmount),
          notas: String(metadata.notes || "Cobro personalizado iniciado desde CRM"),
          created_by_user_id: metadata.initiated_by_worker_id || null,
          created_by_role: metadata.initiated_by_role || "central",
        },
      });
      if (transactionError) throw transactionError;
      duplicated = Boolean(transaction?.duplicated);
      completedPaymentId = String(transaction?.payment?.id || "");
    } else if (questionPack) {
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
        metodo: String(metadata.source || "") === "crm_cobrador" ? "mollie_crm" : "mollie_checkout",
        createdByUserId: metadata.source === "crm_cobrador" ? metadata.initiated_by_worker_id : undefined,
        createdByRole: metadata.source === "crm_cobrador" ? metadata.initiated_by_role : undefined,
        notas: String(metadata.source || "") === "crm_cobrador"
          ? `Mollie CRM completado · ${minutePack!.nombre} · iniciado por ${String(metadata.initiated_by_name || "Central")}`
          : `Mollie completado · ${minutePack!.nombre}`,
      });
      creditedMinutes = purchase.creditedMinutes || splitMinutes(Number((purchase as any)?.payment?.paid_minutes ?? minutePack!.totalMinutes));
      duplicated = purchase.duplicated;
      completedPaymentId = String((purchase as any)?.payment?.id || "");
    }

    if (String(metadata.source || "") === "crm_cobrador" && completedPaymentId && metadata.initiated_by_worker_id) {
      const { error: attributionError } = await admin
        .from("crm_cliente_pagos")
        .update({
          created_by_user_id: metadata.initiated_by_worker_id,
          created_by_role: metadata.initiated_by_role || "central",
        })
        .eq("id", completedPaymentId);
      if (attributionError) throw attributionError;
    }

    // The purchase RPC is already idempotent. If saving its note fails, retry the
    // same reference: no extra balance is granted and the stable note ID prevents duplicates.
    if (!promotionSnapshot) {
      await savePaymentLinkNote(admin, {
        paymentId, clienteId: locked.cliente_id, packName: pack.nombre,
        amount: paymentAmount, currency: paymentCurrency,
        ...creditedMinutes, paidAt: payment.paidAt,
        initiatedBy: metadata.initiated_by_name, manual: crmManualAmount,
        source: metadata.source === "crm_cobrador" ? "link" : "web",
      });
    }

    // Persist completion explicitly: a resolved Supabase Promise can still contain an error.
    const { data: completed, error: completionError } = await admin.from("cliente_payment_attempts").update({
      status: "completed", completed_at: new Date().toISOString(), order_id: paymentId,
      provider_response: payment, last_error: null, updated_at: new Date().toISOString(),
    }).eq("id", locked.id).eq("updated_at", processingVersion).select("id").maybeSingle();
    if (completionError) throw completionError;
    if (!completed) throw new Error("PAYMENT_COMPLETION_RETRY");

    return okResponse();
  } catch (error: any) {
    console.error("[webhooks/mollie]", error);
    const message = String(error?.message || "ERR_MOLLIE");
    if (attemptId && (message.includes("PROMOTION_PURCHASE_REQUIRES_REVIEW") || message === "PAYMENT_REQUIRES_REVIEW")) {
      const { error: reviewError } = await admin
        .from("cliente_payment_attempts")
        .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
        .eq("id", attemptId).eq("updated_at", processingVersion);
      return reviewError ? new Response("REVIEW_SAVE_FAILED", { status: 500 }) : okResponse();
    }
    if (attemptId && processingVersion) {
      try {
        await admin
          .from("cliente_payment_attempts")
          .update({
            status: "pending",
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", attemptId)
          .eq("status", "processing").eq("updated_at", processingVersion);
      } catch {
        // No ocultamos el error original si falla la recuperación del intento.
      }
    }
    return new Response(error?.message || "ERR_MOLLIE_WEBHOOK", { status: 500 });
  }
}
