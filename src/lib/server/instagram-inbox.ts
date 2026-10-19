import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { instagramConnection, instagramGraph, InstagramError, graphId, replyWindowOpen, type InstagramAccount } from './instagram-graph';
import type { InstagramMessage, InstagramThread } from '@/lib/instagram-inbox';
import { resolveMessageIdentity } from './instagram-message-identity';

const THREADS = 'tc_instagram_threads';
const SENDS = 'tc_instagram_sends';
type ThreadRow = { id: string; account_id: string; kind: 'message' | 'comment'; remote_id: string; recipient_id: string | null; name: string; username: string | null; preview: string; remote_created_at: string | null; remote_updated_at: string; permalink: string | null; last_reply_at: string | null; private_reply_sent: boolean };
const present = (row: ThreadRow): InstagramThread => ({ id: row.id, kind: row.kind, name: row.name, username: row.username, preview: row.preview, updatedAt: row.remote_updated_at, permalink: row.permalink });
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
const verifiedDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function afterCursor(value: string | null): Record<string, string> {
  if (!value) return {};
  if (value.length > 2048 || !/^[A-Za-z0-9_=+/-]+$/.test(value)) throw new InstagramError('INVALID_CURSOR', 'Actualiza la bandeja.', 400);
  return { after: value };
}
async function persist(account: InstagramAccount, rows: Array<Partial<ThreadRow> & { kind: 'message' | 'comment'; remote_id: string }>) {
  if (!rows.length) return [] as ThreadRow[];
  const { data, error } = await supabaseAdmin().from(THREADS).upsert(rows.map(r => ({ ...r, account_id: account.accountId, synced_at: new Date().toISOString() })), { onConflict: 'account_id,kind,remote_id' }).select('*');
  if (error) throw error;
  return data as ThreadRow[];
}

