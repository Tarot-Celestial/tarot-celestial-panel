import { normalizePhone } from "./central-assistant";

export const CAPTACION_BENEFITS_IMAGE = "/images/captacion/tarot-celestial-beneficios-v1.png";
export const CAPTACION_ORACLE_URL = "https://clientestarotcelestial.es/cliente/oraculo";

export type CaptacionMessageContact = {
  id: string;
  latest_meta_lead_at?: string | null;
  cliente?: {
    nombre?: string | null;
    apellido?: string | null;
    telefono?: string | null;
  } | null;
};

export function captacionContactName(contact: CaptacionMessageContact) {
  return [contact.cliente?.nombre, contact.cliente?.apellido]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function buildCaptacionMessage(contact: CaptacionMessageContact) {
  const name = captacionContactName(contact);
  return `Hola${name ? `, ${name}` : ""} 💜
Somos el equipo de Tarot Celestial. ¡Gracias por tu interés!

Aquí tus consultas vienen con más beneficios:
🎡 3 niveles de compra: cada nivel te da acceso a una ruleta con mejores premios.
🪙 Recibe Coins según el nivel de tu compra.
👑 Sube de rango y descubre más beneficios.
🔮 Prueba el Oráculo: tu primera tirada de cartas es gratis.

Regístrate y descubre tu espacio aquí:
${CAPTACION_ORACLE_URL}

Te comparto una imagen para que veas cómo funciona. ¿Te ayudo a empezar? ✨`;
}

/** Preserve a supplied country prefix; never infer one from the central or browser. */
export function captacionWhatsAppPhone(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw || !/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return null;
  const explicitPrefix = raw.startsWith("+") || raw.startsWith("00");
  const digits = raw.replace(/\D/g, "");
  // Local 9/10-digit numbers need the central to confirm the country prefix.
  if (!explicitPrefix && digits.length < 11) return null;
  const normalized = normalizePhone(raw);
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized.slice(1) : null;
}

export function buildCaptacionWhatsAppUrl(phone: string | null | undefined, message: string) {
  const digits = captacionWhatsAppPhone(phone);
  return digits && message.trim() ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}
