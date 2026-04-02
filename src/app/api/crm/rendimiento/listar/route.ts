import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const admin = getAdminClient();
    let query = admin.from('rendimiento_llamadas').select('*').order('fecha_hora', { ascending: false }).limit(500);

    if (String(me.role) === 'central') {
      query = query.eq('telefonista_worker_id', me.id);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      data: data || [],
      viewer: {
        role: me.role || null,
        worker_id: me.id || null,
        mode: String(me.role) === 'central' ? 'central' : 'admin',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
