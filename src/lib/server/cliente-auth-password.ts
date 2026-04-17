import { createClient } from "@supabase/supabase-js";

/* =========================================================
   ENV + CLIENT
========================================================= */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function adminSupabase() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/* =========================================================
   HELPERS
========================================================= */

export function digitsOnly(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

// 👉 alias para compatibilidad con tu código existente
export const normalizePhoneDigits = digitsOnly;

/* =========================================================
   PASSWORD VALIDATION
========================================================= */

export function buildPasswordValidationError(password: string, confirm?: string) {
  if (!password || password.length < 6) {
    return "PASSWORD_TOO_SHORT";
  }
  if (typeof confirm !== "undefined" && password !== confirm) {
    return "PASSWORDS_DO_NOT_MATCH";
  }
  return null;
}

/* =========================================================
   EMAIL CANÓNICO
========================================================= */

export function buildClienteAliasEmail(phone: string | null | undefined) {
  const digits = digitsOnly(phone);
  if (!digits) throw new Error("PHONE_REQUIRED");
  return `cliente-${digits}@auth.tarotcelestial.local`;
}

/* =========================================================
   CRM LOOKUP
========================================================= */

export async function findClienteByPhone(phone: string) {
  const sb = adminSupabase();
  const digits = digitsOnly(phone);

  const { data, error } = await sb
    .from("crm_clientes")
    .select("id, telefono, telefono_normalizado, auth_user_id, email")
    .or(
      [
        `telefono_normalizado.eq.${digits}`,
        `telefono.eq.${digits}`,
        `telefono_normalizado.eq.+${digits}`,
        `telefono.eq.+${digits}`,
      ].join(",")
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// 👉 alias para que no rompa tu código actual
export const findClienteByPhoneForAuth = findClienteByPhone;

/* =========================================================
   AUTH LOOKUP
========================================================= */

export async function findAuthUserByAliasEmail(aliasEmail: string) {
  const sb = adminSupabase();

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    const users = data?.users || [];

    const found = users.find(
      (u) => String(u.email || "").toLowerCase() === aliasEmail.toLowerCase()
    );

    if (found) return found;

    if (users.length < perPage) break;
    page++;
  }

  return null;
}

/* =========================================================
   CORE: ANTI DUPLICADOS
========================================================= */

export async function ensureClienteAuthUser(params: {
  phone: string;
  password?: string;
}) {
  const sb = adminSupabase();
  const phoneDigits = digitsOnly(params.phone);

  if (!phoneDigits) throw new Error("PHONE_REQUIRED");

  const aliasEmail = buildClienteAliasEmail(phoneDigits);

  const cliente = await findClienteByPhone(phoneDigits);

  if (!cliente?.id) {
    throw new Error("CLIENTE_NOT_FOUND");
  }

  // ✅ YA TIENE AUTH USER
  if (cliente.auth_user_id) {
    if (params.password) {
      await sb.auth.admin.updateUserById(cliente.auth_user_id, {
        password: params.password,
        email_confirm: true,
        user_metadata: {
          telefono_normalizado: phoneDigits,
          crm_cliente_id: cliente.id,
          password_ready: true,
        },
      });
    }

    return {
      ok: true,
      auth_user_id: cliente.auth_user_id,
      alias_email: aliasEmail,
      created: false,
    };
  }

  // 🔍 BUSCAR EXISTENTE
  const existingUser = await findAuthUserByAliasEmail(aliasEmail);

  if (existingUser) {
    await sb
      .from("crm_clientes")
      .update({ auth_user_id: existingUser.id })
      .eq("id", cliente.id);

    if (params.password) {
      await sb.auth.admin.updateUserById(existingUser.id, {
        password: params.password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser.user_metadata || {}),
          telefono_normalizado: phoneDigits,
          crm_cliente_id: cliente.id,
          password_ready: true,
        },
      });
    }

    return {
      ok: true,
      auth_user_id: existingUser.id,
      alias_email: aliasEmail,
      created: false,
    };
  }

  // 🆕 CREAR NUEVO
  const { data: created, error } = await sb.auth.admin.createUser({
    email: aliasEmail,
    password: params.password || crypto.randomUUID(),
    email_confirm: true,
    user_metadata: {
      telefono_normalizado: phoneDigits,
      crm_cliente_id: cliente.id,
      password_ready: Boolean(params.password),
    },
  });

  if (error) throw error;

  await sb
    .from("crm_clientes")
    .update({ auth_user_id: created.user.id })
    .eq("id", cliente.id);

  return {
    ok: true,
    auth_user_id: created.user.id,
    alias_email: aliasEmail,
    created: true,
  };
}
