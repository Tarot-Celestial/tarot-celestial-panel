export const CAPTACION_ATTENTION_INTERVAL = 60_000;
export const CAPTACION_ATTENTION_REFRESH = 'tc-captacion-changed';
export const CAPTACION_FOCUS_LEAD = 'tc-captacion-focus-lead';

export type CaptacionAttentionItem = {
  id: string;
  cliente_id: string | null;
  nombre: string;
  latest_meta_lead_at: string;
};
export type CaptacionAttentionNotice = {
  key: string;
  announcedAt: number;
  items: CaptacionAttentionItem[];
};

// The server checks management timestamps and permissions; this additionally
// rejects malformed/future/expired original Meta dates in a cached response.
export function parseCaptacionAttention(items: unknown, now: number): CaptacionAttentionItem[] {
  if (!Array.isArray(items)) throw new Error('No se pudieron comprobar los contactos nuevos.');
  const unique = new Map<string, CaptacionAttentionItem>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.latest_meta_lead_at !== 'string') continue;
    const time = Date.parse(item.latest_meta_lead_at), age = now - time;
    if (!Number.isFinite(time) || age < 0 || age >= 24 * 60 * 60 * 1000) continue;
    const previous = unique.get(item.id);
    if (previous && Date.parse(previous.latest_meta_lead_at) >= time) continue;
    unique.set(item.id, {
      id: item.id,
      cliente_id: typeof item.cliente_id === 'string' ? item.cliente_id : null,
      nombre: typeof item.nombre === 'string' && item.nombre.trim() ? item.nombre.trim().slice(0, 120) : 'Un contacto',
      latest_meta_lead_at: item.latest_meta_lead_at,
    });
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.latest_meta_lead_at) - Date.parse(b.latest_meta_lead_at));
}

export function captacionAttentionMessage(items: CaptacionAttentionItem[]) {
  if (!items.length) return '';
  if (items.length === 1) return `${items[0].nombre} ha enviado un formulario y sigue pendiente de gestión. Vamos a atender este contacto en Captación.`;
  const names = items.slice(0, 2).map(item => item.nombre).join(' y ');
  return `Tienes ${items.length} contactos con formularios nuevos pendientes de gestión: ${names}${items.length > 2 ? ` y ${items.length - 2} más` : ''}. Vamos a atenderlos en Captación.`;
}

export function captacionAnnouncementDue(previousAt: unknown, now: number) {
  return typeof previousAt !== 'number' || !Number.isFinite(previousAt)
    || previousAt > now + CAPTACION_ATTENTION_INTERVAL || now - previousAt >= CAPTACION_ATTENTION_INTERVAL;
}
