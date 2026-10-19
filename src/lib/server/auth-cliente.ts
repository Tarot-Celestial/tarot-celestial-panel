import { createClient } from "@supabase/supabase-js";
import { normalizePhoneDigits } from "@/lib/server/cliente-auth-password";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function phoneDigits(phone: string | null | undefined): string {
  return normalizePhoneDigits(phone);
}

export function normalizePhone(phone: string | null | undefined): string {
  const digits = phoneDigits(phone);
  if (!digits) return "";
  return `+${digits}`;
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

function isInternalClienteAuthEmail(email: string | null | undefined): boolean {
  const value = normalizeEmail(email);
  return value.endsWith("@auth.tarotcelestial.local") && value.startsWith("cliente-");
}

export function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

export async function authUserFromBearer(req: Request): Promise<{
  uid: string | null;
  phone: string | null;
  email: string | null;
  realEmail: string | null;
}> {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return { uid: null, phone: null, email: null, realEmail: null };
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser(token);
  if (error) {
    if (error.status === 400 || error.status === 401 || error.status === 403) return { uid: null, phone: null, email: null, realEmail: null };
    throw error;
  }

  const user: any = data.user || null;
  const rawEmail = normalizeEmail(user?.email || null);

  // Contact claims are informative only. CRM authorization uses the immutable Auth id.
  const finalPhoneDigits = phoneDigits(user?.phone) || null;
  const finalRealEmail = isInternalClienteAuthEmail(rawEmail) ? null : rawEmail || null;

  return {
    uid: user?.id || null,
    phone: finalPhoneDigits || null,
    email: rawEmail || null,
    realEmail: finalRealEmail,
  };
}

export async function clientFromRequest(req: Request) {
  const { uid, phone, email, realEmail } = await authUserFromBearer(req);
  if (!uid) return { uid, phone, email: realEmail || email, cliente: null as any, admin: null as any };
  const admin = adminClient();
  const linked = await admin.from("crm_clientes").select("*").eq("auth_user_id", uid).limit(2);
  if (linked.error) throw linked.error;
  if ((linked.data || []).length > 1) throw new Error("AUTH_VINCULADO_A_VARIAS_FICHAS");
  return { uid, phone, email: realEmail || email, cliente: linked.data?.[0] || null, admin };
}
