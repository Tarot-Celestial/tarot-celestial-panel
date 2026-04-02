import { NextResponse } from 'next/server';
import { getAdminClient, normalizeMonthKey, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const admin = getAdminClient();

    const { data, error } = await admin
      .from('incidents')
      .select('id, worker_id, month_key, amount, reason, kind, status, meta, evidence_note, decided_at, created_at')
      .eq('worker_id', me.id)
      .eq('month_key', month)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ ok: true, incidents: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
