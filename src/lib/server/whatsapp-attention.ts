// WhatsApp service chats can use a one-character user part (e.g. 0).
const JID_RE = /^[0-9A-Za-z.:_-]{1,80}@(s\.whatsapp\.net|lid|g\.us)$/;
type Row = Record<string, any>;

/** Validate the gateway snapshot and expose only the global badge's metadata. */
export function parseWhatsAppAttention(raw: Row, expectedSession: string) {
  const invalid = () => { throw new Error("WHATSAPP_ATTENTION_UNAVAILABLE"); };
  if (!raw || raw.ok !== true || raw.session !== expectedSession || !JID_RE.test(raw.account_id || "")
      || typeof raw.rev !== "string" || raw.rev.length > 100
      || typeof raw.server_time !== "string" || !Number.isFinite(Date.parse(raw.server_time))
      || !Array.isArray(raw.items) || raw.items.length > 1500
      || !Number.isSafeInteger(raw.unread_total) || raw.unread_total < 0
      || !Number.isSafeInteger(raw.unread_chats) || raw.unread_chats !== raw.items.length) invalid();
  const ids = new Set<string>();
  let total = 0;
  const items = raw.items.map((item: Row) => {
    if (!item || typeof item.id !== "string" || !JID_RE.test(item.id) || ids.has(item.id)
        || !Number.isSafeInteger(item.unread) || item.unread < 1
        || (item.last_incoming_id !== null && (typeof item.last_incoming_id !== "string" || !item.last_incoming_id || item.last_incoming_id.length > 200))
        || (item.last_incoming_at !== null && (typeof item.last_incoming_at !== "string" || !Number.isFinite(Date.parse(item.last_incoming_at))))) invalid();
    ids.add(item.id);
    total += item.unread;
    return {
      id: item.id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 80) : null,
      unread: item.unread,
      last_incoming_id: item.last_incoming_id,
      last_incoming_at: item.last_incoming_at,
    };
  });
  if (!Number.isSafeInteger(total) || total !== raw.unread_total) invalid();
  return { ok: true, session: expectedSession, account_id: raw.account_id, rev: raw.rev,
    server_time: raw.server_time, unread_total: total, unread_chats: items.length, items };
}
