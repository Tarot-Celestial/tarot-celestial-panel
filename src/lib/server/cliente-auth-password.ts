import type { User } from "@supabase/supabase-js";
import { adminClient } from "@/lib/server/auth-cliente";

type ClienteLike = {
  id: string;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  email?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  auth_user_id?: string | null;
  onboarding_completado?: boolean | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function clienteAuthAliasEmail(phoneDigits: string): string {
  const digits = normalizePhoneDigits(phoneDigits);
  return digits ? `cliente-${digits}@auth.tarotcelestial.local` : "";
}

export function buildPasswordValidationError(password: string): string | null {
  const value = String(password || "");
  if (!value) return "La contraseña es obligatoria.";
  if (value.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return "La contraseña debe incluir al menos una letra y un número.";
  }
  return null;
}

function randomPassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*_-";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function listAllAuthUsers() {
  const admin = adminClient();
  const users: User[] = [];
  let page = 1;

  while (page <= 20) {
    const batch = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (batch.error) throw batch.error;
    const chunk = batch.data?.users || [];
    users.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
  }

  return users;
}

async function findClienteById(clienteId: string) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("crm_clientes")
    .select("*")
    .eq("id", clienteId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as ClienteLike | null;
}

export async function findClienteByPhoneForAuth(phoneDigits: string) {
  const admin = adminClient();
  const digits = normalizePhoneDigits(phoneDigits);
  if (!digits) return null;

  const { data, error } = await admin
    .from("crm_clientes")
    .select("*")
    .or(
      `telefono_normalizado.eq.${digits},telefono.eq.${digits},telefono_normalizado.eq.+${digits},telefono.eq.+${digits}`
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as ClienteLike | null;
}

function readMeta(user: User, key: string): string {
  const userMeta = (user.user_metadata || {}) as Record<string, any>;
  const appMeta = (user.app_metadata || {}) as Record<string, any>;
  return String(userMeta[key] ?? appMeta[key] ?? "").trim();
}

function scoreUserMatch(user: User, cliente: ClienteLike, phoneDigits: string, realEmail: string, aliasEmail: string): number {
  let score = 0;

  if (cliente.auth_user_id && user.id === cliente.auth_user_id) score += 1000;
  if (normalizeEmail(user.email) === aliasEmail) score += 500;
  if (realEmail && normalizeEmail(user.email) === realEmail) score += 250;
  if (normalizePhoneDigits((user as any)?.phone) === phoneDigits) score += 200;
  if (normalizePhoneDigits(readMeta(user, "crm_phone")) === phoneDigits) score += 150;
  if (normalizeEmail(readMeta(user, "crm_email")) === realEmail && realEmail) score += 120;
  if (normalizeText(readMeta(user, "cliente_id")) === normalizeText(cliente.id)) score += 110;

  return score;
}

function findBestAuthUserMatch(users: User[], cliente: ClienteLike, phoneDigits: string, realEmail: string, aliasEmail: string) {
  let best: User | null = null;
  let bestScore = 0;

  for (const user of users) {
    const score = scoreUserMatch(user, cliente, phoneDigits, realEmail, aliasEmail);
    if (score > bestScore) {
      best = user;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

async function tryLinkClienteAuthUser(clienteId: string, authUserId: string) {
  const admin = adminClient();
  try {
    const { error } = await admin
      .from("crm_clientes")
      .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
      .eq("id", clienteId);

    if (error) {
      const message = String(error.message || "");
      if (
        message.includes("auth_user_id") ||
        message.includes("column") ||
        message.includes("schema cache")
      ) {
        return false;
      }
      throw error;
    }
    return true;
  } catch (e: any) {
    const message = String(e?.message || "");
    if (
      message.includes("auth_user_id") ||
      message.includes("column") ||
      message.includes("schema cache")
    ) {
      return false;
    }
    throw e;
  }
}

async function syncClienteIdentityFields(cliente: ClienteLike, phoneDigits: string) {
  const admin = adminClient();
  const patch: Record<string, any> = {};
  const plusPhone = phoneDigits ? `+${phoneDigits}` : "";

  if (phoneDigits && normalizePhoneDigits(cliente.telefono_normalizado) !== phoneDigits) {
    patch.telefono_normalizado = phoneDigits;
  }

  if (!normalizeText(cliente.telefono) && plusPhone) {
    patch.telefono = plusPhone;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await admin.from("crm_clientes").update(patch).eq("id", cliente.id);
  if (error) throw error;
}

export async function ensureClienteAuthUser(clienteInput: ClienteLike, password?: string | null) {
  const admin = adminClient();
  const cliente = clienteInput?.id ? (await findClienteById(clienteInput.id)) || clienteInput : clienteInput;
  const phoneDigits = normalizePhoneDigits(cliente?.telefono_normalizado || cliente?.telefono);
  if (!phoneDigits) throw new Error("CLIENTE_SIN_TELEFONO");

  const aliasEmail = clienteAuthAliasEmail(phoneDigits);
  const realEmail = normalizeEmail(cliente?.email);
  const displayName =
    normalizeText([cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ")) ||
    "Cliente Tarot Celestial";

  await syncClienteIdentityFields(cliente, phoneDigits);

  const users = await listAllAuthUsers();
  const matched = findBestAuthUserMatch(users, cliente, phoneDigits, realEmail, aliasEmail);

  const userMetadata = {
    crm_phone: phoneDigits,
    crm_email: realEmail || null,
    cliente_id: cliente.id,
    display_name: displayName,
  };

  if (matched?.id) {
    const payload: Record<string, any> = {
      email: aliasEmail,
      email_confirm: true,
      user_metadata: userMetadata,
    };

    const matchedPhone = normalizePhoneDigits((matched as any)?.phone);
    if (!matchedPhone || matchedPhone === phoneDigits) {
      payload.phone = `+${phoneDigits}`;
      payload.phone_confirm = true;
    }

    if (password) {
      payload.password = password;
    }

    const updated = await admin.auth.admin.updateUserById(matched.id, payload);
    if (updated.error) throw updated.error;

    const linked = await tryLinkClienteAuthUser(cliente.id, matched.id);

    return {
      user: updated.data.user,
      aliasEmail,
      migrated: normalizeEmail(matched.email) !== aliasEmail,
      created: false,
      linked,
      authUserId: matched.id,
    };
  }

  const createPayload: Record<string, any> = {
    email: aliasEmail,
    password: password || randomPassword(),
    email_confirm: true,
    user_metadata: userMetadata,
  };

  createPayload.phone = `+${phoneDigits}`;
  createPayload.phone_confirm = true;

  let created = await admin.auth.admin.createUser(createPayload);

  if (created.error) {
    const message = String(created.error.message || "").toLowerCase();
    const phoneConflict =
      message.includes("phone") ||
      message.includes("already been registered") ||
      message.includes("already exists") ||
      message.includes("duplicate");

    if (!phoneConflict) throw created.error;

    const retryPayload = { ...createPayload };
    delete retryPayload.phone;
    delete retryPayload.phone_confirm;
    created = await admin.auth.admin.createUser(retryPayload);
    if (created.error) throw created.error;
  }

  const createdUser = created.data.user;
  if (!createdUser?.id) throw new Error("AUTH_USER_CREATE_FAILED");

  const linked = await tryLinkClienteAuthUser(cliente.id, createdUser.id);

  return {
    user: createdUser,
    aliasEmail,
    migrated: false,
    created: true,
    linked,
    authUserId: createdUser.id,
  };
}
