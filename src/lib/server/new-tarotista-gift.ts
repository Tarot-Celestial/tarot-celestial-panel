import { NextResponse } from "next/server";
import { requireActivePanelSession } from "@/lib/server/panel-attendance";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const POLICY = "new_tarotista_once_v1";
const MESSAGES: Record<string, string> = {
  RANK_CHANGED: "El rango o los minutos han cambiado. Revisa el regalo actualizado.",
  ALREADY_USED: "Este cliente ya utilizó el regalo para conocer a esta tarotista.",
  GIFT_NOT_AVAILABLE: "Esta tarotista no tiene un regalo de bienvenida disponible.",
  TAROTISTA_INACTIVE: "Esta tarotista ya no está disponible para el regalo.",
  RANK_NOT_ELIGIBLE: "Este regalo está disponible desde el rango Plata.",
  PAYMENT_OPERATION_CONFLICT: "Esta operación ya se utilizó con otros datos. Actualiza el registro.",
  INVALID_RANK_FREE_REQUEST: "Revisa los datos del regalo de bienvenida.",
  CLIENTE_NO_ENCONTRADO: "No encontramos la ficha del cliente.",
  FORBIDDEN: "No tienes permiso para registrar esta consulta.",
};
export async function newTarotistaGiftPreview(db: any, clientId: string) {
  const { data, error } = await db.rpc("tc_new_tarotista_gift_preview", { p_cliente_id: clientId });
  if (error || !data) return {
    effective_rank: null, minutes: 0, policy_key: POLICY, offers: [],
    reason: error?.code === "PGRST202" || error?.code === "42883" ? "POLICY_NOT_CONFIGURED" : "UNAVAILABLE",
  };
  return data;
}

type GiftWorker = { id: string; user_id: string; role: string; is_active?: boolean | null; display_name?: string | null };
export async function handleNewTarotistaGiftCall(db: any, worker: GiftWorker, body: any) {
  // The caller has already verified the bearer using auth.getUser.
  if (!["central", "admin"].includes(worker.role) || worker.is_active === false) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403, headers: HEADERS });
  }
  const connected = await requireActivePanelSession(db, worker);
  if (!connected.ok) return NextResponse.json({ ok: false, error: connected.error }, { status: connected.status, headers: HEADERS });
  const clientId = typeof body?.cliente_id === "string" ? body.cliente_id.trim() : "";
  const tarotistaId = typeof body?.tarotista_worker_id === "string" ? body.tarotista_worker_id.trim() : "";
  const operationId = typeof body?.operation_id === "string" ? body.operation_id.trim() : "";
  const expectedRank = body?.rank_free_expected_rank;
  const expectedMinutes = body?.rank_free_expected_minutes;
  if (![clientId, tarotistaId, operationId].every(x => UUID.test(x))
      || body.rank_free_eligibility_key !== tarotistaId
      || !["plata", "oro", "diamante"].includes(expectedRank)
      || !Number.isInteger(expectedMinutes) || expectedMinutes < 1 || expectedMinutes > 60
      || body.cliente_compra_minutos || body.usa_7_free || body.captado || body.recuperado
      || Number(body.importe || 0) !== 0
      || body.tarotista_manual_call || body.collaborator_source || body.existing_payment_id
      || body.paypal_collection_order_id || body.paypal_collection_source
      || (body.clasificacion && body.clasificacion !== "nada")) {
    return NextResponse.json({ ok: false, error: "INVALID_RANK_FREE_REQUEST", message: MESSAGES.INVALID_RANK_FREE_REQUEST }, { status: 400, headers: HEADERS });
  }
  // No browser balances, minute deltas, identity, classification or rewards enter the RPC.
  const { data, error } = await db.rpc("tc_register_new_tarotista_gift", {
    p_user: worker.user_id,
    p_payload: {
      operation_id: operationId, cliente_id: clientId, tarotista_worker_id: tarotistaId,
      rank_free_expected_rank: expectedRank, rank_free_expected_minutes: expectedMinutes,
      rank_free_eligibility_key: tarotistaId,
    },
  });
  if (error) {
    const code = Object.keys(MESSAGES).find(key => String(error.message || "").includes(key));
    if (!code) return NextResponse.json({ ok: false, error: "RANK_FREE_REGISTER_FAILED", message: "No se pudo confirmar el registro. Reintenta la misma operación." }, { status: 503, headers: HEADERS });
    const [preview, balance] = await Promise.all([
      newTarotistaGiftPreview(db, clientId),
      db.from("crm_clientes").select("minutos_free_pendientes,minutos_normales_pendientes").eq("id", clientId).maybeSingle(),
    ]);
    return NextResponse.json({ ok: false, error: code, message: MESSAGES[code], rank_free: preview, balance: balance.error ? null : balance.data },
      { status: code === "FORBIDDEN" ? 403 : code === "CLIENTE_NO_ENCONTRADO" ? 404 : 409, headers: HEADERS });
  }
  if (!data?.rendimiento?.id || !data?.rank_free) return NextResponse.json({
    ok: false, error: "RANK_FREE_REGISTER_FAILED", message: "No se pudo confirmar el resultado. Reintenta la misma operación.",
  }, { status: 503, headers: HEADERS });
  // Return directly: a rank gift is never classified as an initial 7FREE capture.
  return NextResponse.json({ ...data, ok: true, message: "Consulta de bienvenida registrada con sus minutos FREE." }, { headers: HEADERS });
}
