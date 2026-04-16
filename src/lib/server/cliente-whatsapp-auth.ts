import { createClient } from "@supabase/supabase-js";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function normalizePhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

export function formatE164FromDigits(phoneDigits: string): string {
  const digits = normalizePhone(phoneDigits);
  return digits ? `+${digits}` : "";
}

export function clienteAuthAliasEmail(phoneDigits: string): string {
  const digits = normalizePhone(phoneDigits);
  return `cliente-${digits}@auth.tarotcelestial.local`;
}

export function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

function twilioBasicAuth() {
  const sid = getEnv("TWILIO_ACCOUNT_SID");
  const token = getEnv("TWILIO_AUTH_TOKEN");
  return Buffer.from(`${sid}:${token}`).toString("base64");
}

function getVerifyServiceSid() {
  return getEnv("TWILIO_VERIFY_SERVICE_SID");
}

async function twilioVerifyRequest(path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const response = await fetch(`https://verify.twilio.com/v2/Services/${getVerifyServiceSid()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${twilioBasicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.message || json?.detail || json?.error || "TWILIO_VERIFY_ERROR";
    throw new Error(message);
  }
  return json as Record<string, any>;
}

export async function sendWhatsappVerification(phoneE164: string) {
  return twilioVerifyRequest("/Verifications", {
    To: phoneE164,
    Channel: "whatsapp",
  });
}

export async function checkWhatsappVerification(phoneE164: string, code: string) {
  return twilioVerifyRequest("/VerificationCheck", {
    To: phoneE164,
    Code: String(code || "").trim(),
  });
}

export async function findClienteByPhone(phoneDigits: string) {
  const admin = adminClient();
  const digits = normalizePhone(phoneDigits);
  if (!digits) return null;

  const { data, error } = await admin
    .from("crm_clientes")
    .select("id, nombre, apellido, telefono, telefono_normalizado, email")
    .or(`telefono_normalizado.eq.${digits},telefono.eq.${digits}`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function createClienteMagicLinkFromWhatsapp(phoneDigits: string, origin: string) {
  const admin = adminClient();
  const digits = normalizePhone(phoneDigits);
  const email = clienteAuthAliasEmail(digits);
  const redirectTo = `${origin.replace(/\/$/, "")}/cliente/dashboard`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo,
      data: {
        crm_phone: digits,
        login_channel: "whatsapp_otp",
      },
    },
  });

  if (error) throw error;

  const actionLink =
    (data as any)?.properties?.action_link ||
    (data as any)?.properties?.actionLink ||
    (data as any)?.action_link ||
    null;

  if (!actionLink || typeof actionLink !== "string") {
    throw new Error("MAGIC_LINK_NOT_AVAILABLE");
  }

  return {
    email,
    actionLink,
  };
}
