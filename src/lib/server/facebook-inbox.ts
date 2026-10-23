import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { facebookConnection, facebookGraph, FacebookError, facebookId, facebookDate, facebookReplyWindow, verifyFacebookAccount, type FacebookAccount } from './facebook-graph';
import { recordSocialActivity, removeSocialActivity, socialThreadUnread, markSocialThreadRead, acquireSocialSync, finishSocialSync, socialSyncState } from './social-inbox-activity';
import { facebookCommentId, facebookWebhookEvents } from './facebook-webhook';
import type { InstagramMessage, InstagramThread } from '@/lib/instagram-inbox';

const THREADS = 'tc_facebook_threads';
const SENDS = 'tc_facebook_sends';
type Kind = 'message' | 'comment';
type ThreadRow = { id: string; account_id: string; kind: Kind; remote_id: string; recipient_id: string | null; conversation_id: string | null; post_id: string | null; name: string; preview: string; remote_created_at: string | null; remote_updated_at: string; permalink: string | null; last_reply_at: string | null; private_reply_sent: boolean; is_deleted: boolean };
type Incoming = { kind: Kind; remoteId: string; threadRemoteId: string; occurredAt: string };
type TrackedPost = { id: string; permalink?: string; after?: string | null; registeredBy: string; registeredAt: string; lastCheckedAt?: string; complete?: boolean; error?: string | null };
type SyncCursor = { posts?: string | null; conversations?: string | null; pendingPosts?: Array<{ id: string; permalink?: string; after?: string | null }>; trackedPosts?: TrackedPost[]; trackedPostIndex?: number; commentError?: string | null; messageError?: string | null; commentsCompleteAt?: string; accountVerified?: boolean };
const cursorToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_=+/-]{1,2048}$/.test(value) ? value : null;
const next = (value: any) => value?.paging?.next ? cursorToken(value.paging?.cursors?.after) : null;
const dataArray = (value: any): any[] => {
  if (!Array.isArray(value?.data)) throw new FacebookError('META_INVALID_RESPONSE', 'Facebook no devolvió una lista válida. Actualiza en unos instantes.');
  return value.data;
};

async function persist(account: FacebookAccount, rows: Array<Partial<ThreadRow>>, activity: Incoming[]) {
  if (rows.length) {
    const unique = new Map<string, Partial<ThreadRow>>();
    for (const row of rows) {
      const key = `${row.kind}:${row.remote_id}`, previous = unique.get(key);
      if (!previous || String(row.remote_updated_at) >= String(previous.remote_updated_at)) unique.set(key, row);
    }
    const result = await supabaseAdmin().rpc('tc_facebook_ingest_threads', { p_rows: [...unique.values()].map(row => ({ ...row, account_id: account.accountId })) });
    if (result.error) throw result.error;
  }
  await recordSocialActivity('facebook', account.accountId, activity);
}

