import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function getServiceClient(): SupabaseClient {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function uidAndEmailFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null, email: null as string | null };

  const userClient = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;

  return {
    uid: data.user?.id || null,
    email: data.user?.email || null,
  };
}

export async function requireAdmin(req: Request) {
  const { uid, email } = await uidAndEmailFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH" as const };

  const admin = getServiceClient();

  let { data: me, error } = await admin
    .from("workers")
    .select("id, role, email, user_id, display_name, team, is_active")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;

  if (!me && email) {
    const fallback = await admin
      .from("workers")
      .select("id, role, email, user_id, display_name, team, is_active")
      .eq("email", email)
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    me = fallback.data as any;
  }

  if (!me) return { ok: false as const, error: "NO_WORKER" as const };
  if (me.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };

  return { ok: true as const, admin, me };
}

export function normalizeTeam(team: any): "fuego" | "agua" | null {
  const value = String(team || "").trim().toLowerCase();
  if (!value) return null;
  if (value !== "fuego" && value !== "agua") throw new Error("INVALID_TEAM");
  return value;
}

export function normalizeRole(role: any): "admin" | "central" | "tarotista" {
  const value = String(role || "").trim().toLowerCase();
  if (value !== "admin" && value !== "central" && value !== "tarotista") throw new Error("INVALID_ROLE");
  return value;
}

export function normalizeMonthKey(raw: any) {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("INVALID_MONTH_KEY");
  return value;
}

export function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
