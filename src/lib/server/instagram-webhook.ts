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

/** Signed webhook payload; only verified account entries and inbound events. */
export function instagramInboundEvents(body: any, accountId: string, username: string) {
  type Event = {kind:'message'|'comment';remoteId:string;threadRemoteId:string;occurredAt:string;senderId:string|null;senderName:string;username:string|null;text:string};
  const events=new Map<string,Event>();
  const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_:.=-]{1,500}$/.test(value);
  const date=(value:unknown)=>{
    const time=typeof value==='number'?(value<1e12?value*1000:value):typeof value==='string'?Date.parse(value):NaN;
    return Number.isFinite(time)&&time>0&&time<=Date.now()+60000?new Date(time).toISOString():null;
  };
  if(body?.object!=='instagram')return [];
  for(const entry of Array.isArray(body.entry)?body.entry:[]) {
    if(String(entry.id)!==accountId)continue;
    for(const item of Array.isArray(entry.messaging)?entry.messaging:[]) {
      const when=date(item.timestamp),sender=item.sender?.id;
      if(!id(item.message?.mid)||!id(sender)||String(item.recipient?.id)!==accountId||sender===accountId||item.message?.is_echo||!when)continue;
      events.set('message:'+item.message.mid,{kind:'message',remoteId:item.message.mid,threadRemoteId:sender,occurredAt:when,senderId:sender,senderName:'Conversación de Instagram',username:null,text:String(item.message?.text || '[Contenido adjunto: consúltalo en Instagram]').slice(0,10000)});
    }
    const changes=entry.field?[entry,...(entry.changes||[])]:entry.changes||[];
    for(const change of Array.isArray(changes)?changes:[]) {
      const value=change.value,remote=value?.id||value?.comment_id,when=date(value?.timestamp)||date(entry.time);
      if(change.field!=='comments'||!id(remote)||!when||String(value?.from?.id)===accountId||String(value?.from?.username||'').toLowerCase()===username.toLowerCase())continue;
      events.set('comment:'+remote,{kind:'comment',remoteId:remote,threadRemoteId:remote,occurredAt:when,senderId:id(value?.from?.id)?value.from.id:null,senderName:value?.from?.username||'Comentario de Instagram',username:value?.from?.username||null,text:String(value?.text||'').slice(0,10000)});
    }
  }
  return [...events.values()];
}
