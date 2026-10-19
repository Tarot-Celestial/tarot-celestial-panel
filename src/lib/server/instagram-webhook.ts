import { createHmac, timingSafeEqual } from 'node:crypto';

export function validInstagramSignature(raw: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const actual = Buffer.from(signature.toLowerCase());
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function instagramWebhookEvents(body: any, accountId: string) {
  const events = new Map<string, { event_key: string; account_id: string; kind: string; remote_id: string }>();
  if (body?.object !== 'instagram') return [];
  function add(kind: string, id: unknown) {
    if (typeof id !== 'string' || !id || id.length > 500) return;
    const key = `${accountId}:${kind}:${id}`;
    events.set(key, { event_key: key, account_id: accountId, kind, remote_id: id });
  }
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    if (String(entry.id) !== accountId) continue;
    for (const message of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (message.message?.mid) add(message.message.is_echo ? 'echo' : 'message', message.message.mid);
    }
    const changes = entry.field ? [entry, ...(entry.changes || [])] : entry.changes || [];
    for (const change of Array.isArray(changes) ? changes : []) {
      if (change.field === 'comments') add('comment', change.value?.id || change.value?.comment_id);
    }
  }
  return [...events.values()];
}
