import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

type ClienteAuthChannel = "whatsapp" | "email";

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function normalizePhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

export function normalizeEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
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

function getEmailFrom(): string {
  return process.env.CLIENTE_AUTH_EMAIL_FROM || "Tarot Celestial <acceso@tarotcelestial.app>";
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

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createOtpChallenge(phoneDigits: string, code: string, channel: ClienteAuthChannel) {
  const digits = normalizePhone(phoneDigits);
  const expiresAt = Date.now() + getOtpMinutes() * 60_000;
  const codeHash = crypto.createHash("sha256").update(`${channel}:${digits}:${code}:${getOtpSecret()}`).digest("hex");
  const payloadObj = { phone: digits, exp: expiresAt, hash: codeHash, channel };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

export function verifyOtpChallenge(challengeToken: string, phoneDigits: string, code: string, channel: ClienteAuthChannel) {
  const [payload, signature] = String(challengeToken || "").split(".");
  if (!payload || !signature) throw new Error("OTP_CHALLENGE_INVALIDO");

  const expectedSignature = signPayload(payload);
  if (!safeEqual(signature, expectedSignature)) throw new Error("OTP_CHALLENGE_INVALIDO");

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    phone?: string;
    exp?: number;
    hash?: string;
    channel?: ClienteAuthChannel;
  };

  const digits = normalizePhone(phoneDigits);
  if (!parsed?.phone || parsed.phone !== digits) throw new Error("OTP_TELEFONO_INVALIDO");
  if (!parsed?.exp || Date.now() > parsed.exp) throw new Error("OTP_CADUCADO");
  if (!parsed?.channel || parsed.channel !== channel) throw new Error("OTP_CANAL_INVALIDO");

  const codeHash = crypto.createHash("sha256").update(`${channel}:${digits}:${String(code || "").trim()}:${getOtpSecret()}`).digest("hex");
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

function buildEmailHtml(nombre: string | null | undefined, code: string) {
  const safeName = String(nombre || "").trim() || "";
  const greeting = safeName ? `Hola ${safeName},` : "Hola,";
  return `
    <div style="background:#0b0912;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#f5efe6;">
      <div style="max-width:560px;margin:0 auto;background:#14101d;border:1px solid rgba(215,181,109,0.22);border-radius:24px;padding:32px;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#d7b56d;font-weight:700;margin-bottom:12px;">Tarot Celestial · Acceso cliente</div>
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;color:#fff;">Tu código de acceso</h1>
        <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#ddd3c6;">${greeting} usa este código para entrar en tu panel privado.</p>
        <div style="margin:24px 0;padding:18px 22px;border-radius:18px;background:#1d1629;border:1px solid rgba(215,181,109,0.2);font-size:34px;font-weight:800;letter-spacing:.2em;text-align:center;color:#f8e7c0;">${code}</div>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#bfb6c8;">Caduca en ${getOtpMinutes()} minutos. Si no has pedido este acceso, puedes ignorar este mensaje.</p>
      </div>
    </div>
  `;
}

export async function sendEmailVerification(email: string, code: string, nombre?: string | null) {
  const to = normalizeEmail(email);
  if (!to) throw new Error("EMAIL_INVALIDO");

  const apiKey = getEnv("RESEND_API_KEY");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to: [to],
      subject: "Tu código de acceso a Tarot Celestial",
      html: buildEmailHtml(nombre, code),
      text: `Tu código de acceso a Tarot Celestial es: ${code}. Caduca en ${getOtpMinutes()} minutos.`,
    }),
    cache: "no-store",
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.message || json?.error || "EMAIL_SEND_ERROR";
    throw new Error(message);
  }

  return json as Record<string, any>;
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

function channelToLoginChannel(channel: ClienteAuthChannel): string {
  return channel === "email" ? "email_otp" : "whatsapp_otp";
}

export async function createClienteMagicLinkFromChannel(phoneDigits: string, origin: string, channel: ClienteAuthChannel) {
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
        login_channel: channelToLoginChannel(channel),
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

export function maskEmail(email: string | null | undefined): string {
  const value = normalizeEmail(email);
  if (!value || !value.includes("@")) return "tu e-mail";
  const [local, domain] = value.split("@");
  const safeLocal = local.length <= 2 ? `${local[0] || ""}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${safeLocal}@${domain}`;
}
