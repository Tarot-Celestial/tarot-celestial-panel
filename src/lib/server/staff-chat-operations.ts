import type { SupabaseClient } from '@supabase/supabase-js';
import { requireStaffChatThread, type StaffChatActor } from '@/lib/server/staff-chat';
import { consultationView, type StaffAppeal, type StaffConsultation, type StaffOperationsOverview, type StaffOperationsSummary, type StaffPause } from '@/lib/staff-chat-operations';

const CALL_COLUMNS = 'id,cliente_nombre,tiempo,fecha_hora,created_at,edit_revision,code_blocks,codigo_1,minutos_1,codigo_2,minutos_2,resumen_codigo,tipo_registro,tarotista_worker_id,telefonista_worker_id';
const PAUSE_COLUMNS = 'id,thread_id,worker_id,worker_name,kind,status,created_at,started_at,ended_at,revision';
const APPEAL_COLUMNS = 'id,call_id,worker_id,reason,status,resolution,revision,call_revision,created_at';
type Thread = { id: string; central_worker_id: string | null; tarotist_worker_id: string };

async function latestConsultation(db: SupabaseClient, thread: Thread): Promise<StaffConsultation | null> {
  if (!thread.central_worker_id) return null;
  const { data, error } = await db.from('rendimiento_llamadas').select(CALL_COLUMNS)
    .eq('telefonista_worker_id', thread.central_worker_id).eq('tarotista_worker_id', thread.tarotist_worker_id)
    .gt('tiempo', 0).order('fecha_hora', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const result = await db.from('staff_chat_call_appeals').select(APPEAL_COLUMNS).eq('call_id', data.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return consultationView(data, result.data as StaffAppeal | null);
}

/** The only exposed call fields are the first name and code/minute breakdown. */
export async function enrichStaffOperationMessages<T extends Record<string, any>>(db: SupabaseClient, thread: Thread, rows: T[]) {
  const latest = rows.some(row => row.kind === 'consultation') ? await latestConsultation(db, thread) : null;
  return rows.map(row => ({ ...row, consultation: row.kind === 'consultation' ? latest : undefined }));
}

export async function staffOperationsOverview(db: SupabaseClient, me: StaffChatActor, threadId: string): Promise<StaffOperationsOverview> {
  const thread = await requireStaffChatThread(db, me, threadId);
  const [{ data, error }, latest, appeals] = await Promise.all([
    db.from('staff_chat_pauses').select(PAUSE_COLUMNS).eq('thread_id', threadId).order('created_at', { ascending: false }).limit(15),
    latestConsultation(db, thread as Thread),
    db.from('staff_chat_call_appeals').select(APPEAL_COLUMNS).eq('thread_id', threadId).eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
  ]);
  if (error) throw error;
  if (appeals.error) throw appeals.error;
  const pending = (appeals.data || []).filter(a => a.id !== latest?.appeal?.id) as StaffAppeal[];
  const sources = pending.length && thread.central_worker_id ? await db.from('rendimiento_llamadas').select(CALL_COLUMNS).in('id', pending.map(a => a.call_id)).eq('telefonista_worker_id', thread.central_worker_id).eq('tarotista_worker_id', thread.tarotist_worker_id) : { data: [], error: null };
  if (sources.error) throw sources.error;
  const pendingAppeals = pending.map(appeal => {
    const row = (sources.data || []).find(r => r.id === appeal.call_id);
    return row ? consultationView(row, appeal) : { id: appeal.call_id, first_name: 'Clienta', blocks: [], total: 0, revision: appeal.call_revision, occurred_at: appeal.created_at, deleted: true, appeal };
  });
  return { pauses: (data || []) as StaffPause[], can_manage: me.can_admin === true || (me.role !== 'tarotista' && thread.central_worker_id === me.id), is_tarotist: me.role === 'tarotista' && thread.tarotist_worker_id === me.id, latest_consultation: latest, pending_appeals: pendingAppeals };
}

export async function staffOperationsSummary(db: SupabaseClient, me: StaffChatActor): Promise<StaffOperationsSummary> {
  let threadsQuery = db.from('chat_threads').select('id,central_worker_id,tarotist_worker_id');
  if (!me.can_admin) threadsQuery = me.role === 'tarotista' ? threadsQuery.eq('tarotist_worker_id', me.id) : threadsQuery.eq('central_worker_id', me.id);
  const threads = await threadsQuery;
  if (threads.error) throw threads.error;
  const ids = (threads.data || []).map(row => String(row.id));
  // Operational absence is intentionally separate from attendance/payroll.
  let pausesQuery = db.from('staff_chat_pauses').select(PAUSE_COLUMNS).in('status', ['pending', 'active']).order('created_at', { ascending: false }).limit(200);
  if (me.role === 'tarotista') pausesQuery = pausesQuery.eq('worker_id', me.id);
  const [pauses, appeals] = await Promise.all([
    pausesQuery,
    ids.length ? db.from('staff_chat_call_appeals').select('id,thread_id,worker_name,created_at').eq('status', 'pending').in('thread_id', ids).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ]);
  if (pauses.error) throw pauses.error;
  if (appeals.error) throw appeals.error;
  return {
    pauses: (pauses.data || []).filter(row => row.status === 'active') as StaffPause[],
    pending: me.role === 'tarotista' && !me.can_admin ? [] : [
      ...(pauses.data || []).filter(row => row.status === 'pending' && ids.includes(row.thread_id)).map(row => ({ id: row.id, thread_id: row.thread_id, worker_name: row.worker_name, created_at: row.created_at, kind: 'pause' as const })),
      ...(appeals.data || []).map(row => ({ ...row, kind: 'appeal' as const })),
    ],
  };
}

export function staffOperationError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  const code = /^(NO_AUTH|NO_WORKER|FORBIDDEN|CHAT_UNAVAILABLE|THREAD_NOT_FOUND|CALL_NOT_FOUND|PANEL_CONNECTION_REQUIRED|OPERATION_CONFLICT|PAUSE_ALREADY_OPEN|CALL_CHANGED|APPEAL_ALREADY_OPEN|INVALID_[A-Z_]+)$/.test(raw) ? raw : 'OPERATIONS_UNAVAILABLE';
  const status = code === 'NO_AUTH' ? 401 : ['NO_WORKER', 'FORBIDDEN'].includes(code) ? 403 : ['THREAD_NOT_FOUND','CALL_NOT_FOUND'].includes(code) ? 404 : code === 'PANEL_CONNECTION_REQUIRED' ? 423 : code.startsWith('INVALID_') ? 400 : ['OPERATION_CONFLICT','PAUSE_ALREADY_OPEN','CALL_CHANGED','APPEAL_ALREADY_OPEN'].includes(code) ? 409 : 503;
  return { code, status };
}
