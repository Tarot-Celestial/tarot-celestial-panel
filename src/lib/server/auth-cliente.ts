import { createClient } from "@supabase/supabase-js";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

// 🔥 NORMALIZADOR PRO (CLAVE)
export function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("34")) return `+${digits}`;
  if (digits.startsWith("1")) return `+${digits}`;

  return `+${digits}`;
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

  const metadataPhone = normalizePhone(
    user?.user_metadata?.crm_phone || user?.app_metadata?.crm_phone
  );

  return {
    uid: user?.id || null,
    phone: normalizePhone(user?.phone) || metadataPhone || null,
    email: user?.email || null,
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

  // 🔍 BUSCAR POR TELÉFONO
  if (normalizedPhone) {
    const { data } = await admin
      .from("crm_clientes")
      .select("*")
      .eq("telefono_normalizado", normalizedPhone)
      .maybeSingle();

    cliente = data || null;
  }

  // 🔍 BUSCAR POR EMAIL
  if (!cliente && normalizedEmail) {
    const { data } = await admin
      .from("crm_clientes")
      .select("*")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    cliente = data || null;
  }

  // 🔥 AUTO-FIX SI ENCUENTRA PERO ESTÁ MAL FORMATEADO
  if (cliente) {
    const updates: any = {};

    if (cliente.telefono_normalizado !== normalizedPhone && normalizedPhone) {
      updates.telefono_normalizado = normalizedPhone;
      updates.telefono = normalizedPhone;
    }

    if (!cliente.user_id && uid) {
      updates.user_id = uid;
    }

    if (Object.keys(updates).length > 0) {
      await admin.from("crm_clientes").update(updates).eq("id", cliente.id);

      cliente = {
        ...cliente,
        ...updates,
      };
    }
  }

  // 🆕 CREAR CLIENTE SI NO EXISTE
  if (!cliente) {
    const nowIso = new Date().toISOString();

    const telefonoFinal = normalizedPhone || "000000000";

    const { data } = await admin
      .from("crm_clientes")
      .insert({
        nombre: guessNameFromEmail(normalizedEmail),
        telefono: telefonoFinal,
        telefono_normalizado: telefonoFinal,
        email: normalizedEmail,
        origen: "auto_auth",
        onboarding_completado: false,
        user_id: uid, // 🔥 CLAVE
        updated_at: nowIso,
      })
      .select("*")
      .maybeSingle();

    cliente = data || null;
  }

  return {
    uid,
    phone: normalizedPhone || null,
    email: normalizedEmail || null,
    cliente,
    admin,
  };
}
