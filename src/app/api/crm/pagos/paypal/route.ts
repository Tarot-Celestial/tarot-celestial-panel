import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { rouletteStaff } from "@/lib/server/ruleta-access";
import { CLIENTE_MINUTE_PACKS, getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { splitMinutes } from "@/lib/server/cliente-platform";
import { rouletteLevelForPurchaseAmount } from "@/lib/ruleta";
import { PAYPAL_TABLE, PayPalError, paypalConfig, paypalConfigForAttempt, paypalRequest, approvalUrl, reconcilePayPal, testPayPalConnection, cancelPayPalLink, paypalAccountForAttempt, validateOrder, preparePayPalCrmReplacement } from "@/lib/server/paypal-crm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicPack = (p: typeof CLIENTE_MINUTE_PACKS[number]) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion,
  amount: p.priceUsd, total_minutes: p.totalMinutes, package_level: p.rouletteLevel, roulette_level: rouletteLevelForPurchaseAmount(p.priceUsd), roulette_spins: p.rouletteSpins,
  coins: p.rewardCoins || 0, oracle_credits: p.oracleCredits || 0, highlight: !!p.highlight });
function selectedAccount(value: unknown) {
  if (value === undefined || value === null || value === "legacy") return "legacy" as const;
  if (value === "leonaris") return "client_business_v1" as const;
  throw new PayPalError("Selecciona una cuenta de cobro válida.", 400);
}
function accountQuery(query: any, account: string) {
  return account === "legacy" ? query.or("purchase_payload->>paypal_account.is.null,purchase_payload->>paypal_account.eq.legacy")
    : query.eq("purchase_payload->>paypal_account", account);
}
function publicAttempt(a: any) { return { id: a.id, pack_id: a.pack_id, amount: Number(a.amount), currency: a.currency, status: a.status,
  paypal_account: paypalAccountForAttempt(a), created_at: a.created_at, capture_id: a.capture_id,
  remote_status: a.remote_status, payment_id: a.order_id, checkout_url: a.approval_url, last_error: a.last_error, pack_name: a.pack_name,
  cancellation_blocked: a.status === "completed" || !!a.capture_id || !!a.payment_id || ["CAPTURE_REQUESTED", "CAPTURE_PENDING", "CAPTURE_COMPLETED"].includes(a.remote_status) }; }
