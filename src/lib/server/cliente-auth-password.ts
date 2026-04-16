import type { User } from "@supabase/supabase-js";
import { adminClient } from "@/lib/server/auth-cliente";

type ClienteLike = {
  id: string;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  email?: string | null;
  nombre?: string | null;
  apellido?: string | null;
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

export async function findClienteByPhoneForAuth(phoneDigits: string) {
  const admin = adminClient();
  const digits = normalizePhoneDigits(phoneDigits);
  if (!digits) return null;

  const { data, error } = await admin
    .from("crm_clientes")
    .select("id, nombre, apellido, email, telefono, telefono_normalizado, onboarding_completado")
    .or(`telefono_normalizado.eq.${digits},telefono.eq.${digits},telefono_normalizado.eq.+${digits},telefono.eq.+${digits}`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function matchUserByPhoneOrEmail(user: User, phoneDigits: string, realEmail: string) {
  const email = normalizeEmail(user.email);
  const phone = normalizePhoneDigits((user as any)?.phone);
  const metaPhone = normalizePhoneDigits((user.user_metadata as any)?.crm_phone || (user.app_metadata as any)?.crm_phone);
  const metaEmail = normalizeEmail((user.user_metadata as any)?.crm_email || (user.app_metadata as any)?.crm_email);

  return (
    email === clienteAuthAliasEmail(phoneDigits) ||
    (realEmail ? email === realEmail : false) ||
    (phoneDigits ? phone === phoneDigits : false) ||
    (phoneDigits ? metaPhone === phoneDigits : false) ||
    (realEmail ? metaEmail === realEmail : false)
  );
}

export async function ensureClienteAuthUser(cliente: ClienteLike, password?: string | null) {
  const admin = adminClient();
  const phoneDigits = normalizePhoneDigits(cliente?.telefono_normalizado || cliente?.telefono);
  if (!phoneDigits) throw new Error("CLIENTE_SIN_TELEFONO");

  const aliasEmail = clienteAuthAliasEmail(phoneDigits);
  const realEmail = normalizeEmail(cliente?.email);
  const displayName = normalizeText([cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ")) || "Cliente Tarot Celestial";

  const users = await listAllAuthUsers();
  const matched = users.find((user) => matchUserByPhoneOrEmail(user, phoneDigits, realEmail)) || null;

  const userMetadata = {
    crm_phone: phoneDigits,
    crm_email: realEmail || null,
    cliente_id: cliente.id,
    display_name: displayName,
  };

  if (matched?.id) {
    const updated = await admin.auth.admin.updateUserById(matched.id, {
      email: aliasEmail,
      phone: `+${phoneDigits}`,
      email_confirm: true,
      phone_confirm: true,
      password: password || undefined,
      user_metadata: userMetadata,
    });

    if (updated.error) throw updated.error;

    return {
      user: updated.data.user,
      aliasEmail,
      migrated: normalizeEmail(matched.email) !== aliasEmail,
      created: false,
    };
  }

  const created = await admin.auth.admin.createUser({
    email: aliasEmail,
    phone: `+${phoneDigits}`,
    password: password || randomPassword(),
    email_confirm: true,
    phone_confirm: true,
    user_metadata: userMetadata,
  });

  if (created.error) throw created.error;

  return {
    user: created.data.user,
    aliasEmail,
    migrated: false,
    created: true,
  };
}