function messageIdentity(account: FacebookAccount, participants: any[], messages: any[]) {
  const ids = new Set<string>();
  for (const participant of participants) if (facebookId(participant?.id) && participant.id !== account.accountId) ids.add(participant.id);
  for (const message of messages) {
    if (facebookId(message.from?.id) && message.from.id !== account.accountId) ids.add(message.from.id);
    for (const actor of message.to?.data || []) if (facebookId(actor?.id) && actor.id !== account.accountId) ids.add(actor.id);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

async function syncMessages(account: FacebookAccount, cursor: SyncCursor, deadline: number) {
  const params = { platform: 'messenger', fields: 'id,updated_time,participants,messages.limit(20){id,message,created_time,from,to}', limit: '20' };
  const newest = await facebookGraph(account, `${account.accountId}/conversations`, params, undefined, deadline);
  const result = cursorToken(cursor.conversations) ? await facebookGraph(account, `${account.accountId}/conversations`, { ...params, after: cursor.conversations! }, undefined, deadline) : newest;
  const rows: Array<Partial<ThreadRow>> = [], activity: Incoming[] = [];
  const conversations = new Map([...dataArray(newest), ...dataArray(result)].map(conversation => [conversation.id, conversation]));
  for (const conversation of conversations.values()) {
    if (!facebookId(conversation.id) || !facebookDate(conversation.updated_time)) continue;
    const messages = conversation.messages?.data || [], people = conversation.participants?.data || [];
    const peerId = messageIdentity(account, people, messages);
    if (!peerId) continue;
    const person = people.find((p: any) => p.id === peerId);
    const latest = messages.filter((m: any) => facebookDate(m.created_time)).sort((a: any, b: any) => facebookDate(b.created_time)!.localeCompare(facebookDate(a.created_time)!))[0];
    rows.push({ kind: 'message', remote_id: peerId, recipient_id: peerId, conversation_id: conversation.id, name: person?.name || 'Conversación de Facebook',
      preview: latest?.message || 'Abrir conversación', remote_updated_at: facebookDate(conversation.updated_time)! });
    for (const message of messages) if (facebookId(message.id) && message.from?.id === peerId && facebookDate(message.created_time)) {
      activity.push({ kind: 'message', remoteId: message.id, threadRemoteId: peerId, occurredAt: facebookDate(message.created_time)! });
    }
  }
  await persist(account, rows, activity);
  cursor.conversations = next(result);
}

async function syncCommentPage(account: FacebookAccount, post: { id: string; permalink?: string; after?: string | null }, deadline: number) {
  const result = await facebookGraph(account, `${post.id}/comments`, { fields: 'id,message,created_time,from,permalink_url', filter: 'stream', order: 'reverse_chronological', limit: '50', ...(cursorToken(post.after) ? { after: post.after! } : {}) }, undefined, deadline);
  const rows: Array<Partial<ThreadRow>> = [], activity: Incoming[] = [];
  for (const comment of dataArray(result)) {
    const when = facebookDate(comment.created_time);
    if (!facebookId(comment.id) || !when || comment.from?.id === account.accountId) continue;
    const commentId = facebookCommentId(comment.id);
    rows.push({ kind: 'comment', remote_id: commentId, recipient_id: facebookId(comment.from?.id) ? comment.from.id : null, post_id: post.id,
      name: comment.from?.name || 'Contacto de Facebook', preview: String(comment.message || ''), remote_created_at: when, remote_updated_at: when,
      permalink: comment.permalink_url || post.permalink || null });
    activity.push({ kind: 'comment', remoteId: commentId, threadRemoteId: commentId, occurredAt: when });
  }
  await persist(account, rows, activity);
  const after = next(result);
  if (result.paging?.next && (!after || after === post.after)) throw new FacebookError('META_INVALID_CURSOR', 'Facebook no devolvió una continuación válida. Se conservan los comentarios recibidos.');
  return { processed: rows.length, after };
}

async function syncPublishedComments(account: FacebookAccount, cursor: SyncCursor, deadline: number) {
  // Every cycle checks the newest posts and advances a bounded older-post sweep.
  // Webhooks ingest comments on any post immediately, independent of this sweep.
  const newest = await facebookGraph(account, `${account.accountId}/posts`, { fields: 'id,permalink_url', limit: '4' }, undefined, deadline);
  const pending = [...(cursor.pendingPosts || [])];
  if (pending.length < 4) {
    const older = cursorToken(cursor.posts) ? await facebookGraph(account, `${account.accountId}/posts`, { fields: 'id,permalink_url', limit: '4', after: cursor.posts! }, undefined, deadline) : newest;
    for (const post of dataArray(older)) if (facebookId(post.id)) pending.push({ id: post.id, permalink: post.permalink_url });
    cursor.posts = next(older);
  }
  const posts = [...dataArray(newest).filter(post => facebookId(post.id)).map(post => ({ id: post.id, permalink: post.permalink_url, after: null })), ...pending.splice(0, 4)];
  const seen = new Set<string>();
  for (const post of posts) {
    const key = `${post.id}:${post.after || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (Date.now() > deadline - 1500) { pending.push(post); continue; }
    try {
      const result = await syncCommentPage(account, post, deadline);
      if (result.after) pending.push({ ...post, after: result.after });
    } catch (error) {
      const remaining = posts.slice(posts.indexOf(post));
      cursor.pendingPosts = [...remaining, ...pending].slice(0, 32);
      throw error;
    }
  }
  cursor.pendingPosts = pending.slice(0, 32);
  if (!cursor.posts && !cursor.pendingPosts.length) cursor.commentsCompleteAt = new Date().toISOString();
}

const trackedPosts = (cursor: SyncCursor) => (Array.isArray(cursor.trackedPosts) ? cursor.trackedPosts : []).filter(post => /^\d+(?:_\d+)?$/.test(post?.id || '')).slice(0, 20);

async function syncTrackedPost(account: FacebookAccount, post: TrackedPost, deadline: number, continueHistory = true) {
  const pendingAfter = cursorToken(post.after);
  let processed = 0;
  try {
    // Check new comments even while an older page is waiting. A completed sweep
    // may start again; deduplication preserves staff review state throughout.
    const newest = await syncCommentPage(account, { ...post, after: null }, deadline);
    processed += newest.processed;
    if (!pendingAfter) { post.after = newest.after; post.complete = !newest.after; }
    if (pendingAfter && continueHistory && Date.now() < deadline - 1500) {
      const older = await syncCommentPage(account, { ...post, after: pendingAfter }, deadline);
      processed += older.processed;
      post.after = older.after;
      post.complete = !older.after;
    }
    post.error = null;
    return processed;
  } catch (error) {
    post.error = error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE';
    throw error;
  } finally { post.lastCheckedAt = new Date().toISOString(); }
}

async function syncTrackedComments(account: FacebookAccount, cursor: SyncCursor, deadline: number) {
  const tracked = trackedPosts(cursor);
  cursor.trackedPosts = tracked;
  if (!tracked.length) return;
  const index = Math.max(0, Number.isSafeInteger(cursor.trackedPostIndex) ? cursor.trackedPostIndex! : 0) % tracked.length;
  cursor.trackedPostIndex = (index + 1) % tracked.length;
  await syncTrackedPost(account, tracked[index], deadline);
}

async function syncComments(account: FacebookAccount, cursor: SyncCursor, deadline: number) {
  // An ad post can be readable even when it is absent from the published feed.
  const results = await Promise.allSettled([syncPublishedComments(account, cursor, deadline), syncTrackedComments(account, cursor, deadline)]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export async function facebookSyncPost(userId: string, input: any) {
  const postId = typeof input?.postId === 'string' ? input.postId.trim() : '';
  if (!/^\d{1,40}(?:_\d{1,40})?$/.test(postId)) throw new FacebookError('INVALID_POST', 'Introduce el ID de la publicación de Facebook, no el identificador de la bandeja de anuncios.', 400);
  const db = supabaseAdmin();
  const worker = await db.from('workers').select('id').eq('user_id', userId).eq('role', 'admin').eq('is_active', true).limit(1);
  if (worker.error) throw worker.error;
  if (!worker.data?.length) throw new FacebookError('FORBIDDEN', 'Solo administración puede importar una publicación.', 403);
  const account = facebookConnection();
  await verifyFacebookAccount(account);
  const source = await facebookGraph(account, postId, { fields: 'id,from,permalink_url' });
  if (String(source.from?.id || '') !== account.accountId || !/^\d{1,40}(?:_\d{1,40})?$/.test(String(source.id || ''))) {
    throw new FacebookError('POST_OWNER_UNVERIFIED', 'Facebook no confirmó que esta publicación pertenezca a la página conectada. No se ha importado.', 409);
  }
  const lease = await acquireSocialSync('facebook', account.accountId, { force: true });
  if (!lease) throw new FacebookError('SYNC_BUSY', 'Facebook ya se está sincronizando. Espera unos segundos y vuelve a importar.', 409);
  const cursor: SyncCursor = lease.cursor;
  let errorCode: string | null = null;
  try {
    const tracked = trackedPosts(cursor);
    let post = tracked.find(item => item.id === source.id);
    if (!post) {
      if (tracked.length >= 20) throw new FacebookError('TRACKED_POST_LIMIT', 'Ya se siguen veinte publicaciones específicas. Administración debe revisar la lista antes de añadir otra.', 409);
      post = { id: source.id, registeredBy: userId, registeredAt: new Date().toISOString(), after: null, complete: false };
      tracked.push(post);
    }
    if (typeof source.permalink_url === 'string') post.permalink = source.permalink_url;
    cursor.trackedPosts = tracked;
    cursor.accountVerified = true;
    const processed = await syncTrackedPost(account, post, Date.now() + 25000);
    return { ok: true, postId: post.id, processed, complete: post.complete === true, continuationQueued: !!post.after, tracked: true };
  } catch (error) {
    errorCode = error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE';
    throw error;
  } finally {
    await finishSocialSync('facebook', account.accountId, lease.token, cursor, errorCode);
  }
}

export async function ensureFacebookFresh(account = facebookConnection()) {
  const lease = await acquireSocialSync('facebook', account.accountId, { cooldownSeconds: 60 });
  if (!lease) return null;
  const cursor: SyncCursor = lease.cursor;
  let firstError: string | null = null;
  try {
    await verifyFacebookAccount(account);
    cursor.accountVerified = true;
    const deadline = Date.now() + 35000;
    // Independent permissions: unavailable Messenger must not hide comments.
    await Promise.all(([['comment', syncComments], ['message', syncMessages]] as const).map(async ([kind, run]) => {
      try { await run(account, cursor, deadline); cursor[`${kind}Error`] = null; }
      catch (error) { const code = error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE'; cursor[`${kind}Error`] = code; firstError ||= code; }
    }));
  } catch (error) { firstError = error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE'; cursor.accountVerified = false; cursor.commentError = firstError; cursor.messageError = firstError; }
  finally { await finishSocialSync('facebook', account.accountId, lease.token, cursor, firstError); }
  return cursor;
}

export async function processFacebookWebhook(body: unknown) {
  const input = body as any;
  if (input?.object !== 'page' || !Array.isArray(input.entry) || !input.entry.some((entry: any) =>
    (Array.isArray(entry.messaging) && entry.messaging.some((item: any) => item?.message?.mid)) ||
    (Array.isArray(entry.changes) && entry.changes.some((change: any) => change?.field === 'feed' && change?.value?.item === 'comment')))) return { received: 0 };
  const account = facebookConnection();
  const events = facebookWebhookEvents(body, account.accountId);
  if (!events.length) return { received: 0 };
  const rows = events.map(event => ({ kind: event.kind, remote_id: event.threadRemoteId, recipient_id: event.senderId || null, post_id: event.postId || null,
    name: event.senderName, preview: event.text, remote_created_at: event.kind === 'comment' ? event.occurredAt : null, remote_updated_at: event.occurredAt,
    is_deleted: !!event.deleted }));
  // Multiple incoming messages from the same person share one conversation.
  const unique = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.kind}:${row.remote_id}`, previous = unique.get(key);
    if (!previous || row.remote_updated_at >= previous.remote_updated_at) unique.set(key, row);
  }
  await persist(account, [...unique.values()], events.filter(event => !event.deleted));
  const removed = events.filter(event => event.deleted).map(event => event.remoteId);
  if (removed.length) await removeSocialActivity('facebook', account.accountId, 'comment', removed);
  return { received: events.length };
}

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!facebookDate(cursor.before) || !/^[a-f\d-]{36}$/i.test(cursor.id)) throw Error();
    return { before: facebookDate(cursor.before)!, id: cursor.id as string };
  } catch { throw new FacebookError('INVALID_CURSOR', 'Actualiza la bandeja.', 400); }
}
const errorHint = (kind: Kind, code?: string | null) => !code ? null : code === 'META_PERMISSION'
  ? kind === 'message' ? 'Facebook necesita el permiso pages_messaging para cargar Messenger. Administración debe completar la conexión.' : 'Facebook necesita pages_read_user_content y pages_read_engagement para cargar los comentarios. Administración debe completar la conexión.'
  : 'No se pudo completar la sincronización con Facebook. Se conservan los elementos recibidos; vuelve a actualizar.';

