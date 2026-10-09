import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assistantDb, checked, clientQuery, type AssistantContext } from '@/lib/server/central-assistant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function POST(req: Request) {
  const expected = process.env.CENTRAL_ASSISTANT_CRON_SECRET || '', provided = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const db = assistantDb(); const tasks = await checked(db.rpc('central_assistant_claim_tasks')); let completed = 0, failed = 0;
    for (const task of tasks) {
      try {
        const worker = await checked(db.from('workers').select('id,user_id,role,display_name,is_active').eq('id', task.worker_id).maybeSingle());
        if (!worker || worker.is_active === false || !['central', 'admin'].includes(worker.role)) throw new Error('Trabajador inactivo o sin acceso.');
        const ctx: AssistantContext = { db, worker, identityIds: [worker.id] };
        const result = task.kind === 'reminder' ? { text: task.title, cards: [], updatedAt: new Date().toISOString() } : await clientQuery(ctx, { kind: task.kind, days: task.days, page: 1 });
        const saved = await checked(db.rpc('central_assistant_finish_task', { p_id: task.id, p_lease: task.lease_token, p_result: result, p_error: null }));
        if (saved) completed++;
      } catch { failed++; await checked(db.rpc('central_assistant_finish_task', { p_id: task.id, p_lease: task.lease_token, p_result: null, p_error: 'No se pudo consultar la fuente o el trabajador perdió acceso.' })); }
    }
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    await Promise.all([
      checked(db.from('central_assistant_messages').delete().lt('created_at', cutoff)),
      checked(db.from('central_assistant_usage').delete().lt('bucket', cutoff)),
      checked(db.from('central_assistant_briefings').delete().lt('delivered_at', cutoff)),
      checked(db.from('central_assistant_alerts').delete().lt('updated_at', cutoff)),
    ]);
    return NextResponse.json({ ok: true, completed, failed });
  } catch { return NextResponse.json({ ok: false, error: 'No se pudo ejecutar el planificador.' }, { status: 503 }); }
}
