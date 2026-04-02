import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const date = (searchParams.get('date') || todayISO()).slice(0, 10);
    const admin = getAdminClient();

    const { data: batch, error } = await admin
      .from('outbound_batches')
      .select(`
        id, batch_date, note, status, created_at,
        sender:workers!outbound_batches_created_by_worker_id_fkey (id, display_name, role, team),
        outbound_batch_items (
          id, customer_name, phone, priority, position,
          current_status, last_call_at, last_note,
          last_called_by:workers!outbound_batch_items_last_called_by_worker_id_fkey (id, display_name)
        )
      `)
      .eq('batch_date', date)
      .eq('created_by_worker_id', me.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const normalized = batch
      ? {
          ...batch,
          outbound_batch_items: (batch.outbound_batch_items ?? [])
            .slice()
            .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
        }
      : null;

    return NextResponse.json({ ok: true, date, batch: normalized });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