export async function facebookInbox(kind: Kind, cursor: string | null) {
  const account = facebookConnection();
  const page = decodeCursor(cursor);
  const sync = (await socialSyncState('facebook', account.accountId)).cursor as SyncCursor;
  let query = supabaseAdmin().from(THREADS).select('*').eq('account_id', account.accountId).eq('kind', kind).eq('is_deleted', false)
    .order('remote_updated_at', { ascending: false }).order('id', { ascending: false }).limit(51);
  if (page) query = query.or(`remote_updated_at.lt.${page.before},and(remote_updated_at.eq.${page.before},id.lt.${page.id})`);
  const result = await query;
  if (result.error) throw result.error;
  const rows = (result.data || []) as ThreadRow[];
  const shown = rows.slice(0, 50);
  const unread = await socialThreadUnread('facebook', account.accountId, shown.map(row => row.remote_id));
  const syncError = sync?.[`${kind}Error`];
  const initialized = Object.prototype.hasOwnProperty.call(sync, `${kind}Error`);
  const hint = errorHint(kind, syncError) || (!initialized ? 'Preparando la primera sincronización de Facebook. Los elementos recibidos aparecerán automáticamente.'
    : kind === 'comment' && !sync.commentsCompleteAt ? 'Se están recuperando también los comentarios de publicaciones anteriores. Los nuevos avisos llegarán mediante la conexión de Meta.' : null);
  const last = shown[shown.length - 1];
  return { ok: true, connection: { username: account.username, connected: sync.accountVerified === true, ready: sync.accountVerified === true && initialized && !syncError, message: hint },
    threads: shown.map((row): InstagramThread => ({ id: row.id, kind: row.kind, name: row.name, preview: row.preview, updatedAt: row.remote_updated_at,
      permalink: row.permalink, unread: unread.get(row.remote_id) || 0 })),
    nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ before: last.remote_updated_at, id: last.id })).toString('base64url') : null,
    partialHint: hint };
}

