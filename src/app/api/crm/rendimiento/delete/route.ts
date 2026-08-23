import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

    const admin = getAdminClient();
    let ownership = admin.from('rendimiento_llamadas').select('id').eq('id', id);
    if (String(me.role) === 'central') ownership = ownership.eq('telefonista_worker_id', String(me.id));
    const owned = await ownership.maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ ok: false, error: 'FORBIDDEN_RECORD' }, { status: 403 });

    const { data, error } = await admin.rpc('crm_cancel_call_payment_atomic', {
      p_rendimiento_id: id,
      p_cancelled_by_user_id: me.user_id || me.resolved_uid || null,
      p_reason: 'Anulado desde Rendimiento',
    });

    if (error) {
      console.error('[Rendimiento delete] fallo anulando operación vinculada', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        rendimiento_id: id,
      });
      return NextResponse.json({ ok: false, error: 'CANCEL_OPERATION_FAILED' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, result: data || null });
  } catch (e: any) {
    console.error('[Rendimiento delete] error general', e);
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
