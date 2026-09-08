import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export type StaffChatActor = {
  id: string;
  role: "central" | "tarotista" | "admin";
  display_name: string;
  team: string | null;
  state: string;
};

export async function getStaffChatActor(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) throw new Error("NO_AUTH");

  const db = supabaseAdmin();
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

export async function requireStaffChatThread(db: ReturnType<typeof supabaseAdmin>, me: StaffChatActor, threadId: string) {
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
  const code = error instanceof Error ? error.message : "CHAT_ERROR";
  const status = code === "NO_AUTH" ? 401 : code === "NO_WORKER" || code === "FORBIDDEN" ? 403 : code === "THREAD_NOT_FOUND" ? 404 : code.startsWith("INVALID_") || code.startsWith("MISSING_") || code === "EMPTY_BODY" ? 400 : 500;
  return { code, status };
}