export async function instagramInbox(kind: 'message' | 'comment', cursor: string | null) {
  const account = await instagramConnection();
  const rows: Array<Partial<ThreadRow> & { kind: 'message' | 'comment'; remote_id: string }> = [];
  let nextCursor: string | null = null;
  let partialHint: string | null = null;
  if (kind === 'message') {
    const result = await instagramGraph(account, `${account.accountId}/conversations`, { platform: 'instagram', fields: 'id,updated_time,participants', limit: '25', ...afterCursor(cursor) });
    if (!Array.isArray(result?.data)) throw new InstagramError('META_INVALID_RESPONSE', 'Instagram no devolvió una lista de conversaciones válida. Actualiza para volver a intentarlo.');
    for (const conversation of result.data) {
      const participants = Array.isArray(conversation.participants?.data) ? conversation.participants.data : [];
      const identity = resolveMessageIdentity(account, participants, []);
      const person = participants.find((p: any) => p.id === identity.recipientId);
      rows.push({ kind, remote_id: String(conversation.id), recipient_id: person?.id ? String(person.id) : null, name: person?.username || 'Conversación de Instagram', username: person?.username || null, preview: 'Abrir conversación', remote_updated_at: iso(conversation.updated_time) });
    }
    nextCursor = result.paging?.next ? result.paging?.cursors?.after || null : null;
  } else {
    const media = await instagramGraph(account, `${account.accountId}/media`, { fields: 'id,permalink,caption,timestamp,comments_count', limit: '8', ...afterCursor(cursor) });
    if (!Array.isArray(media?.data)) throw new InstagramError('META_INVALID_RESPONSE', 'Instagram no devolvió una lista de publicaciones válida. Actualiza para volver a intentarlo.');
    let commentsNotReturned = false;
    const results = await Promise.allSettled(media.data.map(async (post: any) => {
      const comments = await instagramGraph(account, `${post.id}/comments`, { fields: 'id,text,timestamp,from', limit: '50' });
      if (!Array.isArray(comments?.data)) throw new InstagramError('META_INVALID_RESPONSE', 'Instagram no devolvió una lista de comentarios válida. Actualiza para volver a intentarlo.');
      if (typeof post.comments_count === 'number' && post.comments_count > 0 && comments.data.length === 0) commentsNotReturned = true;
      if (comments.paging?.next) partialHint = 'Hay publicaciones con más de 50 comentarios. Abre la publicación para consultar el resto.';
      return comments.data.map((comment: any) => ({ kind, remote_id: String(comment.id), recipient_id: comment.from?.id ? String(comment.from.id) : null, name: comment.from?.username || 'Comentario de Instagram', username: comment.from?.username || null, preview: String(comment.text || ''), remote_created_at: verifiedDate(comment.timestamp), remote_updated_at: iso(comment.timestamp), permalink: post.permalink || null }));
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') rows.push(...result.value);
      else if (!rows.length && results.every(r => r.status === 'rejected')) throw result.reason;
      else partialHint = 'No se han podido cargar todos los comentarios. Actualiza para volver a intentarlo.';
    }
    if (commentsNotReturned) partialHint = 'Instagram indica comentarios en algunas publicaciones, pero no los ha devuelto. Administración debe revisar la conexión de Meta.';
    nextCursor = media.paging?.next ? media.paging?.cursors?.after || null : null;
  }
  const saved = await persist(account, rows);
  return { ok: true, connection: { username: account.username, connected: true, ready: true }, threads: saved.map(present).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), nextCursor, partialHint };
}

async function threadForAccount(id: string, account: InstagramAccount) {
  if (!/^[a-f\d-]{36}$/i.test(id)) throw new InstagramError('INVALID_THREAD', 'Selecciona una conversación de la bandeja.', 400);
  const { data, error } = await supabaseAdmin().from(THREADS).select('*').eq('id', id).eq('account_id', account.accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new InstagramError('NOT_FOUND', 'Actualiza la bandeja y selecciona la conversación.', 404);
  if (!graphId(data.remote_id)) throw new InstagramError('INVALID_THREAD', 'Instagram devolvió una referencia no válida.');
  return data as ThreadRow;
}

async function loadMessages(account: InstagramAccount, row: ThreadRow) {
  const messages: InstagramMessage[] = [];
  let recipientId: string | null = null;
  let lastInbound: string | null = null;
  let incompleteHistory = false;
  if (row.kind === 'message') {
    // Meta documents listing message IDs first, then reading details. Only the
    // latest 20 can be retrieved; a removed message must not hide the others.
    const list = await instagramGraph(account, row.remote_id, { fields: 'messages' });
    if (!Array.isArray(list.messages?.data)) throw new InstagramError('META_INVALID_RESPONSE', 'Instagram no devolvió el historial de esta conversación. Actualiza para volver a intentarlo.');
    const details = await Promise.all(list.messages.data.slice(0, 20).map(async (item: any) => {
      if (!graphId(item?.id)) throw new InstagramError('META_INVALID_RESPONSE', 'Instagram devolvió un mensaje sin referencia válida. Actualiza la conversación.');
      try { return await instagramGraph(account, item.id, { fields: 'id,created_time,from,to,message' }); }
      catch (error) {
        if (error instanceof InstagramError && ['META_OBJECT_UNAVAILABLE', 'META_MESSAGE_UNAVAILABLE'].includes(error.code)) { incompleteHistory = true; return null; }
        throw error;
      }
    }));
    const available = details.filter((message): message is Record<string, any> => message !== null);
    const identity = resolveMessageIdentity(account, [], available);
    recipientId = identity.recipientId;
    for (const message of available) {
      const fromMe = identity.isOwnActor(message.from);
      if (recipientId && message.from?.id === recipientId && !fromMe) {
        if (typeof message.created_time === 'string' && Number.isFinite(Date.parse(message.created_time)) && (!lastInbound || iso(message.created_time) > lastInbound)) lastInbound = iso(message.created_time);
      }
      messages.push({ id: String(message.id), text: String(message.message || '[Contenido adjunto: consúltalo en Instagram]'), fromMe, createdAt: iso(message.created_time), senderName: message.from?.username || (fromMe ? account.username : row.name) });
    }
  } else {
    const root = await instagramGraph(account, row.remote_id, { fields: 'id,text,timestamp,from' });
    messages.push({ id: String(root.id), text: String(root.text || ''), fromMe: String(root.from?.id) === account.accountId, createdAt: iso(root.timestamp), senderName: root.from?.username || row.name });
    const replies = await instagramGraph(account, `${row.remote_id}/replies`, { fields: 'id,text,timestamp,from', limit: '50' });
    for (const reply of replies.data || []) messages.push({ id: String(reply.id), text: String(reply.text || ''), fromMe: String(reply.from?.id) === account.accountId, createdAt: iso(reply.timestamp), senderName: reply.from?.username || 'Instagram' });
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { messages, recipientId, lastInbound, incompleteHistory };
}

export async function instagramMessages(id: string, requestId?: string | null) {
  const account = await instagramConnection();
  const row = await threadForAccount(id, account);
  const loaded = await loadMessages(account, row);
  const canReply = row.kind === 'comment' || (!loaded.incompleteHistory && !!loaded.recipientId && replyWindowOpen(loaded.lastInbound, 24));
  const unavailableHint = loaded.incompleteHistory ? 'Instagram no permite leer parte del historial. Puedes ver los mensajes disponibles, pero debes actualizar o continuar desde Instagram antes de responder.'
    : !loaded.recipientId ? 'No hemos podido verificar el destinatario de esta conversación. Actualiza o revísala en Instagram.'
    : !loaded.lastInbound ? 'No hay un mensaje entrante verificable del cliente. Espera a que la persona escriba para poder responder.'
    : 'Han pasado 24 horas desde el último mensaje del cliente. Podrás responder aquí cuando vuelva a escribir.';
  const canPrivateReply = row.kind === 'message' ? canReply : !row.private_reply_sent && replyWindowOpen(row.remote_created_at, 7 * 24);
  const pending = await supabaseAdmin().from(SENDS).select('request_id,status,created_at,body').eq('thread_id', id).in('status', ['sending', 'uncertain']).limit(1);
  if (pending.error) throw pending.error;
  const blocked = Boolean(pending.data?.length);
  const operation = pending.data?.[0];
  let requestStatus: string | null = null;
  if (requestId && /^[a-f\d-]{36}$/i.test(requestId)) {
    const receipt = await supabaseAdmin().from(SENDS).select('status').eq('request_id', requestId).eq('thread_id', id).maybeSingle();
    if (receipt.error) throw receipt.error;
    requestStatus = receipt.data?.status || 'not_found';
  }
  return { ok: true, messages: loaded.messages, canReply: canReply && !blocked, canPrivateReply: canPrivateReply && !blocked, lastReplyAt: row.last_reply_at, privateReplySent: row.private_reply_sent,
    requestStatus,
    pendingSend: operation ? { requestId: operation.request_id, status: operation.status, createdAt: operation.created_at, text: operation.body } : null,
    replyHint: blocked ? 'Hay un envío pendiente de confirmar. Comprueba su estado en Instagram antes de repetirlo.' : canReply ? null : unavailableHint,
    privateReplyHint: row.private_reply_sent ? 'Ya se envió la respuesta privada de este comentario. Continúa cuando la persona responda por mensaje.' : canPrivateReply ? null : 'La respuesta privada a un comentario está disponible una vez, durante siete días.' };
}

export async function instagramSend(userId: string, input: any) {
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  const requestId = String(input?.requestId || '');
  const mode = input?.replyMode === 'public' ? 'public' : 'private';
  if (!text || text.length > 1000 || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(requestId)) throw new InstagramError('INVALID_MESSAGE', 'Escribe una respuesta de hasta 1.000 caracteres.', 400);
  const account = await instagramConnection();
  const row = await threadForAccount(String(input.threadId || ''), account);
  const db = supabaseAdmin();
  const existing = await db.from(SENDS).select('*').eq('request_id', requestId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.thread_id !== row.id || existing.data.actor_user_id !== userId || existing.data.body !== text || existing.data.reply_mode !== mode) throw new InstagramError('OPERATION_CONFLICT', 'Este envío ya se utilizó para otra respuesta.', 409);
    if (['sent', 'confirmed_sent'].includes(existing.data.status)) return { ok: true, duplicate: true, messageId: existing.data.remote_message_id };
    throw new InstagramError(existing.data.status === 'failed' ? 'META_REJECTED' : 'SEND_UNCERTAIN', 'Este envío ya se ha intentado. Actualiza y comprueba la conversación antes de repetirlo.', 409);
  }
  const loaded = await loadMessages(account, row);
  if (row.kind === 'message' && loaded.incompleteHistory) throw new InstagramError('INCOMPLETE_HISTORY', 'Instagram no permite verificar todo el historial reciente. Actualiza o continúa desde Instagram antes de responder.', 409);
  if (row.kind === 'message' && !loaded.recipientId) throw new InstagramError('RECIPIENT_UNVERIFIED', 'No hemos podido verificar el destinatario. Actualiza o revisa la conversación en Instagram antes de responder.', 409);
  if (row.kind === 'message' && (!loaded.recipientId || !replyWindowOpen(loaded.lastInbound, 24))) throw new InstagramError('REPLY_WINDOW_CLOSED', 'Espera a que la persona vuelva a escribir: han pasado 24 horas desde su último mensaje.', 409);
  if (row.kind === 'comment' && mode === 'private' && (row.private_reply_sent || !replyWindowOpen(row.remote_created_at, 168))) throw new InstagramError('PRIVATE_REPLY_CLOSED', 'Solo se permite una respuesta privada por comentario durante siete días.', 409);
  const claim = await db.rpc('tc_instagram_claim_send', { p_user: userId, p_thread: row.id, p_request: requestId, p_body: text, p_mode: mode, p_expected_reply: input.expectedLastReplyAt || null });
  if (claim.error) {
    const code = String(claim.error.message);
    throw new InstagramError(code, code === 'STALE_REPLY' ? 'Otra central ya respondió. Actualiza y revisa la conversación.' : 'Hay otra respuesta pendiente o este envío ya se ha registrado. Actualiza antes de continuar.', 409);
  }
  if (claim.data?.duplicate) return { ok: true, duplicate: true, messageId: claim.data.remote_message_id };
  try {
    const result = row.kind === 'comment' && mode === 'public'
      ? await instagramGraph(account, `${row.remote_id}/replies`, {}, { message: text })
      : await instagramGraph(account, `${account.accountId}/messages`, {}, { recipient: row.kind === 'comment' ? { comment_id: row.remote_id } : { id: loaded.recipientId }, message: { text } });
    const remoteId = result.message_id || result.id;
    if (!remoteId) throw new InstagramError('SEND_UNCERTAIN', 'Instagram no confirmó el identificador del envío. Comprueba la conversación.');
    const finish = await db.rpc('tc_instagram_finish_send', { p_request: requestId, p_status: 'sent', p_remote_id: String(remoteId), p_error: null });
    if (finish.error) throw new InstagramError('SEND_UNCERTAIN', 'Instagram recibió el mensaje, pero no pudimos guardar el recibo. No lo repitas.');
    return { ok: true, messageId: String(remoteId) };
  } catch (error) {
    const uncertain = !(error instanceof InstagramError) || error.code === 'SEND_UNCERTAIN';
    await db.rpc('tc_instagram_finish_send', { p_request: requestId, p_status: uncertain ? 'uncertain' : 'failed', p_remote_id: null, p_error: error instanceof InstagramError ? error.code : 'UNKNOWN' });
    throw error;
  }
}

export async function instagramResolve(userId: string, input: any) {
  if (input?.confirmed !== true || !['sent', 'not_sent'].includes(input?.outcome) || !/^[a-f\d-]{36}$/i.test(String(input?.requestId || ''))) throw new InstagramError('CONFIRMATION_REQUIRED', 'Comprueba la conversación en Instagram y confirma el resultado.', 400);
  const account = await instagramConnection();
  const row = await threadForAccount(String(input.threadId || ''), account);
  const result = await supabaseAdmin().rpc('tc_instagram_resolve_send', { p_user: userId, p_thread: row.id, p_request: input.requestId, p_outcome: input.outcome });
  if (result.error) throw new InstagramError(result.error.message === 'SEND_IN_PROGRESS' ? 'SEND_IN_PROGRESS' : 'RESOLVE_FAILED', result.error.message === 'SEND_IN_PROGRESS' ? 'Espera un minuto desde el envío antes de comprobar el resultado.' : 'No se ha podido guardar la comprobación. Actualiza la conversación.', 409);
  return { ok: true };
}
