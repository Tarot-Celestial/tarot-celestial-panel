import { type SupabaseClient } from "@supabase/supabase-js";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type WorkerCacheGlobal = {
  byUserId: Map<string, CacheEntry<any | null>>;
  byEmail: Map<string, CacheEntry<any | null>>;
  workersList: CacheEntry<any[]> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __tcWorkerCache: WorkerCacheGlobal | undefined;
}

const DEFAULT_TTL_MS = 60_000;
const LIST_TTL_MS = 30_000;

function cache(): WorkerCacheGlobal {
  if (!globalThis.__tcWorkerCache) {
    globalThis.__tcWorkerCache = {
      byUserId: new Map(),
      byEmail: new Map(),
      workersList: null,
    };
  }
  return globalThis.__tcWorkerCache;
}

function getCached<T>(entry: CacheEntry<T> | undefined | null): T | undefined {
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) return undefined;
  return entry.value;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs = DEFAULT_TTL_MS) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearWorkerCache() {
  const c = cache();
  c.byUserId.clear();
  c.byEmail.clear();
  c.workersList = null;
}

export async function getWorkerByUserIdCached(admin: SupabaseClient, uid: string, select = "id, user_id, role, display_name, email, team") {
  const c = cache();
  const key = `${uid}|${select}`;
  const cached = getCached(c.byUserId.get(key));
  if (cached !== undefined) return cached;

  const { data, error } = await admin.from("workers").select(select).eq("user_id", uid).maybeSingle();
  if (error) throw error;
  setCached(c.byUserId, key, data || null);
  return data || null;
}

export async function getWorkerByEmailCached(admin: SupabaseClient, email: string, select = "id, user_id, role, display_name, email, team") {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) return null;
  const c = cache();
  const key = `${clean}|${select}`;
  const cached = getCached(c.byEmail.get(key));
  if (cached !== undefined) return cached;

  const { data, error } = await admin.from("workers").select(select).eq("email", clean).maybeSingle();
  if (error) throw error;
  setCached(c.byEmail, key, data || null);
  return data || null;
}

export async function getWorkerByUserOrEmailCached(admin: SupabaseClient, uid: string, email?: string | null, select = "id, user_id, role, display_name, email, team") {
  const byUser = uid ? await getWorkerByUserIdCached(admin, uid, select) : null;
  if (byUser) return byUser;
  return email ? await getWorkerByEmailCached(admin, email, select) : null;
}

export async function getWorkersListCached(admin: SupabaseClient, select = "id, user_id, display_name, role, email, team, is_active, created_at") {
  const c = cache();
  const cached = getCached(c.workersList);
  if (cached !== undefined) return cached;

  const { data, error } = await admin
    .from("workers")
    .select(select)
    .in("role", ["admin", "central", "tarotista"])
    .order("display_name", { ascending: true });

  if (error) throw error;
  const rows = data || [];
  c.workersList = { value: rows, expiresAt: Date.now() + LIST_TTL_MS };
  return rows;
}