async function threadForAccount(id: string, account: FacebookAccount) {
  if (!/^[a-f\d-]{36}$/i.test(id)) throw new FacebookError('INVALID_THREAD', 'Selecciona una conversación de la bandeja.', 400);
  const result = await supabaseAdmin().from(THREADS).select('*').eq('id', id).eq('account_id', account.accountId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.is_deleted) throw new FacebookError('NOT_FOUND', 'Actualiza la bandeja y selecciona la conversación.', 404);
  if (!facebookId(result.data.remote_id)) throw new FacebookError('INVALID_THREAD', 'La conversación de Facebook no es válida.');
  return result.data as ThreadRow;
}

async function loadMessages(account: FacebookAccount, row: ThreadRow) {
  const messages: InstagramMessage[] = [];
  let recipientId: string | null = null, lastInbound: string | null = null, incompleteHistory = false;
  if (row.kind === 'message') {
    let conversationId = row.conversation_id;
    if (!facebookId(conversationId)) {
      const lookup = await facebookGraph(account, `${account.accountId}/conversations`, { platform: 'messenger', user_id: row.remote_id, fields: 'id,participants', limit: '5' });
      const match = dataArray(lookup).find(c => facebookId(c.id) && messageIdentity(account, c.participants?.data || [], []) === row.remote_id);
      if (!match) throw new FacebookError('RECIPIENT_UNVERIFIED', 'Facebook todavía no permite abrir esta conversación. Actualiza en unos instantes.', 409);
      conversationId = match.id;
      const saved = await supabaseAdmin().from(THREADS).update({ conversation_id: conversationId }).eq('id', row.id).eq('account_id', account.accountId);
      if (saved.error) throw saved.error;
    }
    const result = await facebookGraph(account, `${conversationId}/messages`, { fields: 'id,message,created_time,from,to', limit: '25' });
    const records = dataArray(result);
    const peerId = messageIdentity(account, [], records);
    recipientId = peerId === row.remote_id ? peerId : null;
    for (const message of records) {
      const when = facebookDate(message.created_time);
      if (!facebookId(message.id) || !when || !facebookId(message.from?.id)) { incompleteHistory = true; continue; }
      const fromMe = message.from.id === account.accountId;
      if (!fromMe && message.from.id !== recipientId) { incompleteHistory = true; continue; }
      if (!fromMe && (!lastInbound || when > lastInbound)) lastInbound = when;
      messages.push({ id: message.id, text: String(message.message || '[Contenido adjunto: consúltalo en Facebook]'), fromMe, createdAt: when, senderName: message.from.name || (fromMe ? account.username : row.name) });
    }
    await recordSocialActivity('facebook', account.accountId, messages.filter(m => !m.fromMe).map(m => ({ kind: 'message', remoteId: m.id, threadRemoteId: row.remote_id, occurredAt: m.createdAt })));
  } else {
    const root = await facebookGraph(account, row.remote_id, { fields: 'id,message,created_time,from' });
    const replies = await facebookGraph(account, `${row.remote_id}/comments`, { fields: 'id,message,created_time,from', limit: '50' });
    for (const comment of [root, ...dataArray(replies)]) {
      const when = facebookDate(comment.created_time);
      if (!facebookId(comment.id) || !when) { incompleteHistory = true; continue; }
      messages.push({ id: comment.id, text: String(comment.message || ''), fromMe: comment.from?.id === account.accountId, createdAt: when, senderName: comment.from?.name || row.name });
    }
    incompleteHistory ||= !!next(replies);
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { messages, recipientId, lastInbound, incompleteHistory };
}

export async function facebookMessages(id: string, requestId?: string | null) {
  const observedAt = new Date().toISOString();
  const account = facebookConnection();
  await verifyFacebookAccount(account);
  const row = await threadForAccount(id, account);
  const loaded = await loadMessages(account, row);
  const canReply = row.kind === 'comment' || (!loaded.incompleteHistory && !!loaded.recipientId && facebookReplyWindow(loaded.lastInbound, 24));
  const pending = await supabaseAdmin().from(SENDS).select('request_id,status,created_at,body').eq('thread_id', id).in('status', ['sending', 'uncertain']).limit(1);
  if (pending.error) throw pending.error;
  const operation = pending.data?.[0];
  let requestStatus: string | null = null;
  if (requestId && /^[a-f\d-]{36}$/i.test(requestId)) {
    const receipt = await supabaseAdmin().from(SENDS).select('status').eq('request_id', requestId).eq('thread_id', id).maybeSingle();
    if (receipt.error) throw receipt.error;
    requestStatus = receipt.data?.status || 'not_found';
  }
  return { ok: true, messages: loaded.messages, observedAt, canReply: canReply && !operation, canPrivateReply: row.kind === 'message' && canReply && !operation,
    lastReplyAt: row.last_reply_at, privateReplySent: row.private_reply_sent, requestStatus,
    pendingSend: operation ? { requestId: operation.request_id, status: operation.status, createdAt: operation.created_at, text: operation.body } : null,
    replyHint: operation ? 'Hay un envío pendiente de confirmar. Comprueba su estado en Facebook antes de repetirlo.' : canReply ? null
      : loaded.incompleteHistory || !loaded.recipientId ? 'No se ha podido verificar todo el historial y el destinatario. Actualiza o continúa desde Facebook.'
      : 'Han pasado 24 horas desde el último mensaje del cliente. Podrás responder cuando vuelva a escribir.',
    privateReplyHint: row.kind === 'comment' ? 'Responde públicamente al comentario. La respuesta privada desde comentarios aún no está habilitada en esta conexión.' : null };
}

export async function facebookRead(userId: string, input: any) {
  const account = facebookConnection();
  const row = await threadForAccount(String(input?.threadId || ''), account);
  const through = facebookDate(input?.through);
  if (!through || Date.parse(through) > Date.now() || Date.now() - Date.parse(through) > 600000) throw new FacebookError('INVALID_READ', 'Actualiza la conversación antes de marcarla como leída.', 400);
  return markSocialThreadRead(userId, 'facebook', account.accountId, [row.remote_id], through);
}

export async function facebookSend(userId: string, input: any) {
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  const requestId = String(input?.requestId || '');
  const mode = input?.replyMode === 'public' ? 'public' : 'private';
  if (!text || text.length > 1000 || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(requestId)) throw new FacebookError('INVALID_MESSAGE', 'Escribe una respuesta de hasta 1.000 caracteres.', 400);
  const account = facebookConnection();
  await verifyFacebookAccount(account);
  const row = await threadForAccount(String(input.threadId || ''), account);
  const db = supabaseAdmin();
  const existing = await db.from(SENDS).select('*').eq('request_id', requestId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.thread_id !== row.id || existing.data.actor_user_id !== userId || existing.data.body !== text || existing.data.reply_mode !== mode) throw new FacebookError('OPERATION_CONFLICT', 'Este envío ya se utilizó para otra respuesta.', 409);
    if (['sent', 'confirmed_sent'].includes(existing.data.status)) return { ok: true, duplicate: true, messageId: existing.data.remote_message_id };
    throw new FacebookError(existing.data.status === 'failed' ? 'META_REJECTED' : 'SEND_UNCERTAIN', 'Este envío ya se ha intentado. Actualiza y comprueba la conversación antes de repetirlo.', 409);
  }
  const loaded = await loadMessages(account, row);
  if (row.kind === 'message' && loaded.incompleteHistory) throw new FacebookError('INCOMPLETE_HISTORY', 'Facebook no permite verificar todo el historial reciente. Actualiza o continúa desde Facebook antes de responder.', 409);
  if (row.kind === 'message' && !loaded.recipientId) throw new FacebookError('RECIPIENT_UNVERIFIED', 'No hemos podido verificar el destinatario. Actualiza o revisa la conversación en Facebook antes de responder.', 409);
  if (row.kind === 'message' && (!loaded.recipientId || !facebookReplyWindow(loaded.lastInbound, 24))) throw new FacebookError('REPLY_WINDOW_CLOSED', 'Espera a que la persona vuelva a escribir: han pasado 24 horas desde su último mensaje.', 409);
  if (row.kind === 'comment' && mode === 'private') throw new FacebookError('PRIVATE_REPLY_UNAVAILABLE', 'La respuesta privada desde comentarios aún no está habilitada. Responde públicamente o continúa desde Facebook.', 409);
  const claim = await db.rpc('tc_facebook_claim_send', { p_user: userId, p_thread: row.id, p_request: requestId, p_body: text, p_mode: mode, p_expected_reply: input.expectedLastReplyAt || null });
  if (claim.error) {
    const code = String(claim.error.message);
    throw new FacebookError(code, code === 'STALE_REPLY' ? 'Otra central ya respondió. Actualiza y revisa la conversación.' : 'Hay otra respuesta pendiente o este envío ya se ha registrado. Actualiza antes de continuar.', 409);
  }
  if (claim.data?.duplicate) return { ok: true, duplicate: true, messageId: claim.data.remote_message_id };
  try {
    const result = row.kind === 'comment' && mode === 'public'
      ? await facebookGraph(account, `${row.remote_id}/comments`, {}, { message: text })
      : await facebookGraph(account, `${account.accountId}/messages`, {}, { recipient: { id: loaded.recipientId }, messaging_type: 'RESPONSE', message: { text } });
    const remoteId = result.message_id || result.id;
    if (!remoteId) throw new FacebookError('SEND_UNCERTAIN', 'Facebook no confirmó el identificador del envío. Comprueba la conversación.');
    const finish = await db.rpc('tc_facebook_finish_send', { p_request: requestId, p_status: 'sent', p_remote_id: String(remoteId), p_error: null });
    if (finish.error) throw new FacebookError('SEND_UNCERTAIN', 'Facebook recibió el mensaje, pero no pudimos guardar el recibo. No lo repitas.');
    return { ok: true, messageId: String(remoteId) };
  } catch (error) {
    const uncertain = !(error instanceof FacebookError) || error.code === 'SEND_UNCERTAIN';
    await db.rpc('tc_facebook_finish_send', { p_request: requestId, p_status: uncertain ? 'uncertain' : 'failed', p_remote_id: null, p_error: error instanceof FacebookError ? error.code : 'UNKNOWN' });
    throw error;
  }
}

export async function facebookResolve(userId: string, input: any) {
  if (input?.confirmed !== true || !['sent', 'not_sent'].includes(input?.outcome) || !/^[a-f\d-]{36}$/i.test(String(input?.requestId || ''))) throw new FacebookError('CONFIRMATION_REQUIRED', 'Comprueba la conversación en Facebook y confirma el resultado.', 400);
  const account = await facebookConnection();
  const row = await threadForAccount(String(input.threadId || ''), account);
  const result = await supabaseAdmin().rpc('tc_facebook_resolve_send', { p_user: userId, p_thread: row.id, p_request: input.requestId, p_outcome: input.outcome });
  if (result.error) throw new FacebookError(result.error.message === 'SEND_IN_PROGRESS' ? 'SEND_IN_PROGRESS' : 'RESOLVE_FAILED', result.error.message === 'SEND_IN_PROGRESS' ? 'Espera un minuto desde el envío antes de comprobar el resultado.' : 'No se ha podido guardar la comprobación. Actualiza la conversación.', 409);
  return { ok: true };
}
