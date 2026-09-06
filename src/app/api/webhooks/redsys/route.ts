import { adminClient } from "@/lib/server/auth-cliente";
import { applyConfiguredMinutePurchase } from "@/lib/server/client-minute-purchase";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { getOraclePack, grantOracleCredits } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack, grantOracleQuestions } from "@/lib/server/oracle-questions";
import {
  decodeMerchantParameters,
  REDSYS_SIGNATURE_VERSION,
  verifyRedsysSignature,
} from "@/lib/server/redsys";

export const runtime = "nodejs";

function readParam(params: Record<string, any>, ...names: string[]) {
  for (const name of names) {
    const direct = params?.[name];
    if (direct !== undefined && direct !== null) return String(direct);
    const found = Object.keys(params || {}).find(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );
    if (found) return String(params[found]);
  }
  return "";
}

function okResponse() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request) {
  const admin = adminClient();
  let attemptId = "";

  try {
    const form = await req.formData();
    const merchantParameters = String(form.get("Ds_MerchantParameters") || "");
    const signature = String(form.get("Ds_Signature") || "");
    const signatureVersion = String(form.get("Ds_SignatureVersion") || "");

    if (!merchantParameters || !signature) {
      return new Response("REDSYS_PAYLOAD_INVALIDO", { status: 400 });
    }
    if (signatureVersion && signatureVersion !== REDSYS_SIGNATURE_VERSION) {
      return new Response("REDSYS_SIGNATURE_VERSION_INVALIDA", { status: 400 });
    }

    const params = decodeMerchantParameters(merchantParameters);
    const orderId = readParam(params, "Ds_Order", "DS_ORDER", "DS_MERCHANT_ORDER");
    if (!orderId || !verifyRedsysSignature(merchantParameters, signature, orderId)) {
      return new Response("REDSYS_SIGNATURE_INVALIDA", { status: 400 });
    }

    const { data: existing, error: loadError } = await admin
      .from("cliente_payment_attempts")
      .select("*")
      .eq("provider", "redsys")
      .eq("order_id", orderId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!existing) return new Response("REDSYS_ORDER_NOT_FOUND", { status: 404 });
    attemptId = String(existing.id || "");

    const responseCode = Number(readParam(params, "Ds_Response", "DS_RESPONSE"));
    const approved = Number.isFinite(responseCode) && responseCode >= 0 && responseCode <= 99;

    const responseAmount = Number(readParam(params, "Ds_Amount", "DS_AMOUNT"));
    const expectedAmount = Math.round(Number(existing.amount || 0) * 100);
    if (!Number.isFinite(responseAmount) || responseAmount <= 0 || responseAmount !== expectedAmount) {
      throw new Error("REDSYS_AMOUNT_MISMATCH");
    }

    if (existing.status === "completed") return okResponse();
    if (!approved) {
      await admin
        .from("cliente_payment_attempts")
        .update({
          status: "failed",
          provider_response: params,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return okResponse();
    }

    if (existing.status === "completed") return okResponse();

    const { data: locked, error: lockError } = await admin
      .from("cliente_payment_attempts")
      .update({
        status: "processing",
        provider_response: params,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      // The payment RPC is idempotent: retry a processing attempt after a lost response/crash.
      .in("status", ["pending", "failed", "processing"])
      .select("*")
      .maybeSingle();
    if (lockError) throw lockError;
    if (!locked) return okResponse();

    const minutePack = getConfiguredMinutePack(locked.pack_id);
    const oraclePack = getOraclePack(locked.pack_id);
    const questionPack = getOracleQuestionPack(locked.pack_id);
    const pack = minutePack || oraclePack || questionPack;
    if (!pack) throw new Error("PACK_REDSYS_NO_ENCONTRADO");

    let duplicated = false;
    if (questionPack) {
      await grantOracleQuestions(admin, {
        clienteId: locked.cliente_id,
        questions: questionPack.questions,
        reference: `redsys:${orderId}`,
        notes: `Redsys completado · ${questionPack.nombre}`,
        meta: { order_id: orderId, amount_eur: responseAmount / 100 },
      });
    } else if (oraclePack) {
      await grantOracleCredits(admin, {
        clienteId: locked.cliente_id,
        credits: oraclePack.credits,
        reference: `redsys:${orderId}`,
        packId: oraclePack.id,
        notes: `Redsys completado · ${oraclePack.nombre}`,
        meta: { order_id: orderId, amount_eur: responseAmount / 100 },
      });
    } else {
      const purchase = await applyConfiguredMinutePurchase(admin, {
        clienteId: locked.cliente_id,
        packId: minutePack!.id,
        paymentRef: `redsys:${orderId}`,
        paymentIntent:
          readParam(params, "Ds_AuthorisationCode", "DS_AUTHORISATIONCODE") || null,
        stripeSessionId: null,
        amount: responseAmount / 100,
        currency: String(locked.currency || "EUR").toUpperCase() === "USD" ? "USD" : "EUR",
        metodo: "redsys_checkout",
        notas: `Redsys completado · ${minutePack!.nombre}`,
      });
      duplicated = purchase.duplicated;
    }

    await Promise.allSettled([
      admin
        .from("cliente_payment_attempts")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          provider_response: params,
          updated_at: new Date().toISOString(),
        })
        .eq("id", locked.id),
      duplicated ? Promise.resolve() : admin.from("crm_client_notes").insert({
        cliente_id: locked.cliente_id,
        texto: `🟣 Compra web: ha comprado ${pack.nombre} (${Number(
          locked.amount || ("priceUsd" in pack ? pack.priceUsd : pack.priceEur),
        ).toFixed(2)} ${String(locked.currency || "EUR")}) mediante Redsys`,
        author_user_id: null,
        author_name: "Sistema",
        author_email: null,
        is_pinned: false,
      }),
    ]);

    return okResponse();
  } catch (error: any) {
    console.error("[webhooks/redsys]", error);
    if (attemptId) {
      try {
        await admin
          .from("cliente_payment_attempts")
          .update({
            status: "pending",
            last_error: error?.message || "ERR_REDSYS",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attemptId)
          .eq("status", "processing");
      } catch {
        // No ocultamos el error original si falla la recuperación del intento.
      }
    }
    return new Response(error?.message || "ERR_REDSYS_WEBHOOK", { status: 500 });
  }
}
