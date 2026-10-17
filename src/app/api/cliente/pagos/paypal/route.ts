import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { buildClientPurchaseSnapshot, buildPromotionPurchaseSnapshot } from "@/lib/server/client-paypal-checkout";
import { loadActivePromotion, promotionPackageSnapshot } from "@/lib/server/client-promotions";
import { PAYPAL_TABLE, PayPalError, paypalConfig, paypalRequest, clientPayPalOriginAllowed } from "@/lib/server/paypal-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const { admin, user, cliente } = await rouletteClient(req);
    const config = paypalConfig();
    const origin = req.headers.get("origin");
    if (!clientPayPalOriginAllowed(origin, config.origin)) return NextResponse.json({ error: "Origen no válido." }, { status: 403, headers });
    const body = await req.json().catch(() => null);
    const pack = getConfiguredMinutePack(body?.packId);
    const packId = typeof body?.packId === "string" ? body.packId : "";
    const promotionId = packId.startsWith("promo:") ? packId.slice(6) : "";
    if ((!pack && !uuid.test(promotionId)) || !uuid.test(body?.attemptId || "")) throw new PayPalError("Selecciona un paquete válido e inténtalo de nuevo.", 400);

    const selected = await admin.from(PAYPAL_TABLE).select("*").eq("id", body.attemptId).maybeSingle();
    if (selected.error) throw selected.error;
    let attempt = selected.data;
    const owns = (a: any) => a.checkout_kind === "client_purchase" && a.purchaser_auth_user_id === user.id &&
      a.cliente_id === cliente.id && a.environment === config.environment;
    if (attempt && (!owns(attempt) || attempt.pack_id !== packId)) throw new PayPalError("La operación no corresponde a esta compra.", 409);

    // A second tab/device or a changed browser request ID must not create a
    // second payable order while this customer's previous purchase is pending.
    const active = async () => {
      const result = await admin.from(PAYPAL_TABLE).select("*").eq("checkout_kind", "client_purchase")
        .eq("cliente_id", cliente.id).eq("environment", config.environment).eq("status", "pending").maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    };
    if (!attempt) attempt = await active();
    if (attempt && !owns(attempt)) throw new PayPalError("Tu pago pendiente necesita revisión de la central.", 409);
    if (!attempt) {
      // Deliberately independent from the legacy Mollie switch. Disabling new
      // purchases never disables reconciliation of a payment already created.
      const setting = await admin.from("cliente_payment_settings").select("paypal_client_enabled").eq("id", "default").maybeSingle();
      if (setting.error || setting.data?.paypal_client_enabled !== true) throw new PayPalError("Las compras con tarjeta no están disponibles en este momento. Contacta con tu central.", 503);
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
        purchase_payload: payload, create_payload: createPayload }).select("*").single();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      attempt = inserted.data || await active();
      if (!attempt || !owns(attempt)) throw new PayPalError("No se pudo recuperar esta compra. Reintenta con la misma operación.", 409);
    }
    if (attempt.pack_id !== packId) return NextResponse.json({ ok: false,
      error: "Tienes otra compra pendiente. Revísala o cancélala antes de elegir un paquete diferente.",
      attempt_id: attempt.id, url: attempt.order_id ? `${origin}/pago-tarjeta?ref=${attempt.public_token}` : null }, { status: 409, headers });

    if (!attempt.order_id) {
      // PayPal deduplicates creation for six hours. Outside that window we
      // cannot infer that a network timeout meant no order was created.
      if (attempt.status !== "pending" || Date.now() - Date.parse(attempt.created_at) > 5 * 60 * 60 * 1000)
        throw new PayPalError("Esta compra necesita comprobarse con la central antes de crear otro pago.", 409);
      const order = await paypalRequest("/v2/checkout/orders", attempt.create_payload, `create-${attempt.id}`);
      if (!/^[A-Z0-9]+$/.test(order.id || "")) throw new PayPalError("PayPal no devolvió una referencia válida.");
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
