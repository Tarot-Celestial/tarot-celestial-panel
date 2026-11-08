import { NextResponse } from 'next/server';
import { getStaffChatActor, requireStaffChatConnection, requireStaffChatUuid } from '@/lib/server/staff-chat';
import { CALL_COLUMNS, publicPanelCall, staffCallIceConfig, staffCallTarget, staffPanelCallError, validatePanelCallInput } from '@/lib/server/staff-panel-calls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export async function GET(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    await requireStaffChatConnection(db, me);
    const url = new URL(req.url), callId = url.searchParams.get('call_id');
    if (url.searchParams.get('config') === '1') return NextResponse.json({ ok: true, ...staffCallIceConfig(me.id), server_now: new Date().toISOString() }, { headers });
    let query = db.from('staff_panel_calls').select(CALL_COLUMNS).or(`caller_worker_id.eq.${me.id},callee_worker_id.eq.${me.id}`);
    if (callId) query = query.eq('id', requireStaffChatUuid(callId, 'MESSAGE'));
    else query = query.in('status', ['ringing', 'accepted']).gt('expires_at', new Date().toISOString());
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, call: data ? publicPanelCall(data) : null, server_now: new Date().toISOString() }, { headers });
  } catch (error) {
    const { code, status } = staffPanelCallError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers });
  }
}

export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const body = await req.json().catch(() => ({}));
    const { action, callId, tabId, sdp } = validatePanelCallInput(body, me);
    // Ending a call must release resources even after attendance expires.
    if (action !== 'end' && action !== 'reject') await requireStaffChatConnection(db, me);
    let targetId: string | null = null, threadId: string | null = null;
    if (action === 'start') {
      targetId = String(body.target_worker_id || ''); threadId = String(body.thread_id || '');
      await staffCallTarget(db, me, threadId, targetId);
    }
    const { data, error } = await db.rpc('staff_panel_call_action', {
      p_actor_id: me.id, p_call_id: callId, p_action: action, p_tab_id: tabId,
      p_thread_id: threadId, p_target_id: targetId, p_sdp: sdp,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, call: publicPanelCall(data), server_now: new Date().toISOString() }, { headers });
  } catch (error) {
    const { code, status } = staffPanelCallError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers });
  }
}
