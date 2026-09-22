import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { rouletteStaff } from "@/lib/server/ruleta-access";
import { CLIENTE_MINUTE_PACKS, getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { createMolliePaymentLink } from "@/lib/server/mollie";
import { processMolliePayment, processMolliePaymentLink } from "@/lib/server/mollie-payment-processing";
import { paymentWhatsappConfig, sendPaymentLink } from "@/lib/server/payment-link-whatsapp";
import { rouletteLevelForPurchaseAmount } from "@/lib/ruleta";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MANUAL_PACK_ID = "crm_manual_amount";
function publicPack(pack: (typeof CLIENTE_MINUTE_PACKS)[number]) {
  return { id: pack.id, nombre: pack.nombre, descripcion: pack.descripcion, amount: pack.priceUsd,
    total_minutes: pack.totalMinutes, roulette_level: rouletteLevelForPurchaseAmount(pack.priceUsd), roulette_spins: rouletteLevelForPurchaseAmount(pack.priceUsd) ? pack.rouletteSpins : 0,
    coins: pack.rewardCoins || 0, oracle_credits: pack.oracleCredits || 0, highlight: Boolean(pack.highlight) };
}
function allowed(attempt: any, worker: any) {
  const meta = attempt.provider_response?.metadata;
  return meta?.source === "crm_cobrador" && (worker.role === "admin" || meta.initiated_by_worker_id === worker.id);
}
function publicAttempt(a: any) {
  const paymentLinkId = String(a.provider_response?.payment_link_id || (String(a.order_id || "").startsWith("pl_") ? a.order_id : "") || "").trim();
  return { id: a.id, cliente_id: a.cliente_id, pack_id: a.pack_id, amount: Number(a.amount), currency: a.currency,
    total_minutes: a.total_minutes, status: a.status, remote_status: a.provider_response?.status || null,
    payment_id: a.order_id?.startsWith("tr_") ? a.order_id : null,
    payment_link_id: paymentLinkId || null,
    checkout_url: a.provider_response?.payment_link_url || a.provider_response?._links?.paymentLink?.href || a.provider_response?._links?.checkout?.href || null,
    last_error: a.last_error, completed_at: a.completed_at, created_at: a.created_at, whatsapp: a.whatsapp || {} };
}
export async function GET(req: Request) {
  try {
    const { admin, worker } = await rouletteStaff(req);
    const params = new URL(req.url).searchParams;
    const id = params.get("attempt_id");
    if (!id) {
      let latest = null;
      if (params.get("cliente_id")) {
        const { data, error } = await admin.from("cliente_payment_attempts").select("*")
          .eq("cliente_id", params.get("cliente_id")!).eq("provider", "mollie")
          .contains("provider_response", { metadata: { source: "crm_cobrador", ...(worker.role === "admin" ? {} : { initiated_by_worker_id: worker.id }) } })
          .order("created_at", { ascending: false }).limit(1);
        if (error) throw error;
        latest = data?.[0] ? publicAttempt(data[0]) : null;
      }
      return NextResponse.json({ ok: true, packs: CLIENTE_MINUTE_PACKS.map(publicPack), manual_pack_id: MANUAL_PACK_ID, latest, whatsapp_config: paymentWhatsappConfig() }, { headers });
    }
    const { data: initial, error } = await admin.from("cliente_payment_attempts").select("*").eq("id", id).eq("provider", "mollie").maybeSingle();
    if (error) throw error;
    if (!initial || !allowed(initial, worker)) return NextResponse.json({ ok: false, error: "COBRO_NO_ENCONTRADO" }, { status: 404, headers });
    // Realtime notifications only read persisted state. Reconnect/manual checks also reconcile Mollie.
    if (params.get("reconcile") === "1" && initial.status !== "completed" && !initial.last_error?.includes("REQUIRES_REVIEW")) {
      const paymentLinkId = String(initial.provider_response?.payment_link_id || (String(initial.order_id || "").startsWith("pl_") ? initial.order_id : "") || "").trim();
      if (paymentLinkId) await processMolliePaymentLink(paymentLinkId, initial.id);
      else if (initial.order_id?.startsWith("tr_")) await processMolliePayment(initial.order_id);
    }
    const { data: current, error: readError } = await admin.from("cliente_payment_attempts").select("*").eq("id", id).single();
    if (readError) throw readError;
    return NextResponse.json({ ok: true, attempt: publicAttempt(current) }, { headers });
  } catch (error: any) { return NextResponse.json({ ok: false, error: error.message || "No se pudo comprobar el cobro." }, { status: error.status || 500, headers }); }
}
export async function POST(req: Request) {
  try {
    const { admin, worker } = await rouletteStaff(req);
    const body = await req.json();
    if (body.action === "send_whatsapp") {
      const { data: attempt, error } = await admin.from("cliente_payment_attempts").select("*").eq("id", body.attempt_id).single();
      if (error || !allowed(attempt, worker)) return NextResponse.json({ ok: false, error: "COBRO_NO_ENCONTRADO" }, { status: 404, headers });
      const { data: cliente, error: clientError } = await admin.from("crm_clientes").select("nombre,apellido,telefono,telefono_normalizado,pais").eq("id", attempt.cliente_id).single();
      if (clientError) throw clientError;
      return NextResponse.json({ ok: true, whatsapp: await sendPaymentLink(admin, attempt, cliente) }, { headers });
    }
    const id = String(body.request_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ ok: false, error: "Identificador de operación inválido." }, { status: 400, headers });
    const pack = getConfiguredMinutePack(body.pack_id);
    if (!pack && body.pack_id !== MANUAL_PACK_ID) return NextResponse.json({ ok: false, error: "Pack no válido." }, { status: 400, headers });
    const amount = pack ? Number(pack.priceUsd) : Math.round(Number(String(body.manual_amount).replace(",", ".")) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) return NextResponse.json({ ok: false, error: "Importe no válido." }, { status: 400, headers });
    const { data: cliente, error: clientError } = await admin.from("crm_clientes").select("id,nombre,apellido,telefono,telefono_normalizado,pais").eq("id", body.cliente_id).single();
    if (clientError) throw clientError;
    // El pago Mollie no depende del teléfono. El número solo se valida en el cliente al abrir WhatsApp Web.
    // Así una ficha con teléfono incompleto o mal formateado nunca bloquea la creación del enlace de cobro.
    // Explicit server override, otherwise the active deployment origin; never the unrelated legacy APP_URL.
    const base = new URL(process.env.MOLLIE_PUBLIC_BASE_URL || new URL(req.url).origin).origin;
    if (!base.startsWith("https://")) throw new Error("Configura MOLLIE_PUBLIC_BASE_URL con el dominio HTTPS público.");
    const metadata = { source: "crm_cobrador", link_version: 2, attempt_id: id, cliente_id: cliente.id,
      pack_id: pack?.id || MANUAL_PACK_ID, total_minutes: pack?.totalMinutes || 0, manual_amount: !pack,
      roulette_level: rouletteLevelForPurchaseAmount(amount),
      notes: String(body.notes || "").trim().slice(0,500), initiated_by_worker_id: worker.id,
      initiated_by_role: worker.role, initiated_by_name: worker.display_name || "Central" };
    const { error: insertError } = await admin.from("cliente_payment_attempts").insert({ id, cliente_id: cliente.id, provider: "mollie", order_id: `crm-mollie-init-${id}`, public_token: randomUUID(), pack_id: metadata.pack_id, amount, currency: "EUR", total_minutes: metadata.total_minutes, status: "pending", provider_response: { metadata, creation_base_url: base } });
    if (insertError && insertError.code !== "23505") throw insertError;
    const { data: existing, error: existingError } = await admin.from("cliente_payment_attempts").select("*").eq("id", id).single();
    if (existingError) throw existingError;
    if (!allowed(existing, worker) || existing.cliente_id !== cliente.id || Number(existing.amount) !== amount || existing.pack_id !== metadata.pack_id) return NextResponse.json({ ok: false, error: "La operación ya pertenece a otro cobro." }, { status: 409, headers });
    let attempt = existing;
    const existingLinkUrl = String(existing.provider_response?.payment_link_url || existing.provider_response?._links?.paymentLink?.href || "").trim();
    const existingLinkId = String(existing.provider_response?.payment_link_id || (String(existing.order_id || "").startsWith("pl_") ? existing.order_id : "") || "").trim();

    if (!existingLinkId || !existingLinkUrl) {
      if (Date.now() - Date.parse(existing.created_at) > 55 * 60000) throw new Error("El intento antiguo necesita revisión antes de crear otro enlace.");
      const creationBase = existing.provider_response.creation_base_url;
      const { paymentLink, paymentLinkUrl } = await createMolliePaymentLink({
        amount,
        currency: "EUR",
        description: pack ? `Tarot Celestial · ${pack.nombre}` : `Tarot Celestial · Cobro personalizado ${amount.toFixed(2)} €`,
        redirectUrl: `${creationBase}/pago-confirmado`,
        webhookUrl: `${creationBase}/api/webhooks/mollie`,
        idempotencyKey: `crm-link-${id}`,
      });
      const providerResponse = {
        ...paymentLink,
        metadata: existing.provider_response.metadata,
        creation_base_url: creationBase,
        payment_link_id: paymentLink.id,
        payment_link_url: paymentLinkUrl,
        status: "waiting_for_customer",
      };
      const { data: updated, error: updateError } = await admin
        .from("cliente_payment_attempts")
        .update({ order_id: paymentLink.id, provider_response: providerResponse, last_error: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      attempt = updated;
      if (!paymentLinkUrl) throw new Error("MOLLIE_PAYMENT_LINK_NO_DISPONIBLE");
    }

    const paymentLinkUrl = String(attempt.provider_response?.payment_link_url || attempt.provider_response?._links?.paymentLink?.href || "").trim();
    const paymentLinkId = String(attempt.provider_response?.payment_link_id || (String(attempt.order_id || "").startsWith("pl_") ? attempt.order_id : "") || "").trim();
    if (!paymentLinkUrl || !paymentLinkId) throw new Error("Mollie creó el intento pero no devolvió el enlace de pago. Reintenta el mismo cobro.");
    return NextResponse.json({
      ok: true,
      attempt_id: id,
      payment_id: attempt.order_id?.startsWith("tr_") ? attempt.order_id : null,
      payment_link_id: paymentLinkId,
      url: paymentLinkUrl,
      amount,
      currency: "EUR",
      status: attempt.status,
      remote_status: attempt.provider_response?.status,
      pack: pack ? publicPack(pack) : null,
      manual: !pack,
      whatsapp: attempt.whatsapp,
      whatsapp_config: paymentWhatsappConfig(),
    }, { headers });
  } catch (error: any) { return NextResponse.json({ ok: false, error: error.message || "No se pudo generar el enlace. Reintenta la misma operación." }, { status: error.status || 500, headers }); }
}
