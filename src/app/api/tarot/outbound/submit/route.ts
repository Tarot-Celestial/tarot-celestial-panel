
import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (me.role !== 'tarotista') return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const batch_date = String(body?.batch_date || todayISO()).slice(0, 10);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ ok: false, error: 'ITEMS_REQUIRED' }, { status: 400 });

    const db = getAdminClient();

    const { data: existingBatches, error: existingErr } = await db
      .from('outbound_batches')
      .select('id, batch_date, status, created_at')
      .eq('batch_date', batch_date)
      .eq('created_by_worker_id', me.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (existingErr) throw existingErr;

    let batch = (existingBatches || [])[0] || null;

    if (!batch?.id) {
      const created = await db
        .from('outbound_batches')
        .insert({ batch_date, created_by_worker_id: me.id, status: 'pending' })
        .select('id, batch_date, status, created_at')
        .single();
      if (created.error) throw created.error;
      batch = created.data;
    } else if ((existingBatches || []).length > 1) {
      const oldIds = (existingBatches || []).slice(1).map((x: any) => x.id).filter(Boolean);
      if (oldIds.length) {
        await db.from('outbound_batch_items').delete().in('batch_id', oldIds);
        await db.from('outbound_batches').delete().in('id', oldIds);
      }
    }

    const payload = items
      .map((item: any, idx: number) => ({
        batch_id: batch.id,
        customer_name: String(item?.customer_name || item?.name || '').trim(),
        phone: item?.phone ? String(item.phone).trim() : null,
        priority: Number(item?.priority || 0),
        position: Number(item?.position || idx + 1),
        current_status: 'pending',
      }))
      .filter((x: any) => x.customer_name);

    if (!payload.length) return NextResponse.json({ ok: false, error: 'VALID_ITEMS_REQUIRED' }, { status: 400 });

    const { error: delErr } = await db.from('outbound_batch_items').delete().eq('batch_id', batch.id);
    if (delErr) throw delErr;

    const { error: itemsErr } = await db.from('outbound_batch_items').insert(payload);
    if (itemsErr) throw itemsErr;

    return NextResponse.json({ ok: true, batch, replaced: true, inserted: payload.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
