import { createClient } from "@supabase/supabase-js";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export function phoneDigits(phone: string | null | undefined): string {
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

  const user: any = data.user || null;

  const metadataPhone =
    user?.user_metadata?.crm_phone ||
    user?.app_metadata?.crm_phone ||
    null;

  const finalPhone =
    normalizePhone(user?.phone) ||
    normalizePhone(metadataPhone) ||
    null;

  return {
    uid: user?.id || null,
    phone: finalPhone,
    email: user?.email || null,
  };
}

async function findClienteByUserId(admin: ReturnType<typeof adminClient>, uid: string) {
  const { data, error } = await admin
    .from("crm_clientes")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findClienteByPhone(admin: ReturnType<typeof adminClient>, phone: string | null) {
  const digits = phoneDigits(phone);
  const plus = normalizePhone(phone);

  if (!digits) return null;

  const { data, error } = await admin
    .from("crm_clientes")
    .select("*")
    .or(`
      telefono_normalizado.eq.${plus},
      telefono_normalizado.eq.${digits},
      telefono.eq.${digits},
      telefono.eq.${plus}
    `)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findClienteByEmail(admin: ReturnType<typeof adminClient>, email: string | null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const { data, error } = await admin
    .from("crm_clientes")
    .select("*")
    .ilike("email", normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function clientFromRequest(req: Request) {
  const { uid, phone, email } = await authUserFromBearer(req);

  if (!uid || (!phone && !email)) {
    return { uid, phone, email, cliente: null as any, admin: null as any };
  }

  const admin = adminClient();

  const normalizedPhone = normalizePhone(phone);
  const normalizedPhoneDigits = phoneDigits(phone);
  const normalizedEmail = normalizeEmail(email);

  let cliente: any = null;

  // 1) Buscar por user_id
  cliente = await findClienteByUserId(admin, uid);

  // 2) Buscar por teléfono
  if (!cliente) {
    cliente = await findClienteByPhone(admin, normalizedPhone);
  }

  // 3) Buscar por email
  if (!cliente && normalizedEmail) {
    cliente = await findClienteByEmail(admin, normalizedEmail);
  }

  // 🔥 FIX: actualizar datos sin romper cliente
  if (cliente) {
    const updates: Record<string, any> = {};

    if (!cliente.user_id && uid) {
      updates.user_id = uid;
    }

    if (normalizedPhone) {
      if (!cliente.telefono_normalizado || cliente.telefono_normalizado !== normalizedPhone) {
        updates.telefono_normalizado = normalizedPhone;
      }

      if (!cliente.telefono) {
        updates.telefono = normalizedPhone;
      }
    }

    if (!cliente.email && normalizedEmail) {
      updates.email = normalizedEmail;
    }

    if (Object.keys(updates).length > 0) {
      const { data, error } = await admin
        .from("crm_clientes")
        .update(updates)
        .eq("id", cliente.id)
        .select("*")
        .maybeSingle();

      if (error) throw error;
      cliente = data || { ...cliente, ...updates };
    }

    return {
      uid,
      phone: normalizedPhone || null,
      email: normalizedEmail || null,
      cliente,
      admin,
    };
  }

  // 🆕 SOLO crear si no existe de verdad
  const nowIso = new Date().toISOString();
  const telefonoFinal = normalizedPhone || normalizedPhoneDigits || "000000000";

  const { data, error } = await admin
    .from("crm_clientes")
    .insert({
      nombre: guessNameFromEmail(normalizedEmail),
      telefono: telefonoFinal,
      telefono_normalizado: telefonoFinal,
      email: normalizedEmail || null,
      origen: "auto_auth",
      onboarding_completado: false,
      user_id: uid,
      updated_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  if (error) throw error;

  cliente = data || null;

  return {
    uid,
    phone: normalizedPhone || null,
    email: normalizedEmail || null,
    cliente,
    admin,
  };
}
