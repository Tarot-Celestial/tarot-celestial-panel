import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { amiCommand } from '@/lib/server/asterisk-ami';
import { confirmedCallStart } from '@/lib/attendance/panel-session';

export type AttendanceWorker = { id: string; role: string; display_name: string | null; is_active: boolean | null };
type CallEvidence = { startedAt: string | null; available: boolean };
const callEvidenceCache = new Map<string, { until: number; result: Promise<CallEvidence> }>();
export async function verifiedAttendanceWorker(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!token) return { ok: false as const, status: 401, error: 'NO_AUTH' };
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) return { ok: false as const, status: 401, error: 'NO_AUTH' };
  const result = await db.from('workers').select('id,role,display_name,is_active').eq('user_id', auth.data.user.id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.is_active === false || !['admin','central','tarotista'].includes(result.data.role)) {
    return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  }
  return { ok: true as const, db, worker: result.data as AttendanceWorker, uid: auth.data.user.id };
}

export async function confirmedWorkerCall(db: SupabaseClient, workerId: string) {
  if (!process.env.ASTERISK_AMI_HOST || !process.env.ASTERISK_AMI_SECRET) return { startedAt: null, available: false };
  const cached = callEvidenceCache.get(workerId);
  if (cached && cached.until > Date.now()) return cached.result;
  // Coalesce concurrent tabs; proof is cached for only five seconds and only
  // after the caller has authenticated and resolved its own worker.
  const entry = { until: Infinity, result: Promise.resolve<CallEvidence>({ startedAt: null, available: false }) };
  entry.result = (async (): Promise<CallEvidence> => {
    try {
      const extensions = await db.from('pbx_extensions').select('extension').eq('worker_id', workerId).eq('is_active', true);
      if (extensions.error || !extensions.data?.length) return { startedAt: null, available: false };
      // Do not use pbx_extensions.status/active_call_count: older browser endpoints
      // can write those fields. Only an authenticated, current AMI read is proof.
      const snapshot = await amiCommand('core show channels concise');
      if (!snapshot.ok || /Response:\s*Error|Authentication failed|Unable to connect/i.test(snapshot.raw)) return { startedAt: null, available: false };
      return { startedAt: confirmedCallStart(snapshot.raw, extensions.data.map(row => String(row.extension)), Date.now()), available: true };
    } catch {
      // Call evidence being unavailable must not prematurely close a session.
      // The normal deadline and the user's manual keep-connected action remain.
      return { startedAt: null, available: false };
    } finally { entry.until = Date.now()+5000; }
  })();
  callEvidenceCache.set(workerId, entry);
  return entry.result;
}

export async function panelAttendanceEvent(db: SupabaseClient, worker: AttendanceWorker, action: string, body: Record<string, any> = {}) {
  const sessionId = typeof body.session_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.session_id) ? body.session_id : null;
  const inputActivity = Date.parse(String(body.activity_at || ''));
  const activityAt = Number.isFinite(inputActivity) ? new Date(inputActivity).toISOString() : null;
  let call: { startedAt: string | null; available: boolean | null } = { startedAt: null, available: null };
  if (['heartbeat','status'].includes(action) && (!activityAt || Date.now()-inputActivity > 60_000)) {
    const current = await db.from('attendance_panel_sessions').select('id,expires_at,consultation_until').eq('worker_id', worker.id).is('ended_at', null).maybeSingle();
    if (current.error) throw current.error;
    // AMI is queried only near expiry and never for every interaction or normal
    // poll. An old tab cannot prolong a newer session through this path.
    const manualConsultation = worker.role === 'tarotista' && current.data?.consultation_until && Date.parse(current.data.consultation_until) > Date.now();
    if (current.data && !manualConsultation && Date.parse(current.data.expires_at)-Date.now() <= 90_000 && (action==='status' || current.data.id===sessionId)) {
      call = await confirmedWorkerCall(db, worker.id);
    }
  }
  const { data, error } = await db.rpc('tc_panel_attendance_event', {
    p_worker_id: worker.id, p_action: action, p_session_id: sessionId,
    p_activity_at: action === 'heartbeat' ? activityAt : null, p_call_started_at: call.startedAt,
  });
  if (error) throw error;
  return { ...data, worker, call_protection_available: call.available };
}

/** Call only after authenticating the caller and resolving its own worker. */
export async function requireActivePanelSession(db: SupabaseClient, worker: { id: string; role: string; display_name?: string | null; is_active?: boolean | null }) {
  if (!['admin','central','tarotista'].includes(worker.role)) return { ok: true as const };
  const state = await panelAttendanceEvent(db, { ...worker, display_name: worker.display_name || null, is_active: worker.is_active ?? true }, 'status');
  if (!state.ok || !state.session_id || state.status !== 'working') return { ok: false as const, status: 423, error: 'PANEL_CONNECTION_REQUIRED' };
  return { ok: true as const };
}
