import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireActivePanelSession } from "@/lib/server/panel-attendance";

export type StaffChatActor = {
  id: string;
  role: "central" | "tarotista" | "admin";
  display_name: string;
  team: string | null;
  state: string;
};

export type StaffChatPresence = { state: 'online' | 'break' | 'offline'; presence_expires_at: string | null };

export async function loadStaffChatPresence(db: ReturnType<typeof supabaseAdmin>, workerIds: string[]) {
  const ids = [...new Set(workerIds.filter(Boolean))];
  const states = new Map<string, StaffChatPresence>();
  if (!ids.length) return { states, checkedAt: new Date().toISOString() };
  // workers.state belongs to the old heartbeat. Only a currently open panel
  // session proves availability; reading chat never opens or extends one.
  const [sessions, attendance] = await Promise.all([
    db.from('attendance_panel_sessions').select('worker_id, expires_at').in('worker_id', ids).is('ended_at', null),
    db.from('attendance_state').select('worker_id, status').in('worker_id', ids),
  ]);
  if (sessions.error) throw sessions.error;
  if (attendance.error) throw attendance.error;
  const now = Date.now();
  for (const id of ids) states.set(id, { state: 'offline', presence_expires_at: null });
  for (const row of attendance.data || []) {
    if (row.status === 'break' || row.status === 'bathroom') states.set(String(row.worker_id), { state: 'break', presence_expires_at: null });
  }
  for (const row of sessions.data || []) {
    const expires = Date.parse(row.expires_at);
    if (Number.isFinite(expires) && expires > now) states.set(String(row.worker_id), { state: 'online', presence_expires_at: new Date(expires).toISOString() });
  }
  return { states, checkedAt: new Date(now).toISOString() };
}

export async function getStaffChatActor(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new Error("NO_AUTH");
  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error && (error.name === 'AuthRetryableFetchError' || error.status === 429 || (error.status || 0) >= 500)) throw new Error('CHAT_UNAVAILABLE');
  if (error || !data.user?.id) throw new Error("NO_AUTH");
  const { data: worker, error: workerError } = await db
    .from("workers")
    .select("id, role, display_name, team, state, is_active")
    .or(`user_id.eq.${data.user.id},auth_user_id.eq.${data.user.id}`)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (workerError) throw workerError;
  if (!worker?.id) throw new Error("NO_WORKER");
  if (!["central", "tarotista", "admin"].includes(String(worker.role))) throw new Error("FORBIDDEN");

  return {
    db,
    me: {
      id: String(worker.id),
      role: String(worker.role) as StaffChatActor["role"],
      display_name: String(worker.display_name || (worker.role === "tarotista" ? "Tarotista" : "Central")),
      team: worker.team ? String(worker.team) : null,
      state: String(worker.state || "offline"),
    } satisfies StaffChatActor,
  };
}

export async function requireStaffChatConnection(db: ReturnType<typeof supabaseAdmin>, me: StaffChatActor) {
  const state = await requireActivePanelSession(db, { ...me, is_active: true });
  if (!state.ok) throw new Error(state.error);
}

export function requireStaffChatUuid(value: string, kind: "THREAD" | "MESSAGE" | "CONTACT") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`INVALID_${kind}_ID`);
  }
  return value;
}

export async function requireStaffChatThread(db: ReturnType<typeof supabaseAdmin>, me: StaffChatActor, threadId: string) {
  requireStaffChatUuid(threadId, "THREAD");
  const { data: thread, error } = await db
    .from("chat_threads")
    .select("id, central_worker_id, tarotist_worker_id, status, created_at, last_message_at, last_message_preview, title")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  if (!thread?.id) throw new Error("THREAD_NOT_FOUND");

  const participant = me.role === "admin" || String(thread.central_worker_id || "") === me.id || String(thread.tarotist_worker_id || "") === me.id;
  if (!participant) throw new Error("FORBIDDEN");
  return thread;
}

export function staffChatError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "CHAT_ERROR";
  const code = /^(NO_AUTH|NO_WORKER|FORBIDDEN|CHAT_UNAVAILABLE|THREAD_NOT_FOUND|MESSAGE_NOT_FOUND|CONTACT_NOT_FOUND|MESSAGE_ID_CONFLICT|PANEL_CONNECTION_REQUIRED|EMPTY_BODY|INVALID_[A-Z_]+|MISSING_[A-Z_]+)$/.test(raw) ? raw : "CHAT_ERROR";
  const status = code === "NO_AUTH" ? 401 : code === "CHAT_UNAVAILABLE" ? 503 : code === "PANEL_CONNECTION_REQUIRED" ? 423 : code === "NO_WORKER" || code === "FORBIDDEN" ? 403 : ["THREAD_NOT_FOUND", "MESSAGE_NOT_FOUND", "CONTACT_NOT_FOUND"].includes(code) ? 404 : code === "MESSAGE_ID_CONFLICT" ? 409 : code.startsWith("INVALID_") || code.startsWith("MISSING_") || code === "EMPTY_BODY" ? 400 : 500;
  return { code, status };
}
