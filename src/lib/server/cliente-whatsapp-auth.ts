import crypto from "crypto";
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

function getWhatsappFrom(): string {
  return process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
}

function twilioBasicAuth() {
  const sid = getEnv("TWILIO_ACCOUNT_SID");
  const token = getEnv("TWILIO_AUTH_TOKEN");
  return Buffer.from(`${sid}:${token}`).toString("base64");
}

async function twilioMessagesRequest(params: Record<string, string>) {
  const accountSid = getEnv("TWILIO_ACCOUNT_SID");
  const body = new URLSearchParams(params).toString();
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
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
    const message = json?.message || json?.detail || json?.error || "TWILIO_WHATSAPP_SEND_ERROR";
    throw new Error(message);
  }
  return json as Record<string, any>;
}

function getOtpSecret(): string {
  return process.env.CLIENTE_WHATSAPP_OTP_SECRET || getEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function getOtpMinutes(): number {
  const raw = Number(process.env.CLIENTE_WHATSAPP_OTP_MINUTES || 10);
  if (!Number.isFinite(raw) || raw <= 0) return 10;
  return Math.min(Math.max(Math.floor(raw), 3), 30);
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", getOtpSecret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function generateWhatsappOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createWhatsappOtpChallenge(phoneDigits: string, code: string) {
  const digits = normalizePhone(phoneDigits);
  const expiresAt = Date.now() + getOtpMinutes() * 60_000;
  const codeHash = crypto.createHash("sha256").update(`${digits}:${code}:${getOtpSecret()}`).digest("hex");
  const payloadObj = { phone: digits, exp: expiresAt, hash: codeHash };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

export function verifyWhatsappOtpChallenge(challengeToken: string, phoneDigits: string, code: string) {
  const [payload, signature] = String(challengeToken || "").split(".");
  if (!payload || !signature) throw new Error("OTP_CHALLENGE_INVALIDO");

  const expectedSignature = signPayload(payload);
  if (!safeEqual(signature, expectedSignature)) throw new Error("OTP_CHALLENGE_INVALIDO");

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    phone?: string;
    exp?: number;
    hash?: string;
  };

  const digits = normalizePhone(phoneDigits);
  if (!parsed?.phone || parsed.phone !== digits) throw new Error("OTP_TELEFONO_INVALIDO");
  if (!parsed?.exp || Date.now() > parsed.exp) throw new Error("OTP_CADUCADO");

  const codeHash = crypto.createHash("sha256").update(`${digits}:${String(code || "").trim()}:${getOtpSecret()}`).digest("hex");
  if (!parsed?.hash || !safeEqual(parsed.hash, codeHash)) throw new Error("CODIGO_INVALIDO");

  return true;
}

export async function sendWhatsappVerification(phoneE164: string, code: string) {
  const phone = formatE164FromDigits(phoneE164);
  if (!phone) throw new Error("TELEFONO_INVALIDO");

  const body = `Tu código de acceso a Tarot Celestial es: ${code}`;

  return twilioMessagesRequest({
    From: getWhatsappFrom(),
    To: `whatsapp:${phone}`,
    Body: body,
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
