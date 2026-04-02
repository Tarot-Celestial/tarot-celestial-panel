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

    const { data: invoice, error: invErr } = await admin
      .from('invoices')
      .select('id, worker_id, month_key, status, total, notes, updated_at, created_at, worker_ack, worker_ack_at, worker_ack_note')
      .eq('worker_id', me.id)
      .eq('month_key', month)
      .maybeSingle();
    if (invErr) throw invErr;

    if (!invoice) {
      return NextResponse.json({ ok: true, invoice: null, lines: [] });
    }

    const { data: lines, error: linesErr } = await admin
      .from('invoice_lines')
      .select('id, invoice_id, kind, label, amount, meta, created_at')
      .eq('invoice_id', invoice.id)
      .order('created_at', { ascending: true });
    if (linesErr) throw linesErr;

    return NextResponse.json({ ok: true, invoice, lines: lines || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
