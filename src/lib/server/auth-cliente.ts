import { createClient } from "@supabase/supabase-js";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function normalizePhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

export function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

export async function authUserFromBearer(req: Request): Promise<{ uid: string | null; phone: string | null }> {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null, phone: null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;

  return {
    uid: data.user?.id || null,
    phone: data.user?.phone || null,
  };
}

export async function clientFromRequest(req: Request) {
  const { uid, phone } = await authUserFromBearer(req);
  if (!uid || !phone) return { uid, phone, cliente: null as any, admin: null as any };

  const admin = adminClient();
  const normalized = normalizePhone(phone);

  const { data: cliente, error } = await admin
    .from("crm_clientes")
    .select("*")
    .eq("telefono_normalizado", normalized)
    .maybeSingle();

  if (error) throw error;

  return { uid, phone, cliente, admin };
}
