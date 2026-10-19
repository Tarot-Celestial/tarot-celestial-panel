import { createHmac, randomInt, randomUUID } from "node:crypto";
import { adminSupabase, findAuthUserByAliasEmail } from "@/lib/server/cliente-auth-password";
import { sendEmailVerification } from "@/lib/server/cliente-whatsapp-auth";
import { COUNTRY_OPTIONS } from "@/lib/countries";

export class RegistrationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function registrationProfile(body: any) {
  const name = String(body?.name || "").trim();
  const surname = String(body?.surname || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const phone = String(body?.phone || "").replace(/^\+/, "");
  const country = COUNTRY_OPTIONS.find((item) => item.code === body?.country);
  if (name.length < 2 || name.length > 80 || surname.length > 100 || /[<>\r\n]/.test(name + surname)) throw new RegistrationError("NAME_INVALID");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(".local")) throw new RegistrationError("EMAIL_INVALIDO");
  if (!country || !/^[1-9]\d{6,14}$/.test(phone) || !phone.startsWith(country.dialCode.slice(1))) throw new RegistrationError("TELEFONO_INVALIDO");
  return { name, surname, email, phone, country: country.label, source: body?.source === "instagram" ? "instagram" : "web" };
}

function digest(value: string) {
  const secret = process.env.CLIENTE_WHATSAPP_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("REGISTRATION_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function registrationCodeHash(id: string, code: string) { return digest(`registration:${id}:${code}`); }

function resultOrError(data: any, error: any) {
  if (error) throw new Error("REGISTRATION_UNAVAILABLE");
  if (!data?.ok) {
    const code = String(data?.error || "REGISTRATION_UNAVAILABLE");
    throw new RegistrationError(code, code.includes("RATE") ? 429 : code === "REGISTRATION_IN_PROGRESS" ? 409 : 400);
  }
  return data;
}

export async function startRegistration(body: any, request: Request) {
  const profile = registrationProfile(body);
  const admin = adminSupabase();
  const id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  // Vercel replaces this header with the actual connecting IP; never trust a client body value.
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "local";
  const { data, error } = await admin.rpc("tc_client_registration_start", {
    p_id: id, p_profile: profile, p_code_hash: registrationCodeHash(id, code), p_ip_hash: digest(`registration-ip:${ip}`),
  });
  resultOrError(data, error);
  try {
    await sendEmailVerification(profile.email, code, profile.name);
  } catch {
    await admin.from("tc_client_registration_challenges").update({ state: "failed" }).eq("id", id);
    throw new RegistrationError("REGISTRATION_EMAIL_UNAVAILABLE", 503);
  }
  return { ok: true, challenge_id: id };
}

export async function completeRegistration(body: any) {
  const id = String(body?.challenge_id || "");
  const code = String(body?.code || "").trim();
  const password = String(body?.password || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code)) throw new RegistrationError("CODIGO_INVALIDO");
  if (password.length < 8 || password.length > 128) throw new RegistrationError("REGISTRATION_PASSWORD_TOO_SHORT");
  if (password !== body?.password_confirm) throw new RegistrationError("PASSWORDS_DO_NOT_MATCH");
  const admin = adminSupabase();
  const lease = randomUUID();
  const claim = await admin.rpc("tc_client_registration_claim", { p_id: id, p_code_hash: registrationCodeHash(id, code), p_lease: lease });
  const current = resultOrError(claim.data, claim.error);
  if (current.completed) return { ok: true, alias_email: current.email, created: false };
  const profile = current.profile;
  // This account is new. Existing Auth identities are never reset, merged or claimed.
  let authUser = current.auth_user_id ? (await admin.auth.admin.getUserById(current.auth_user_id)).data.user : null;
  if (!authUser) {
    const created = await admin.auth.admin.createUser({
      email: profile.email, password, email_confirm: true,
      app_metadata: { registration_id: id }, user_metadata: { display_name: profile.name },
    });
    authUser = created.data.user;
    if (created.error) {
      // A response may have been lost after account creation. Recover only our own exact attempt.
      const existing = await findAuthUserByAliasEmail(profile.email);
      if (existing?.app_metadata?.registration_id !== id) throw new RegistrationError("REGISTRATION_ACCOUNT_EXISTS", 409);
      authUser = existing;
    }
  }
  if (!authUser || authUser.app_metadata?.registration_id !== id || authUser.email?.toLowerCase() !== profile.email || !authUser.email_confirmed_at) throw new RegistrationError("REGISTRATION_ACCOUNT_EXISTS", 409);
  const saved = await admin.from("tc_client_registration_challenges").update({ auth_user_id: authUser.id }).eq("id", id).eq("lease_id", lease).select("id").maybeSingle();
  if (saved.error || !saved.data) throw new RegistrationError("REGISTRATION_IN_PROGRESS", 409);
  const completed = await admin.rpc("tc_client_registration_complete", { p_id: id, p_lease: lease, p_auth_user_id: authUser.id });
  resultOrError(completed.data, completed.error);
  return { ok: true, alias_email: profile.email, created: true };
}
