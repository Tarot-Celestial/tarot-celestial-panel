import { NextResponse } from 'next/server';
import { requireActivePanelSession } from '@/lib/server/panel-attendance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const POLICY = 'initial_consultation_once_v1';
const MESSAGES: Record<string, string> = {
  ALREADY_USED: 'Este cliente ya utilizó su primera consulta de 7 minutos.',
  PREVIOUS_CONSULTATION: 'Este cliente ya tiene una consulta anterior registrada.',
  TAROTISTA_INACTIVE: 'La tarotista seleccionada ya no está disponible.',
  INVALID_INITIAL_FREE_REQUEST: 'Revisa los datos de la primera consulta.',
  PAYMENT_OPERATION_CONFLICT: 'Esta operación ya se utilizó con otros datos. Actualiza el registro.',
  CLIENTE_NO_ENCONTRADO: 'No encontramos la ficha del cliente.',
  FORBIDDEN: 'No tienes permiso para registrar esta consulta.',
};

export async function initialConsultationGiftPreview(db: any, clientId: string) {
  const { data, error } = await db.rpc('tc_initial_consultation_gift_preview', { p_cliente_id: clientId });
  if (error || !data) return { policy_key: POLICY, eligible: false, minutes: 7,
    reason: error?.code === 'PGRST202' || error?.code === '42883' ? 'POLICY_NOT_CONFIGURED' : 'UNAVAILABLE' };
  return data;
}

type GiftWorker = { id: string; user_id: string; role: string; is_active?: boolean | null; display_name?: string | null };
export async function handleInitialConsultationGiftCall(db: any, worker: GiftWorker, body: any) {
  // The route verifies the bearer with getUser before resolving this actor.
  if (!['central', 'admin'].includes(worker.role) || worker.is_active !== true) {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403, headers: HEADERS });
  }
  const connected = await requireActivePanelSession(db, worker);
  if (!connected.ok) return NextResponse.json({ ok: false, error: connected.error }, { status: connected.status, headers: HEADERS });
  const clientId = typeof body?.cliente_id === 'string' ? body.cliente_id.trim() : '';
  const tarotistaId = typeof body?.tarotista_worker_id === 'string' ? body.tarotista_worker_id.trim() : '';
  const operationId = typeof body?.operation_id === 'string' ? body.operation_id.trim() : '';
  if (![clientId, tarotistaId, operationId].every(value => UUID.test(value))
    || body.cliente_compra_minutos || body.usa_7_free || body.captado || body.recuperado
    || Number(body.importe || 0) !== 0 || body.tarotista_manual_call || body.collaborator_source
    || body.existing_payment_id || body.paypal_collection_order_id || body.paypal_collection_source
    || (body.clasificacion && body.clasificacion !== 'nada')) {
    return NextResponse.json({ ok: false, error: 'INVALID_INITIAL_FREE_REQUEST', message: MESSAGES.INVALID_INITIAL_FREE_REQUEST }, { status: 400, headers: HEADERS });
  }
  const { data, error } = await db.rpc('tc_register_initial_consultation_gift', {
    p_user: worker.user_id,
    p_payload: { operation_id: operationId, cliente_id: clientId, tarotista_worker_id: tarotistaId },
  });
  if (error) {
    const code = Object.keys(MESSAGES).find(key => String(error.message || '').includes(key));
    if (!code) return NextResponse.json({ ok: false, error: 'INITIAL_FREE_REGISTER_FAILED', message: 'No se pudo confirmar el registro. Reintenta la misma operación.' }, { status: 503, headers: HEADERS });
    const [preview, balance] = await Promise.all([
      initialConsultationGiftPreview(db, clientId),
      db.from('crm_clientes').select('minutos_free_pendientes,minutos_normales_pendientes').eq('id', clientId).maybeSingle(),
    ]);
    return NextResponse.json({ ok: false, error: code, message: MESSAGES[code], initial_free: preview, balance: balance.error ? null : balance.data },
      { status: code === 'FORBIDDEN' ? 403 : code === 'CLIENTE_NO_ENCONTRADO' ? 404 : 409, headers: HEADERS });
  }
  if (!data?.rendimiento?.id || data?.initial_free?.policy_key !== POLICY || data.initial_free.minutes !== 7) {
    return NextResponse.json({ ok: false, error: 'INITIAL_FREE_REGISTER_FAILED', message: 'No se pudo confirmar el resultado. Reintenta la misma operación.' }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json({ ...data, ok: true, message: 'Primera consulta registrada con sus 7 minutos FREE.' }, { headers: HEADERS });
}
