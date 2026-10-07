import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { rouletteStaff } from "@/lib/server/ruleta-access";
import { CLIENTE_MINUTE_PACKS, getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { pointsFromAmount, splitMinutes } from "@/lib/server/cliente-platform";
import { rouletteLevelForPurchaseAmount } from "@/lib/ruleta";
import { PAYPAL_TABLE, PayPalError, paypalConfig, paypalRequest, approvalUrl, reconcilePayPal, testPayPalConnection } from "@/lib/server/paypal-crm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicPack = (p: typeof CLIENTE_MINUTE_PACKS[number]) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion,
  amount: p.priceUsd, total_minutes: p.totalMinutes, roulette_level: rouletteLevelForPurchaseAmount(p.priceUsd), roulette_spins: p.rouletteSpins,
  coins: p.rewardCoins || 0, oracle_credits: p.oracleCredits || 0, highlight: !!p.highlight });
function publicAttempt(a: any) { return { id: a.id, pack_id: a.pack_id, amount: Number(a.amount), currency: a.currency, status: a.status,
  remote_status: a.remote_status, payment_id: a.order_id, checkout_url: a.approval_url, last_error: a.last_error, pack_name: a.pack_name }; }
function fail(error: any) { return NextResponse.json({ ok: false, error: error instanceof PayPalError || error.status ? error.message : "No se pudo guardar o comprobar el cobro. Revisa la migración y vuelve a intentarlo con la misma operación." }, { status: error.status || 500, headers }); }
export async function GET(req: Request) {
  try {
    const { admin, worker } = await rouletteStaff(req);
    const config = paypalConfig();
    const params = new URL(req.url).searchParams;
    let query = admin.from(PAYPAL_TABLE).select("*").eq("environment", config.environment);
    if (worker.role !== "admin") query = query.eq("worker_id", worker.id);
    const id = params.get("attempt_id");
    if (!id) {
      const clientId = params.get("cliente_id");
      if (!clientId || !uuid.test(clientId)) throw new PayPalError("Clienta no válida.", 400);
      const { data, error } = await query.eq("cliente_id", clientId).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return NextResponse.json({ ok: true, packs: CLIENTE_MINUTE_PACKS.map(publicPack), latest: data?.[0] ? publicAttempt(data[0]) : null, environment: config.environment }, { headers });
    }
    const { data: attempt, error } = await query.eq("id", id).maybeSingle();
    if (error) throw error;
    if (!attempt) throw new PayPalError("Cobro no encontrado.", 404);
    let current = attempt;
    if (params.get("reconcile") === "1") {
      try { current = await reconcilePayPal(admin, attempt); }
      catch (error) {
        const saved = await admin.from(PAYPAL_TABLE).select("*").eq("id", id).single();
        if (saved.error || saved.data?.remote_status !== "CAPTURE_COMPLETED") throw error;
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
    // Staff-only OAuth check: no purchase, no WhatsApp, no database mutations.
    if (body.action === "test_connection") return NextResponse.json({ ok: true, ...await testPayPalConnection() }, { headers });
    const config = paypalConfig();
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
      const level = rouletteLevelForPurchaseAmount(amount);
      const payload = { pack_id: pack?.id, pack_name: pack?.nombre, free: minutes.free, normal: minutes.normal,
        points: pack ? pack.rewardCoins || 0 : pointsFromAmount(amount), oracle_credits: pack?.oracleCredits || 0,
        roulette_level: level, ...(pack ? { roulette_spins: level ? pack.rouletteSpins : 0 } : {}),
        created_by_role: worker.role, notas: `PayPal · CRM · ${String(body.notes || "").slice(0, 500)}` };
      const createPayload = { intent: "CAPTURE", purchase_units: [{ reference_id: id, custom_id: id, invoice_id: `TC-${id}`,
        description: `Tarot Celestial · ${pack?.nombre || "Importe personalizado"}`,
        amount: { currency_code: "EUR", value: amount.toFixed(2) } }], payment_source: { paypal: { experience_context: {
        brand_name: "Tarot Celestial", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
        return_url: `${config.origin}/pago-paypal?ref=${token}`, cancel_url: `${config.origin}/pago-paypal?ref=${token}&cancel=1`,
      } } } };
      const insert = await admin.from(PAYPAL_TABLE).insert({ id, cliente_id: client.id, worker_id: worker.id, environment: config.environment,
        public_token: token, amount, currency: "EUR", pack_id: body.pack_id, pack_name: pack?.nombre || "Importe personalizado", purchase_payload: payload, create_payload: createPayload }).select("*").single();
      if (insert.error && insert.error.code !== "23505") throw insert.error;
      const saved = insert.data ? insert : await admin.from(PAYPAL_TABLE).select("*").eq("id", id).single();
      if (saved.error) throw saved.error;
      attempt = saved.data;
    }
    if (attempt.worker_id !== worker.id || attempt.cliente_id !== client.id || attempt.pack_id !== body.pack_id || Number(attempt.amount) !== amount || attempt.environment !== config.environment) throw new PayPalError("La operación pertenece a otro cobro. No se ha creado un pago nuevo.", 409);
    if (!attempt.order_id) {
      // PayPal retains request IDs for six hours. Never create again after that window.
      if (Date.now() - Date.parse(attempt.created_at) > 5 * 60 * 60 * 1000) throw new PayPalError("Creación interrumpida antigua. Administración debe revisar PayPal antes de generar otro cobro.", 409);
      const order = await paypalRequest("/v2/checkout/orders", attempt.create_payload, `create-${id}`);
      if (!/^[A-Z0-9]+$/.test(order.id || "")) throw new PayPalError("PayPal devolvió una referencia inválida.");
      const url = approvalUrl(order);
      const saved = await admin.from(PAYPAL_TABLE).update({ order_id: order.id, approval_url: url, remote_status: order.status }).eq("id", id).is("order_id", null);
      if (saved.error) throw saved.error;
      const current = await admin.from(PAYPAL_TABLE).select("*").eq("id", id).single();
      if (current.error) throw current.error;
      attempt = current.data;
    }
    return NextResponse.json({ ok: true, attempt_id: attempt.id, url: attempt.approval_url, payment_id: attempt.order_id,
      amount: Number(attempt.amount), currency: attempt.currency, status: attempt.status, remote_status: attempt.remote_status,
      pack: pack ? publicPack(pack) : null, manual: !pack }, { headers });
  } catch (error) { return fail(error); }
}
