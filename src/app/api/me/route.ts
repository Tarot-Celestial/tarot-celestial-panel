import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getWorkerByUserIdCached } from "@/lib/server/worker-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
class AccessError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

async function accessFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(10000) });
}

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return {
    uid: null as string | null,
    email: null as string | null,
    avatarUrl: null as string | null,
  };

  const userClient = createClient(url, anon, {
    global: { fetch: accessFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Authorize the verified user, never decoded JWT claims or local role caches.
  const { data, error } = await userClient.auth.getUser(token);
  if (error) {
    if (["bad_jwt", "session_not_found", "refresh_token_not_found", "user_not_found"].includes(String(error.code)) || [401, 403].includes(error.status || 0)) {
      throw new AccessError("INVALID_SESSION", 401);
    }
    throw new AccessError("ACCESS_SERVICE_UNAVAILABLE", 503);
  }
  if (!data.user) throw new AccessError("INVALID_SESSION", 401);
  const metadata = data.user?.user_metadata || {};
  const avatarUrl = metadata.avatar_url || metadata.picture || metadata.photo_url || null;

  return {
    uid: data.user?.id || null,
    email: data.user?.email || null,
    avatarUrl: avatarUrl ? String(avatarUrl) : null,
  };
}

export async function GET(req: Request) {
  try {
    const { uid, email, avatarUrl } = await uidFromBearer(req);
    if (!uid) {
      return json({ ok: false, error: "NO_AUTH" }, 401);
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { global: { fetch: accessFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

    const worker = await getWorkerByUserIdCached(admin, uid, "id, display_name, role, team, email, user_id, is_active");
    if (!worker?.id) {
      return json({ ok: false, error: "NO_WORKER" }, 403);
    }
    if (worker.is_active === false) {
      return json({ ok: false, error: "WORKER_DISABLED" }, 403);
    }
    if (!["admin", "central", "tarotista"].includes(String(worker.role || '').toLowerCase())) return json({ ok: false, error: "INVALID_ROLE" }, 403);

    return json({
      ok: true,
      id: worker.id,
      role: worker.role || "",
      display_name: worker.display_name || "Usuario",
      team: worker.team || "",
      email: worker.email || email || "",
      avatar_url: avatarUrl,
      month_key: monthKeyNow(),
      worker,
      user: { id: uid, email: email || worker.email || "" },
    });
  } catch (e: unknown) {
    return json({ ok: false, error: e instanceof AccessError ? e.code : "ACCESS_SERVICE_UNAVAILABLE" }, e instanceof AccessError ? e.status : 503);
  }
}
