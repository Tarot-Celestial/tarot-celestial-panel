import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { buildClientPurchaseSnapshot, buildPromotionPurchaseSnapshot, buildOraclePurchaseSnapshot } from "@/lib/server/client-paypal-checkout";
import { getOraclePack } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack } from "@/lib/server/oracle-questions";
import { loadActivePromotion, promotionPackageSnapshot } from "@/lib/server/client-promotions";
import { PAYPAL_TABLE, PayPalError, paypalConfig, paypalConfigForAttempt, paypalAccountForNewClientPurchase, paypalPublicOrigin, paypalRequest, validateOrder, clientPayPalOriginAllowed } from "@/lib/server/paypal-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const { admin, user, cliente } = await rouletteClient(req);
    const origin = req.headers.get("origin");
    if (!clientPayPalOriginAllowed(origin, paypalPublicOrigin())) return NextResponse.json({ error: "Origen no válido." }, { status: 403, headers });
    const body = await req.json().catch(() => null);
    const pack = getConfiguredMinutePack(body?.packId);
    const packId = typeof body?.packId === "string" ? body.packId : "";
    const oracleCandidate = getOracleQuestionPack(packId) || getOraclePack(packId);
    const oraclePack = oracleCandidate?.id === packId ? oracleCandidate : null;
    const promotionId = packId.startsWith("promo:") ? packId.slice(6) : "";
    if ((!pack && !oraclePack && !uuid.test(promotionId)) || !uuid.test(body?.attemptId || "")) throw new PayPalError("Selecciona un paquete válido e inténtalo de nuevo.", 400);

    const selected = await admin.from(PAYPAL_TABLE).select("*").eq("id", body.attemptId).maybeSingle();
    if (selected.error) throw selected.error;
    let attempt = selected.data;
    const owns = (a: any) => a.checkout_kind === "client_purchase" && a.purchaser_auth_user_id === user.id &&
      a.cliente_id === cliente.id;
    if (attempt && (!owns(attempt) || attempt.pack_id !== packId)) throw new PayPalError("La operación no corresponde a esta compra.", 409);

    // Each attempt is independent; retries only recover this exact request ID.
    if (!attempt) {
      // Deliberately independent from the legacy Mollie switch. Disabling new
      // purchases never disables reconciliation of a payment already created.
      const setting = await admin.from("cliente_payment_settings").select("paypal_client_enabled").eq("id", "default").maybeSingle();
      if (setting.error || setting.data?.paypal_client_enabled !== true) throw new PayPalError("Las compras con tarjeta no están disponibles en este momento. Contacta con tu central.", 503);
      const config = paypalConfig(paypalAccountForNewClientPurchase());
      const id = body.attemptId, token = randomUUID();
      let payload;
      let amount: number;
      if (promotionId) {
        const promotion = await loadActivePromotion(admin);
        const promotionPack = promotion?.packages.find((row: any) => String(row.id) === promotionId && row.is_active !== false);
        if (!promotionPack) throw new PayPalError("Esta promoción ya no está disponible.", 409);
        const snapshot = promotionPackageSnapshot(promotion, promotionPack);
        try { payload = buildPromotionPurchaseSnapshot(snapshot); }
        catch { throw new PayPalError("Esta promoción necesita tramitarse con tu central.", 409); }
        amount = snapshot.price;
      } else if (oraclePack) {
        payload = buildOraclePurchaseSnapshot(oraclePack);
        amount = oraclePack.priceEur;
      } else {
        payload = buildClientPurchaseSnapshot(pack!);
        amount = pack!.priceUsd;
      }
      const createPayload = { intent: "CAPTURE", purchase_units: [{ reference_id: id, custom_id: id, invoice_id: `TC-${id}`,
        description: `Tarot Celestial · ${payload.pack_name}`, amount: { currency_code: "EUR", value: amount.toFixed(2) } }],
        payment_source: { card: { attributes: { verification: { method: "SCA_WHEN_REQUIRED" } }, experience_context: {
          shipping_preference: "NO_SHIPPING", return_url: `${origin}/pago-tarjeta?ref=${token}`,
          cancel_url: `${origin}/pago-tarjeta?ref=${token}&cancel=1`,
        } } } };
      const inserted = await admin.from(PAYPAL_TABLE).insert({ id, cliente_id: cliente.id, worker_id: null,
        checkout_kind: "client_purchase", purchaser_auth_user_id: user.id, environment: config.environment,
        public_token: token, amount, currency: "EUR", pack_id: packId, pack_name: payload.pack_name,
        // The account is part of the original server-built snapshot. Retries
        // recover this exact row even if the activation switch changes later.
        purchase_payload: { ...payload, ...(config.account === "client_business_v1" ? {
          paypal_account: config.account, paypal_merchant_id: config.merchantId,
        } : {}) }, create_payload: createPayload }).select("*").single();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      const recovered = inserted.data ? null : await admin.from(PAYPAL_TABLE).select("*").eq("id", body.attemptId).maybeSingle();
      if (recovered?.error) throw recovered.error;
      attempt = inserted.data || recovered?.data;
      if (!attempt || !owns(attempt) || attempt.pack_id !== packId) throw new PayPalError("No se pudo recuperar esta compra. Reintenta con la misma operación.", 409);
    }

    const config = paypalConfigForAttempt(attempt);
    if (!attempt.order_id) {
      // PayPal deduplicates creation for six hours. Outside that window we
      // cannot infer that a network timeout meant no order was created.
      if (attempt.status !== "pending" || Date.now() - Date.parse(attempt.created_at) > 5 * 60 * 60 * 1000)
        throw new PayPalError("Esta compra necesita comprobarse con la central antes de crear otro pago.", 409);
      const order = await paypalRequest("/v2/checkout/orders", attempt.create_payload, `create-${attempt.id}`, config.account);
      if (!/^[A-Z0-9]+$/.test(order.id || "")) throw new PayPalError("PayPal no devolvió una referencia válida.");
      if (config.account === "client_business_v1") validateOrder({ ...attempt, order_id: order.id }, order);
      const url = `${origin}/pago-tarjeta?ref=${attempt.public_token}`;
      const saved = await admin.from(PAYPAL_TABLE).update({ order_id: order.id, approval_url: url, remote_status: order.status })
        .eq("id", attempt.id).is("order_id", null);
      if (saved.error) throw saved.error;
      const current = await admin.from(PAYPAL_TABLE).select("*").eq("id", attempt.id).single();
      if (current.error) throw current.error;
      attempt = current.data;
    }
    return NextResponse.json({ ok: true, attempt_id: attempt.id, url: `${origin}/pago-tarjeta?ref=${attempt.public_token}`,
      amount: Number(attempt.amount), currency: attempt.currency, status: attempt.status }, { headers });
  } catch (error) {
    const known = error instanceof PayPalError || error instanceof RouletteAccessError;
    return NextResponse.json({ ok: false, error: known ? error.message : "No se pudo preparar tu compra. Reintenta: conservaremos la misma operación para evitar cobros duplicados." },
      { status: known ? error.status : 503, headers });
  }
}
