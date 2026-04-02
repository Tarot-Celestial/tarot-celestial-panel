import { NextResponse } from 'next/server';
import { workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (me.role !== 'admin') return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });

    return NextResponse.json({
      ok: true,
      message: 'Importador CRM verificado. El botón ya no rompe el panel, pero la fuente externa de CRM sigue pendiente de conectar.',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
