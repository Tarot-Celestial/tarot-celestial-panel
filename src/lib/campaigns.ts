export type CampaignAudience = { mode: "all" | "selected" | "segment"; client_ids: string[]; country: string; inactive_days: number | null };
export type CampaignDraft = { title: string; message: string; image_url: string; action_url: string; expires_at: string; channels: ("panel" | "push")[]; audience: CampaignAudience };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function safeCampaignUrl(value: unknown, image = false): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > 2000 || /[\u0000-\u0020\\]/.test(text)) throw new Error("El enlace no es válido.");
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  try { const url = new URL(text); if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2000) return url.href; } catch {}
  throw new Error(image ? "La imagen debe usar HTTPS o una ruta del sitio." : "El enlace debe usar HTTPS o una ruta del sitio.");
}
export function normalizeAudience(raw: any): CampaignAudience {
  const mode = raw?.mode;
  if (!["all", "selected", "segment"].includes(mode)) throw new Error("Selecciona los destinatarios.");
  const ids = Array.from(new Set<string>(Array.isArray(raw?.client_ids) ? raw.client_ids : []));
  if (ids.length > 500 || ids.some(id => typeof id !== "string" || !UUID.test(id))) throw new Error("La selección de clientes no es válida (máximo 500).");
  if (mode === "selected" && !ids.length) throw new Error("Selecciona al menos un cliente.");
  const country = mode === "segment" ? String(raw?.country || "").trim() : "";
  const inactive = mode === "segment" && raw?.inactive_days !== null && raw?.inactive_days !== "" && raw?.inactive_days !== undefined ? Number(raw.inactive_days) : null;
  if (country.length > 100 || (inactive !== null && (!Number.isInteger(inactive) || inactive < 1 || inactive > 730))) throw new Error("Revisa el segmento y los días de inactividad.");
  return { mode, client_ids: mode === "selected" ? ids : [], country, inactive_days: inactive };
}
export function normalizeCampaign(raw: any, now = Date.now()): CampaignDraft {
  const title = String(raw?.title || "").trim(), message = String(raw?.message || "").trim();
  if (!title || title.length > 100 || !message || message.length > 1500) throw new Error("Escribe un título (hasta 100 caracteres) y un mensaje (hasta 1500).");
  if (!Array.isArray(raw?.channels) || !raw.channels.length || raw.channels.some((c: string) => !["panel", "push"].includes(c))) throw new Error("Selecciona panel o notificación móvil. WhatsApp todavía no está conectado.");
  const expires = Date.parse(raw.expires_at);
  if (!Number.isFinite(expires) || expires <= now) throw new Error("La caducidad debe ser una fecha futura.");
  return { title, message, image_url: safeCampaignUrl(raw.image_url, true), action_url: safeCampaignUrl(raw.action_url), expires_at: new Date(expires).toISOString(), channels: Array.from(new Set(raw.channels)), audience: normalizeAudience(raw.audience) };
}
export function isTrustedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
      (u.hostname === "fcm.googleapis.com" || u.hostname === "updates.push.services.mozilla.com" || u.hostname.endsWith(".push.services.mozilla.com") || u.hostname === "web.push.apple.com" || u.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export const CAMPAIGN_STATUS: Record<string, string> = { draft: "Borrador", scheduled: "Programada", running: "En curso", completed: "Finalizada", cancelled: "Cancelada", pending: "Pendiente", processing: "Procesando", sent: "Enviado", failed: "Fallido", skipped: "Omitido", uncertain: "Sin confirmación" };
