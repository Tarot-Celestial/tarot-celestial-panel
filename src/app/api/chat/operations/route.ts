import { NextResponse } from 'next/server';
import { getStaffChatActor, requireStaffChatConnection, requireStaffChatThread } from '@/lib/server/staff-chat';
import { staffOperationError, staffOperationsOverview } from '@/lib/server/staff-chat-operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    return NextResponse.json({ ok: true, ...await staffOperationsOverview(db, me, new URL(req.url).searchParams.get('thread_id') || '') }, { headers });
  } catch (error) { const { code, status } = staffOperationError(error); return NextResponse.json({ ok: false, error: code }, { status, headers }); }
}

export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const body = await req.json().catch(() => ({}));
    if (body.expected_worker_id !== me.id) throw new Error('FORBIDDEN');
    if (!uuid.test(String(body.operation_id || ''))) throw new Error('INVALID_OPERATION_ID');
    const action = String(body.action || '');
    if (!['bathroom','request_lunch','request_break','approve_break','reject_break','return','cancel_pause','appeal','resolve_appeal'].includes(action)) throw new Error('INVALID_ACTION');
    await requireStaffChatThread(db, me, String(body.thread_id || ''));
    // Returning/cancelling remains possible after an attendance timeout. It never starts a workday.
    if (!['return','cancel_pause'].includes(action)) await requireStaffChatConnection(db, me);
    if (body.target_id != null && !uuid.test(String(body.target_id))) throw new Error('INVALID_TARGET_ID');
    if (body.revision != null && (!Number.isSafeInteger(body.revision) || body.revision < 0)) throw new Error('INVALID_REVISION');
    const reason = String(body.reason || '').trim();
    if (reason.length > 500 || (['appeal','resolve_appeal'].includes(action) && reason.length < 3)) throw new Error('INVALID_REASON');
    const result = await db.rpc('staff_chat_operation', {
      p_actor: me.id, p_thread: body.thread_id, p_action: action, p_operation_id: body.operation_id,
      p_target: body.target_id || null, p_reason: reason, p_revision: body.revision ?? null,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, result: result.data }, { headers });
  } catch (error) { const { code, status } = staffOperationError(error); return NextResponse.json({ ok: false, error: code }, { status, headers }); }
}
