import { createClient } from "@supabase/supabase-js";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function normalizePhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

function guessNameFromEmail(email: string | null | undefined): string {
  const local = normalizeEmail(email).split("@")[0] || "Cliente";
  return (
    local
      .replace(/[._-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Cliente"
  );
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
}> {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null, phone: null, email: null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;

  return {
    uid: data.user?.id || null,
    phone: data.user?.phone || null,
    email: data.user?.email || null,
  };
}

export async function clientFromRequest(req: Request) {
  const { uid, phone, email } = await authUserFromBearer(req);

  if (!uid || (!phone && !email)) {
    return { uid, phone, email, cliente: null as any, admin: null as any };
  }

  const admin = adminClient();

  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  let cliente: any = null;

  // 🔍 Buscar por teléfono
  if (normalizedPhone) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("*")
      .eq("telefono_normalizado", normalizedPhone)
      .maybeSingle();

    if (error) throw error;
    cliente = data || null;
  }

  // 🔍 Buscar por email
  if (!cliente && normalizedEmail) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("*")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (error) throw error;
    cliente = data || null;
  }

  // 🆕 CREAR CLIENTE (FIX DEFINITIVO)
  if (!cliente && normalizedEmail) {
    const nowIso = new Date().toISOString();

    // 🔥 CLAVE: NUNCA NULL
    const telefonoFinal = normalizedPhone || "000000000";

    const { data, error } = await admin
      .from("crm_clientes")
      .insert({
        nombre: guessNameFromEmail(normalizedEmail),

        // 🔥 AQUÍ ESTABA EL BUG
        telefono: telefonoFinal,
        telefono_normalizado: telefonoFinal,

        email: normalizedEmail,
        origen: "chat_email",
        onboarding_completado: false,
        updated_at: nowIso,
      })
      .select("*")
      .maybeSingle();

    if (error) throw error;

    cliente = data || null;
  }

  return {
    uid,
    phone,
    email: normalizedEmail || null,
    cliente,
    admin,
  };
}