function fail(error: any) { return NextResponse.json({ ok: false, error: error instanceof PayPalError || error.status ? error.message : "No se pudo guardar o comprobar el cobro. Revisa la migración y vuelve a intentarlo con la misma operación." }, { status: error.status || 500, headers }); }
export async function GET(req: Request) {
  try {
    const { admin, worker } = await rouletteStaff(req);
    const params = new URL(req.url).searchParams;
    const account = selectedAccount(params.get("account"));
    const config = paypalConfig(account);
    if (params.get("pending_all") === "1") {
      const clientId = params.get("cliente_id");
      if (!clientId || !uuid.test(clientId)) throw new PayPalError("Clienta no válida.", 400);
      let pendingQuery = admin.from(PAYPAL_TABLE).select("*").eq("environment", config.environment)
        .eq("checkout_kind", "crm_collection").eq("cliente_id", clientId).eq("status", "pending");
      if (worker.role !== "admin") pendingQuery = pendingQuery.eq("worker_id", worker.id);
      const { data, error } = await pendingQuery.order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return NextResponse.json({ ok: true, pending: (data || []).map(publicAttempt) }, { headers });
    }
    let query = accountQuery(admin.from(PAYPAL_TABLE).select("*").eq("environment", config.environment).eq("checkout_kind", "crm_collection"), account);
    if (worker.role !== "admin") query = query.eq("worker_id", worker.id);
    const id = params.get("attempt_id");
    if (!id) {
      const clientId = params.get("cliente_id");
      if (!clientId || !uuid.test(clientId)) throw new PayPalError("Clienta no válida.", 400);
      const { data, error } = await query.eq("cliente_id", clientId).order("created_at", { ascending: false }).limit(50);
      let pendingQuery = accountQuery(admin.from(PAYPAL_TABLE).select("*").eq("environment", config.environment).eq("checkout_kind", "crm_collection"), account).eq("cliente_id", clientId).eq("status", "pending");
      if (worker.role !== "admin") pendingQuery = pendingQuery.eq("worker_id", worker.id);
      const pending = await pendingQuery.order("created_at", { ascending: false }).limit(1);
      if (pending.error) throw pending.error;
      const latest = pending.data?.[0] || data?.[0];
      if (error) throw error;
      return NextResponse.json({ ok: true, packs: CLIENTE_MINUTE_PACKS.map(publicPack), latest: latest ? publicAttempt(latest) : null, history: (data || []).map(publicAttempt), environment: config.environment, account }, { headers });
    }
    const { data: attempt, error } = await query.eq("id", id).maybeSingle();
    if (error) throw error;
    if (!attempt) throw new PayPalError("Cobro no encontrado.", 404);
    let current = attempt;
    if (params.get("reconcile") === "1") {
      try { current = await reconcilePayPal(admin, attempt, true, true); }
      catch (error) {
        const saved = await admin.from(PAYPAL_TABLE).select("*").eq("id", id).single();
        if (attempt.status === "completed" || saved.error || saved.data?.remote_status !== "CAPTURE_COMPLETED") throw error;
        current = saved.data;
      }
    }
    return NextResponse.json({ ok: true, attempt: publicAttempt(current) }, { headers });
  } catch (error) { return fail(error); }
}
export async function POST(req: Request) {
  try {
    const { admin, worker } = await rouletteStaff(req);
    const body = await req.json();
    const account = selectedAccount(body.account);
    // Staff-only OAuth check: no purchase, no WhatsApp, no database mutations.
    if (body.action === "test_connection") return NextResponse.json({ ok: true, ...await testPayPalConnection(account) }, { headers });
    const config = paypalConfig(account);
    if (body.action === "cancel" || body.action === "inspect") {
      if (!uuid.test(body.attempt_id || "")) throw new PayPalError("Cobro no válido.", 400);
      let query = accountQuery(admin.from(PAYPAL_TABLE).select("*").eq("id", body.attempt_id).eq("environment", config.environment).eq("checkout_kind", "crm_collection"), account);
      if (worker.role !== "admin") query = query.eq("worker_id", worker.id);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) throw new PayPalError("Cobro no encontrado.", 404);
      const cancelled = body.action === "cancel" ? await cancelPayPalLink(admin, data) : await reconcilePayPal(admin, data, false, true);
      return NextResponse.json({ ok: true, attempt: publicAttempt(cancelled) }, { headers });
    }
    if (!uuid.test(body.request_id || "") || !uuid.test(body.cliente_id || "")) throw new PayPalError("Identificador no válido.", 400);
    const id = body.request_id;
    const pack = getConfiguredMinutePack(body.pack_id);
    if (!pack && body.pack_id !== "crm_manual_amount") throw new PayPalError("Selecciona un paquete válido.", 400);
    const amount = pack ? pack.priceUsd : Number(String(body.manual_amount || "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new PayPalError("Importe no válido: máximo 5.000 € y dos decimales.", 400);
    const { data: client, error: clientError } = await admin.from("crm_clientes").select("id").eq("id", body.cliente_id).maybeSingle();
    if (clientError) throw clientError;
    if (!client) throw new PayPalError("Clienta no encontrada.", 404);
    let { data: attempt, error } = await admin.from(PAYPAL_TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!attempt) {
      const token = randomUUID();
      const minutes = splitMinutes(pack?.totalMinutes || 0);
      const level = pack ? rouletteLevelForPurchaseAmount(amount) : null;
      const payload = { paypal_account: account, ...(config.merchantId ? { paypal_merchant_id: config.merchantId } : {}), pack_id: pack?.id || "crm_manual_amount", pack_name: pack?.nombre || "Importe personalizado", free: minutes.free, normal: minutes.normal,
        points: pack?.rewardCoins || 0, oracle_credits: pack?.oracleCredits || 0,
        roulette_level: level, roulette_spins: pack && level ? pack.rouletteSpins : 0,
        reward_policy_version: 1, pricing_mode: pack ? "regular" : "manual_amount",
        purchase_classification: pack ? "nada" : "promo", rewards_eligible: Boolean(pack), package_level: pack?.rouletteLevel || null,
        created_by_role: worker.role, notas: `PayPal · CRM · ${String(body.notes || "").slice(0, 500)}` };
      const createPayload = { intent: "CAPTURE", purchase_units: [{ reference_id: id, custom_id: id, invoice_id: `TC-${id}`,
        description: `${account === "client_business_v1" ? "Tarot Leonaris" : "Tarot Celestial"} · ${pack?.nombre || "Importe personalizado"}`,
        ...(config.merchantId ? { payee: { merchant_id: config.merchantId } } : {}),
        amount: { currency_code: "EUR", value: amount.toFixed(2) } }], payment_source: { card: {
        attributes: { verification: { method: "SCA_WHEN_REQUIRED" } }, experience_context: {
        shipping_preference: "NO_SHIPPING",
        return_url: `${config.origin}/pago-paypal?ref=${token}`, cancel_url: `${config.origin}/pago-paypal?ref=${token}&cancel=1`,
      } } } };
      const previous = await preparePayPalCrmReplacement(admin, { clientId: client.id, environment: config.environment, workerId: worker.id, isAdmin: worker.role === "admin" });
      const inserted = await admin.rpc("tc_replace_paypal_crm_attempt", { p_previous: previous, p_is_admin: worker.role === "admin", p_attempt: {
        id, cliente_id: client.id, worker_id: worker.id, environment: config.environment,
        public_token: token, amount, currency: "EUR", pack_id: body.pack_id,
        pack_name: pack?.nombre || "Importe personalizado", purchase_payload: payload, create_payload: createPayload,
      } });
      if (inserted.error) {
        if (/PAYPAL_REPLACEMENT_CHANGED|PAYPAL_PENDING_COLLECTION/.test(inserted.error.message || "")) throw new PayPalError("El cobro cambió mientras se preparaba el enlace. Vuelve a pulsar Crear para comprobarlo y continuar sin duplicarlo.", 409);
        if (/PAYPAL_REPLACEMENT_PROCESSING/.test(inserted.error.message || "")) throw new PayPalError("El pago anterior ya está cobrado o procesándose. Comprueba su estado antes de solicitar otro cobro.", 409);
        if (/PAYPAL_REPLACEMENT_FORBIDDEN/.test(inserted.error.message || "")) throw new PayPalError("Administración debe revisar el enlace creado por otra central.", 403);
        throw inserted.error;
      }
      attempt = inserted.data;

    }
    if (attempt.worker_id !== worker.id || attempt.cliente_id !== client.id || attempt.pack_id !== body.pack_id || Number(attempt.amount) !== amount || attempt.environment !== config.environment || attempt.checkout_kind !== "crm_collection" || paypalAccountForAttempt(attempt) !== account) throw new PayPalError("La operación pertenece a otro cobro. No se ha creado un pago nuevo.", 409);
    const attemptConfig = paypalConfigForAttempt(attempt);
    if (!attempt.order_id) {
      // PayPal retains request IDs for six hours. Never create again after that window.
      if (attempt.status !== "pending" || Date.now() - Date.parse(attempt.created_at) > 5 * 60 * 60 * 1000) throw new PayPalError("Creación interrumpida antigua. Administración debe revisar PayPal antes de generar otro cobro.", 409);
      const order = await paypalRequest("/v2/checkout/orders", attempt.create_payload, `create-${id}`, attemptConfig.account);
      if (!/^[A-Z0-9]+$/.test(order.id || "")) throw new PayPalError("PayPal devolvió una referencia inválida.");
      if (account === "client_business_v1") validateOrder({ ...attempt, order_id: order.id }, order);
      // Existing wallet attempts retain their original payload and approval link.
      const url = attempt.create_payload?.payment_source?.card
        ? `${config.origin}/pago-tarjeta?ref=${attempt.public_token}` : approvalUrl(order, attemptConfig.account);
      const saved = await admin.from(PAYPAL_TABLE).update({ order_id: order.id, approval_url: url, remote_status: order.status }).eq("id", id).eq("status", "pending").is("order_id", null);
      if (saved.error) throw saved.error;
      const current = await admin.from(PAYPAL_TABLE).select("*").eq("id", id).single();
      if (current.error) throw current.error;
      attempt = current.data;
    }
    return NextResponse.json({ ok: true, attempt_id: attempt.id, url: attempt.approval_url, payment_id: attempt.order_id,
      amount: Number(attempt.amount), currency: attempt.currency, status: attempt.status, remote_status: attempt.remote_status,
      pack: pack ? publicPack(pack) : null, manual: !pack, paypal_account: account, replaced_count: Number(attempt.purchase_payload?.replaced_count || 0), replaced_attempt_ids: attempt.purchase_payload?.replaces_attempt_ids || [] }, { headers });
  } catch (error) { return fail(error); }
}
