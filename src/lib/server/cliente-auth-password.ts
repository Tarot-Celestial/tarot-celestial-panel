import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

// ✅ EXPORTADO (ANTES TE FALTABA)
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

// ✅ EXPORTADO (ANTES TE FALTABA)
export function digitsOnly(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

// 🔥 EMAIL CANÓNICO
export function buildClienteAliasEmail(phone: string | null | undefined) {
  const digits = digitsOnly(phone);
  if (!digits) throw new Error("PHONE_REQUIRED");
  return `cliente-${digits}@auth.tarotcelestial.local`;
}

// 🔍 BUSCAR CLIENTE
export async function findClienteByPhone(phone: string) {
  const sb = adminSupabase();
  const digits = digitsOnly(phone);

  const { data, error } = await sb
    .from("crm_clientes")
    .select("id, telefono, telefono_normalizado, auth_user_id")
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

// 🔍 BUSCAR USUARIO AUTH POR EMAIL
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

// 🔥 FUNCIÓN CLAVE (ANTI DUPLICADOS)
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

  // ✅ YA TIENE USER
  if (cliente.auth_user_id) {
    if (params.password) {
      await sb.auth.admin.updateUserById(cliente.auth_user_id, {
        password: params.password,
        email_confirm: true,
      });
    }

    return {
      auth_user_id: cliente.auth_user_id,
      alias_email: aliasEmail,
      created: false,
    };
  }

  // 🔍 BUSCAR SI YA EXISTE
  const existingUser = await findAuthUserByAliasEmail(aliasEmail);

  if (existingUser) {
    // 🔗 LINK
    await sb
      .from("crm_clientes")
      .update({ auth_user_id: existingUser.id })
      .eq("id", cliente.id);

    if (params.password) {
      await sb.auth.admin.updateUserById(existingUser.id, {
        password: params.password,
        email_confirm: true,
      });
    }

    return {
      auth_user_id: existingUser.id,
      alias_email: aliasEmail,
      created: false,
    };
  }

  // 🆕 CREAR
  const { data: created, error } = await sb.auth.admin.createUser({
    email: aliasEmail,
    password: params.password || crypto.randomUUID(),
    email_confirm: true,
    user_metadata: {
      telefono_normalizado: phoneDigits,
      crm_cliente_id: cliente.id,
    },
  });

  if (error) throw error;

  // 🔗 LINK CRM
  await sb
    .from("crm_clientes")
    .update({ auth_user_id: created.user.id })
    .eq("id", cliente.id);

  return {
    auth_user_id: created.user.id,
    alias_email: aliasEmail,
    created: true,
  };
}
