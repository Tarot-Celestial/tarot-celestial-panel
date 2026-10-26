export type WhatsAppDraftContact = {
  id: string;
  name: string;
  phone: string;
  consent_status: "pending" | "confirmed" | "withdrawn";
  consent_note: string;
};
export type WhatsAppDraftSlot = {
  slot: 1 | 2;
  label: string;
  sender_phone: string;
  message: string;
  image_url: string;
  contacts: WhatsAppDraftContact[];
};
export type WhatsAppDraft = { version: number; updated_at: string | null; slots: WhatsAppDraftSlot[] };
export type WhatsAppContactResolution = { phone: string; match: "unique" | "none" | "ambiguous" | "blocked"; name: string };
export const WHATSAPP_DRAFT_MAX_CONTACTS = 300;
export const WHATSAPP_DRAFT_IMAGE_BUCKET = "admin-whatsapp-campaign-images";
export const WHATSAPP_DRAFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function blankWhatsAppDraftSlots(): WhatsAppDraftSlot[] {
  return ([1, 2] as const).map(slot => ({ slot, label: `Número ${slot}`, sender_phone: "", message: "", image_url: "", contacts: [] }));
}

function text(value: unknown, max: number, label: string, multiline = false): string {
  if (typeof value !== "string") throw new Error(`${label}: usa texto.`);
  const normalized = value.trim();
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (normalized.length > max || controls.test(normalized)) throw new Error(`${label}: máximo ${max} caracteres, sin caracteres de control.`);
  return normalized;
}

/** Never infer a country code from a local number or from the administrator's locale. */
export function normalizeWhatsAppDraftPhone(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^(?:\+|00)[0-9 ()\.\-]+$/.test(raw)) throw new Error("Indica el teléfono con prefijo internacional, por ejemplo +34600111222.");
  const compact = raw.replace(/[ ()\.\-]/g, "").replace(/^00/, "+");
  if (!/^\+[1-9][0-9]{7,14}$/.test(compact)) throw new Error("El teléfono internacional debe tener entre 8 y 15 dígitos.");
  return compact;
}

export function safeWhatsAppDraftImage(value: unknown, supabaseUrl?: string): string {
  const raw = text(value, 2000, "Imagen");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || /[\s\\]/.test(raw)) throw new Error();
    const ownStorage = supabaseUrl ? new URL(supabaseUrl).origin : null;
    const trustedStorage = ownStorage === url.origin && url.pathname.startsWith("/storage/v1/object/public/");
    const trustedSite = url.origin === "https://clientestarotcelestial.es" && url.pathname.startsWith("/images/");
    if ((!trustedStorage && !trustedSite) || !/\.(png|jpe?g|webp)$/i.test(url.pathname)) throw new Error();
    return url.href;
  } catch { throw new Error("Usa una imagen JPG, PNG o WebP del sitio o del almacenamiento de Tarot Celestial."); }
}

export function normalizeWhatsAppDraftSlots(raw: unknown, options: { supabaseUrl?: string } = {}): WhatsAppDraftSlot[] {
  if (!Array.isArray(raw) || raw.length !== 2) throw new Error("El borrador debe contener los espacios 1 y 2.");
  const phones = new Set<string>(), contactIds = new Set<string>(), slots = new Set<number>(), senders = new Set<string>();
  return raw.map((value: any): WhatsAppDraftSlot => {
    if (!value || ![1, 2].includes(value.slot) || slots.has(value.slot)) throw new Error("Los espacios 1 y 2 deben aparecer una sola vez.");
    slots.add(value.slot);
    const label = text(value.label, 80, "Nombre de la lista");
    const senderPhone = value.sender_phone === "" ? "" : normalizeWhatsAppDraftPhone(value.sender_phone);
    if (senderPhone && senders.has(senderPhone)) throw new Error("Cada espacio debe usar un número remitente diferente.");
    if (senderPhone) senders.add(senderPhone);
    const message = text(value.message, 1500, "Mensaje", true);
    if (/\{\{|\}\}/.test(message.replace(/\{\{nombre\}\}/g, ""))) throw new Error("El único marcador permitido es {{nombre}}.");
    if (!Array.isArray(value.contacts) || value.contacts.length > WHATSAPP_DRAFT_MAX_CONTACTS) throw new Error("Cada lista admite hasta 300 contactos.");
    const contacts = value.contacts.map((item: any): WhatsAppDraftContact => {
      if (!item || typeof item.id !== "string" || !WHATSAPP_DRAFT_UUID.test(item.id) || contactIds.has(item.id.toLowerCase())) throw new Error("Cada contacto necesita un identificador único.");
      contactIds.add(item.id.toLowerCase());
      const phone = normalizeWhatsAppDraftPhone(item.phone);
      if (phones.has(phone)) throw new Error(`El teléfono ${phone} está repetido entre las listas.`);
      phones.add(phone);
      if (!["pending", "confirmed", "withdrawn"].includes(item.consent_status)) throw new Error("Revisa el estado del consentimiento.");
      const consentNote = text(item.consent_note, 500, "Nota de consentimiento");
      if (item.consent_status === "confirmed" && consentNote.length < 3) throw new Error("Indica de dónde y cuándo se obtuvo el consentimiento para WhatsApp.");
      return { id: item.id.toLowerCase(), name: text(item.name, 160, "Nombre"), phone, consent_status: item.consent_status, consent_note: consentNote };
    });
    return { slot: value.slot, label, sender_phone: senderPhone, message, image_url: safeWhatsAppDraftImage(value.image_url, options.supabaseUrl), contacts };
  }).sort((a, b) => a.slot - b.slot);
}

export function renderWhatsAppDraftMessage(message: string, name: string): string {
  return message.replace(/\{\{nombre\}\}/g, () => name.trim() || "[Falta nombre]");
}

/** Import prepares contacts only; CRM matching never implies marketing consent. */
export function parseWhatsAppContactLines(input: string): { contacts: WhatsAppDraftContact[]; errors: { line: number; message: string }[] } {
  const contacts: WhatsAppDraftContact[] = [], errors: { line: number; message: string }[] = [], phones = new Set<string>();
  const lines = input.split(/\r?\n/);
  if (lines.filter(line => line.trim()).length > WHATSAPP_DRAFT_MAX_CONTACTS) return { contacts, errors: [{ line: 0, message: "Importa como máximo 300 contactos por lista." }] };
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parts = line.split(/[;\t]/);
      if (parts.length > 2) throw new Error("Usa teléfono;nombre, un contacto por línea.");
      const phone = normalizeWhatsAppDraftPhone(parts[0]), name = text(parts[1] || "", 160, "Nombre");
      if (phones.has(phone)) throw new Error("El teléfono está repetido en este lote.");
      phones.add(phone);
      contacts.push({ id: crypto.randomUUID(), name, phone, consent_status: "pending", consent_note: "" });
    } catch (error: any) { errors.push({ line: index + 1, message: error.message }); }
  });
  return { contacts, errors };
}
