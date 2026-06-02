import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

function isDate(value: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limitParam = Number(url.searchParams.get('limit') || 0);
    const limit = Math.min(Math.max(limitParam || 2000, 1), 10000);

    const admin = getAdminClient();
    let query = admin
      .from('rendimiento_llamadas')
      .select('*')
      .order('fecha_hora', { ascending: false })
      .limit(limit);

    if (isDate(from)) query = query.gte('fecha', from);
    if (isDate(to)) query = query.lte('fecha', to);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      data: data || [],
      filters: {
        from: isDate(from) ? from : null,
        to: isDate(to) ? to : null,
        limit,
      },
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
