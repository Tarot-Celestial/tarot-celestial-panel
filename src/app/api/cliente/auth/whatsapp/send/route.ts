import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;

const client = twilio(accountSid, authToken);

// ----------------------------
// HELPERS
// ----------------------------
export function normalizePhone(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

export function formatE164FromDigits(phone: string): string {
  if (!phone) return "";
  if (phone.startsWith("34")) return `+${phone}`;
  return `+34${phone}`;
}

// ----------------------------
// DB
// ----------------------------
export async function findClienteByPhone(phoneDigits: string) {
  const { data, error } = await supabase
    .from("crm_clientes")
    .select("*")
    .ilike("telefono", `%${phoneDigits}%`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ----------------------------
// WHATSAPP VERIFY (CLAVE)
// ----------------------------
export async function sendWhatsappVerification(phone: string) {
  if (!phone) throw new Error("PHONE_REQUIRED");

  const verification = await client.verify.v2
    .services(verifyServiceSid)
    .verifications.create({
      to: `whatsapp:${phone}`, // 🔥 CLAVE
      channel: "whatsapp",     // 🔥 CLAVE
    });

  return verification;
}

// ----------------------------
// VERIFY CODE
// ----------------------------
export async function checkWhatsappVerification(phone: string, code: string) {
  const check = await client.verify.v2
    .services(verifyServiceSid)
    .verificationChecks.create({
      to: `whatsapp:${phone}`,
      code,
    });

  return check;
}
