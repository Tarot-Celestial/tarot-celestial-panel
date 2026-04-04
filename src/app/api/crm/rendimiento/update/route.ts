import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

const ALLOWED_FIELDS = [
  'cliente_nombre',
  'tiempo',
  'resumen_codigo',
  'forma_pago',
  'importe',
  'llamada_call',
  'promo',
  'captado',
  'recuperado',
] as const;

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const rawUpdates = body?.updates && typeof body.updates === 'object' ? body.updates : {};
    if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

    const updates: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      if (key in rawUpdates) updates[key] = rawUpdates[key];
    }

    const admin = getAdminClient();
    const { error } = await admin
      .from('rendimiento_llamadas')
      .update(updates)
      .eq('id', id)
      .select('id')
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
