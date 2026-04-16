import { createClient } from "@supabase/supabase-js";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function phoneDigits(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
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

function extractPhoneFromInternalClienteEmail(email: string | null | undefined): string {
  const value = normalizeEmail(email);
  const match = value.match(/^cliente-(\d+)@auth\.tarotcelestial\.local$/);
  if (!match?.[1]) return "";
  return match[1];
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

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;

  const user: any = data.user || null;
  const rawEmail = normalizeEmail(user?.email || null);

  const metadataPhone =
    user?.user_metadata?.crm_phone ||
    user?.app_metadata?.crm_phone ||
    null;

  const metadataEmail =
    user?.user_metadata?.crm_email ||
    user?.app_metadata?.crm_email ||
    null;

  const phoneFromInternalEmail = extractPhoneFromInternalClienteEmail(rawEmail);

  const finalPhoneDigits =
    phoneDigits(user?.phone) ||
    phoneDigits(metadataPhone) ||
    phoneFromInternalEmail ||
    "";

  const finalRealEmail =
    normalizeEmail(metadataEmail || (isInternalClienteAuthEmail(rawEmail) ? "" : rawEmail)) || null;

  return {
    uid: user?.id || null,
    phone: finalPhoneDigits || null,
    email: rawEmail || null,
    realEmail: finalRealEmail,
  };
}

async function findClienteByPhone(admin: ReturnType<typeof adminClient>, phone: string | null) {
  const digits = phoneDigits(phone);
  const plus = normalizePhone(phone);

  if (!digits) return null;

  const { data, error } = await admin
    .from("crm_clientes")
    .select("*")
    .or(
      `telefono_normalizado.eq.${digits},telefono_normalizado.eq.${plus},telefono.eq.${digits},telefono.eq.${plus}`
    )
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
  const { uid, phone, email, realEmail } = await authUserFromBearer(req);

  if (!uid || (!phone && !realEmail && !email)) {
    return {
      uid,
      phone,
      email: realEmail || email,
      cliente: null as any,
      admin: null as any,
    };
  }

  const admin = adminClient();

  const normalizedPhoneDigits = phoneDigits(phone);
  const normalizedPhonePlus = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(realEmail);
  const rawEmail = normalizeEmail(email);

  let cliente: any = null;

  // 1) Buscar por teléfono
  if (normalizedPhoneDigits) {
    cliente = await findClienteByPhone(admin, normalizedPhoneDigits);
  }

  // 2) Buscar por email real
  if (!cliente && normalizedEmail) {
    cliente = await findClienteByEmail(admin, normalizedEmail);
  }

  // 3) Buscar por email auth si no es interno
  if (!cliente && rawEmail && !isInternalClienteAuthEmail(rawEmail)) {
    cliente = await findClienteByEmail(admin, rawEmail);
  }

  // 4) Si encuentra ficha, solo corrige datos útiles
  if (cliente) {
    const updates: Record<string, any> = {};

    if (normalizedPhoneDigits) {
      if (!cliente.telefono_normalizado || String(cliente.telefono_normalizado).trim() !== normalizedPhoneDigits) {
        updates.telefono_normalizado = normalizedPhoneDigits;
      }

      if (!cliente.telefono) {
        updates.telefono = normalizedPhoneDigits;
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
      phone: normalizedPhonePlus || null,
      email: normalizedEmail || rawEmail || null,
      cliente,
      admin,
    };
  }

  // 5) NO crear clientes fantasma automáticamente
  return {
    uid,
    phone: normalizedPhonePlus || null,
    email: normalizedEmail || rawEmail || null,
    cliente: null as any,
    admin,
  };
}
