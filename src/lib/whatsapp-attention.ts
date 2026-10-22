export const WHATSAPP_ATTENTION_REFRESH = 'tc-whatsapp-changed';

export type WhatsAppAttentionItem = {
  id: string;
  name: string;
  unread: number;
  last_incoming_id: string | null;
  last_incoming_at: string | null;
};
export type WhatsAppAttentionSnapshot = {
  count: number;
  unreadChats: number;
  error: string;
  accountId: string | null;
  session: string | null;
};
export type WhatsAppAttentionNotice = {
  key: string;
  initial: boolean;
  count: number;
  items: WhatsAppAttentionItem[];
};

export function parseWhatsAppAttention(value: unknown): WhatsAppAttentionItem[] {
  if (!Array.isArray(value)) throw new Error('No se pudieron comprobar los mensajes de WhatsApp.');
  const items = new Map<string, WhatsAppAttentionItem>();
  for (const row of value) {
    if (!row || typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.unread) || row.unread <= 0) continue;
    items.set(row.id, {
      id: row.id,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 120) : 'Un contacto',
      unread: row.unread,
      last_incoming_id: typeof row.last_incoming_id === 'string' && row.last_incoming_id ? row.last_incoming_id.slice(0, 200) : null,
      last_incoming_at: typeof row.last_incoming_at === 'string' && Number.isFinite(Date.parse(row.last_incoming_at)) ? row.last_incoming_at : null,
    });
  }
  return [...items.values()];
}

export function whatsAppAttentionMessage(notice: WhatsAppAttentionNotice) {
  const pending = `${notice.count} ${notice.count === 1 ? 'mensaje sin leer' : 'mensajes sin leer'} en WhatsApp`;
  if (notice.initial) return `Tienes ${pending}. Abre la bandeja para revisar las conversaciones pendientes.`;
  const names = notice.items.slice(0, 2).map(item => item.name).join(' y ');
  return `Hay mensajes nuevos${names ? ` de ${names}${notice.items.length > 2 ? ' y otros contactos' : ''}` : ''}. Tienes ${pending}.`;
}
