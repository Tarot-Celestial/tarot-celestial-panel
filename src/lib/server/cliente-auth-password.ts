import { createClient } from "@supabase/supabase-js";

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

export function digitsOnly(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePhoneDigits(value: string | null | undefined) {
  let digits = digitsOnly(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

function phoneCandidates(value: string | null | undefined) {
  const raw = normalizePhoneDigits(value);
  const set = new Set<string>();

  if (!raw) return [] as string[];

  set.add(raw);
  set.add(raw.replace(/^0+/, ""));

  if (raw.length > 9) set.add(raw.slice(-9));
  if (raw.length > 10) set.add(raw.slice(-10));
  if (raw.length > 11) set.add(raw.slice(-11));

  const knownPrefixes = ["34", "1", "52", "54", "56", "57", "58", "351", "44", "33", "39"];
  for (const prefix of knownPrefixes) {
    if (raw.startsWith(prefix) && raw.length > prefix.length + 6) {
      set.add(raw.slice(prefix.length));
    }
  }

  return [...set].filter(Boolean);
}

export function buildPasswordValidationError(password: string, confirm?: string) {
  if (!password || password.length < 6) {
    return "PASSWORD_TOO_SHORT";
  }
  if (typeof confirm !== "undefined" && password !== confirm) {
    return "PASSWORDS_DO_NOT_MATCH";
  }
  return null;
}

export function buildClienteAliasEmail(phone: string | null | undefined) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) throw new Error("PHONE_REQUIRED");
  return `cliente-${digits}@auth.tarotcelestial.local`;
}

function buildExactPhoneOr(candidates: string[]) {
  return candidates
    .flatMap((digits) => [
      `telefono_normalizado.eq.${digits}`,
      `telefono.eq.${digits}`,
      `telefono_normalizado.eq.+${digits}`,
      `telefono.eq.+${digits}`,
    ])
    .join(",");
}

function isMissingAuthUserIdColumnError(error: any) {
  const text = String(error?.message || error?.details || "").toLowerCase();
  return text.includes("auth_user_id") && text.includes("does not exist");
}

async function syncClientePhone(admin: ReturnType<typeof adminSupabase>, clienteId: string, phoneDigits: string) {
  try {
    await admin
      .from("crm_clientes")
      .update({ telefono_normalizado: phoneDigits })
      .eq("id", clienteId);
  } catch {
    // no-op
  }
}

async function linkClienteAuthUser(admin: ReturnType<typeof adminSupabase>, clienteId: string, authUserId: string) {
  const { error } = await admin
    .from("crm_clientes")
    .update({ auth_user_id: authUserId })
    .eq("id", clienteId);

  if (error && !isMissingAuthUserIdColumnError(error)) {
    throw error;
  }
}

export async function findClienteByPhone(phone: string) {
  const sb = adminSupabase();
  const candidates = phoneCandidates(phone);
  if (!candidates.length) return null;

  const exactOr = buildExactPhoneOr(candidates);
  let data: any = null;

  const exact = await sb
    .from("crm_clientes")
    .select("id, telefono, telefono_normalizado, auth_user_id, email, onboarding_completado")
    .or(exactOr)
    .limit(1)
    .maybeSingle();

  if (exact.error) throw exact.error;
  data = exact.data;

  if (!data) {
    const longest = candidates.sort((a, b) => b.length - a.length)[0] || "";
    const tail = longest.length > 9 ? longest.slice(-9) : longest;

    if (tail) {
      const fuzzy = await sb
        .from("crm_clientes")
        .select("id, telefono, telefono_normalizado, auth_user_id, email, onboarding_completado")
        .or(`telefono.ilike.%${tail}%,telefono_normalizado.ilike.%${tail}%`)
        .limit(1)
        .maybeSingle();

      if (fuzzy.error) throw fuzzy.error;
      data = fuzzy.data;
    }
  }

  if (data?.id) {
    const canonical = candidates[0];
    if (canonical) await syncClientePhone(sb, data.id, canonical);
  }

  return data;
}

export const findClienteByPhoneForAuth = findClienteByPhone;

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

export async function ensureClienteAuthUser(params: {
  phone: string;
  password?: string;
}) {
  const sb = adminSupabase();
  const phoneDigits = normalizePhoneDigits(params.phone);

  if (!phoneDigits) throw new Error("PHONE_REQUIRED");

  const aliasEmail = buildClienteAliasEmail(phoneDigits);
  const cliente = await findClienteByPhone(phoneDigits);

  if (!cliente?.id) {
    throw new Error("CLIENTE_NOT_FOUND");
  }

  if (cliente.auth_user_id) {
    if (params.password) {
      const { error } = await sb.auth.admin.updateUserById(cliente.auth_user_id, {
        password: params.password,
        email_confirm: true,
        user_metadata: {
          telefono_normalizado: phoneDigits,
          crm_cliente_id: cliente.id,
          password_ready: true,
        },
      });
      if (error) throw error;
    }

    await syncClientePhone(sb, cliente.id, phoneDigits);

    return {
      ok: true,
      auth_user_id: cliente.auth_user_id,
      alias_email: aliasEmail,
      created: false,
    };
  }

  const existingUser = await findAuthUserByAliasEmail(aliasEmail);

  if (existingUser) {
    await linkClienteAuthUser(sb, cliente.id, existingUser.id);

    if (params.password) {
      const { error } = await sb.auth.admin.updateUserById(existingUser.id, {
        password: params.password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser.user_metadata || {}),
          telefono_normalizado: phoneDigits,
          crm_cliente_id: cliente.id,
          password_ready: true,
        },
      });
      if (error) throw error;
    }

    await syncClientePhone(sb, cliente.id, phoneDigits);

    return {
      ok: true,
      auth_user_id: existingUser.id,
      alias_email: aliasEmail,
      created: false,
    };
  }

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
  if (!created.user?.id) throw new Error("AUTH_USER_CREATE_FAILED");

  await linkClienteAuthUser(sb, cliente.id, created.user.id);
  await syncClientePhone(sb, cliente.id, phoneDigits);

  return {
    ok: true,
    auth_user_id: created.user.id,
    alias_email: aliasEmail,
    created: true,
  };
}
