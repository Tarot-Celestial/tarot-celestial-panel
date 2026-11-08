import { createHmac } from 'node:crypto';
import { requireStaffChatThread, requireStaffChatUuid, loadStaffChatPresence, staffChatError, type StaffChatActor } from './staff-chat';
import type { supabaseAdmin } from '@/lib/supabase-admin';
import type { StaffPanelCall } from '@/lib/staff-panel-calls';

type Database = ReturnType<typeof supabaseAdmin>;
export const CALL_COLUMNS = 'id,thread_id,caller_worker_id,callee_worker_id,caller_name,callee_name,caller_tab_id,callee_tab_id,status,created_at,accepted_at,ended_at,expires_at,offer_sdp,answer_sdp,caller_seen_at,callee_seen_at';

export function staffCallIceConfig(workerId: string) {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const urls = (process.env.STAFF_CALL_TURN_URLS || '').split(',').map(s => s.trim()).filter(s => /^turns?:[^\s]+$/.test(s));
  const secret = process.env.STAFF_CALL_TURN_SECRET;
  const relayConfigured = !!(urls.length && secret);
  if (relayConfigured) {
    // TURN REST credentials expire shortly; the shared server secret never leaves this process.
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${workerId}`;
    iceServers.push({ urls, username, credential: createHmac('sha1', secret!).update(username).digest('base64') });
  }
  return { iceServers, relayConfigured };
}

export function publicPanelCall(row: any, now = Date.now()): StaffPanelCall {
  const expired = ['ringing', 'accepted'].includes(row.status) && Date.parse(row.expires_at) <= now;
  return {
    id: String(row.id), thread_id: String(row.thread_id), caller_worker_id: String(row.caller_worker_id), callee_worker_id: String(row.callee_worker_id),
    caller_name: String(row.caller_name), callee_name: String(row.callee_name), caller_tab_id: String(row.caller_tab_id), callee_tab_id: row.callee_tab_id ? String(row.callee_tab_id) : null,
    status: expired ? 'missed' : row.status, created_at: String(row.created_at), accepted_at: row.accepted_at, ended_at: expired ? row.expires_at : row.ended_at, expires_at: String(row.expires_at),
    offer_sdp: expired ? null : row.offer_sdp, answer_sdp: expired ? null : row.answer_sdp,
  };
}

export async function staffCallTarget(db: Database, me: StaffChatActor, threadId: string, targetId: string) {
  requireStaffChatUuid(targetId, 'CONTACT');
  const thread = await requireStaffChatThread(db, me, threadId);
  if (targetId === me.id || ![thread.central_worker_id, thread.tarotist_worker_id].includes(targetId)) throw new Error('FORBIDDEN');
  const { data: target, error } = await db.from('workers').select('id,display_name,role,is_active').eq('id', targetId).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!target || !['central', 'admin', 'tarotista'].includes(target.role)) throw new Error('CONTACT_NOT_FOUND');
  const presence = await loadStaffChatPresence(db, [targetId]);
  if (!presence.states.get(targetId)?.presence_expires_at) throw new Error('CALL_OFFLINE');
  return target;
}

export function validatePanelCallInput(body: any, actor: StaffChatActor) {
  if (String(body?.expected_actor_id || '') !== actor.id) throw new Error('IDENTITY_CHANGED');
  const action = String(body?.action || '');
  if (!['start', 'answer', 'reject', 'end', 'heartbeat'].includes(action)) throw new Error('INVALID_CALL_ACTION');
  const callId = requireStaffChatUuid(String(body.call_id || ''), 'MESSAGE');
  const tabId = requireStaffChatUuid(String(body.tab_id || ''), 'CONTACT');
  const sdp = body.sdp == null ? null : String(body.sdp);
  if (['start', 'answer'].includes(action) && (!sdp || sdp.length > 48000 || !sdp.startsWith('v=0') || !/^m=audio /m.test(sdp) || /^m=video /m.test(sdp))) throw new Error('INVALID_CALL_SDP');
  return { action, callId, tabId, sdp };
}

export function staffPanelCallError(error: unknown) {
  const raw = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/^(CALL_BUSY|CALL_OFFLINE|CALL_EXPIRED|CALL_ALREADY_ANSWERED|CALL_ID_CONFLICT)$/.test(raw)) return { code: raw, status: 409 };
  if (raw === 'CALL_NOT_FOUND') return { code: raw, status: 404 };
  if (raw === 'IDENTITY_CHANGED') return { code: raw, status: 409 };
  return staffChatError(error);
}
