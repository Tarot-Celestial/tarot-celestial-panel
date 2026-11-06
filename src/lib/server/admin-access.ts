import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Read fresh permissions for an already verified Auth user. Never pass an email. */
export async function hasAdminAccess(db: SupabaseClient, authUserId: string | null | undefined): Promise<boolean> {
  if (!authUserId) return false;
  const { data, error } = await db.rpc("tc_has_admin_access", { p_user_id: authUserId });
  if (error) throw error;
  return data === true;
}

// Coalesce checks only within the same request. A revoked grant must not remain
// usable in another request because of a process-wide worker or JWT cache.
const requestChecks = new WeakMap<Request, Promise<boolean>>();

/** Guard for legacy routes: validate the signature before any privileged access. */
export function requestHasAdminAccess(req: Request): Promise<boolean> {
  const previous = requestChecks.get(req);
  if (previous) return previous;
  const check = (async () => {
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) return false;
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await db.auth.getUser(token);
    if (error) {
      if ([400, 401, 403].includes(error.status || 0)) return false;
      throw error;
    }
    return hasAdminAccess(db, data.user?.id);
  })();
  requestChecks.set(req, check);
  return check;
}
