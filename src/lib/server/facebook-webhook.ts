import { createHmac, timingSafeEqual } from 'node:crypto';

export function validFacebookSignature(raw: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const actual = Buffer.from(signature.toLowerCase());
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export type FacebookEvent = { kind: 'message' | 'comment'; remoteId: string; threadRemoteId: string; occurredAt: string; text: string; senderName: string; senderId: string; postId?: string; deleted?: boolean };
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_:.=-]{1,500}$/.test(v);
// Graph accepts the bare comment ID. Feed edit/remove may omit post_id, so use
// that same identity for storage and unread activity regardless of delivery shape.
// Only numeric comment IDs are normalized; Messenger IDs are never rewritten.
export function facebookCommentId(value: string) {
  return /^\d+_\d+$/.test(value) ? value.split('_')[1] : value;
}
function time(value: unknown, milliseconds = false) {
  const parsed = typeof value === 'number' ? value * (milliseconds ? 1 : 1000) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= Date.now() + 60000 ? new Date(parsed).toISOString() : null;
}

// Signature verification is the caller's responsibility. No Graph calls are
// necessary to ingest an authenticated event, including comments on old posts.
export function facebookWebhookEvents(body: any, pageId: string): FacebookEvent[] {
  if (body?.object !== 'page' || !Array.isArray(body.entry)) return [];
  const events = new Map<string, FacebookEvent>();
  for (const entry of body.entry) {
    if (String(entry.id) !== pageId) continue;
    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!id(item.message?.mid) || item.message.is_echo === true || !id(item.sender?.id) || item.sender.id === pageId || String(item.recipient?.id) !== pageId) continue;
      const occurredAt = time(item.timestamp, true);
      if (!occurredAt) continue;
      events.set(`message:${item.message.mid}`, { kind: 'message', remoteId: item.message.mid, threadRemoteId: item.sender.id,
        occurredAt, text: String(item.message.text || '[Contenido adjunto en Messenger]').slice(0, 10000), senderName: 'Conversación de Facebook', senderId: item.sender.id });
    }
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change?.value;
      if (change.field !== 'feed' || value?.item !== 'comment' || !['add', 'edited', 'edit', 'remove'].includes(value.verb) || !id(value.comment_id)) continue;
      const senderId = String(value.from?.id || value.sender_id || '');
      if (senderId === pageId && value.verb !== 'remove') continue;
      const occurredAt = time(value.created_time) || time(entry.time);
      if (!occurredAt) continue;
      const postId = id(value.post_id) ? value.post_id : undefined;
      const commentId = facebookCommentId(value.comment_id);
      events.set(`comment:${commentId}`, { kind: 'comment', remoteId: commentId, threadRemoteId: commentId,
        occurredAt, text: String(value.message || '').slice(0, 10000), senderName: String(value.from?.name || value.sender_name || 'Contacto de Facebook'),
        senderId: id(senderId) ? senderId : '', postId, deleted: value.verb === 'remove' });
    }
  }
  return [...events.values()];
}
