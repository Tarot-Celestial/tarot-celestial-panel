import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';

export class FacebookError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
export const facebookId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_:.=-]{1,500}$/.test(value);
export const facebookDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const facebookReplyWindow = (date: string | null, hours: number, now = Date.now()) => {
  const time = date ? Date.parse(date) : NaN;
  return Number.isFinite(time) && time <= now + 60000 && now - time < hours * 3600000;
};

export async function facebookIdentity(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new FacebookError('NO_AUTH', 'Inicia sesión para acceder.', 401);
  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new FacebookError('NO_AUTH', 'Tu sesión ha caducado. Vuelve a entrar.', 401);
  const workers = await db.from('workers').select('id,role,is_active').eq('user_id', data.user.id);
  if (workers.error) throw workers.error;
  const worker = workers.data?.find(w => w.is_active === true && ['central', 'admin'].includes(w.role));
  if (!worker) throw new FacebookError('FORBIDDEN', 'Solo las centrales y administración pueden atender Facebook.', 403);
  return { db, worker, userId: data.user.id };
}

export function facebookConnection() {
  const accountId = String(process.env.FACEBOOK_PAGE_ID || '').trim();
  const token = String(process.env.META_ACCESS_TOKEN || '').trim();
  if (!/^\d{1,40}$/.test(accountId) || !token) throw new FacebookError('NOT_CONNECTED', 'Administración debe conectar la página de Facebook para recibir comentarios y mensajes.');
  return { accountId, token, username: 'Tarot Celestial' };
}
export type FacebookAccount = ReturnType<typeof facebookConnection>;

// Do not follow paging.next URLs: they contain credentials and are not trusted destinations.
export async function facebookGraph(account: FacebookAccount, path: string, params: Record<string, string> = {}, body?: object, deadlineAt?: number) {
  if (!/^(?:me|debug_token|[A-Za-z0-9_:.=-]{1,500})(?:\/(?:posts|comments|conversations|messages|private_replies|subscribed_apps|permissions))?$/.test(path)) {
    throw new FacebookError('INVALID_RESOURCE', 'La referencia de Facebook no es válida.', 400);
  }
  const remaining = deadlineAt ? Math.min(10000, deadlineAt - Date.now()) : 10000;
  if (remaining < 1000) throw new FacebookError('SYNC_TIME_BUDGET', 'La sincronización continuará en la siguiente actualización.');
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '') ? process.env.META_GRAPH_API_VERSION : 'v24.0';
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(remaining),
      headers: { Authorization: `Bearer ${account.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new FacebookError(body ? 'SEND_UNCERTAIN' : 'META_UNAVAILABLE', body
      ? 'Facebook no confirmó el envío. Comprueba la conversación antes de repetirlo.' : 'Facebook no responde ahora. Actualiza en unos instantes.');
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.error) {
    const code = Number(json?.error?.code);
    console.warn('facebook-api-error', { operation: body ? 'write' : 'read', status: response.status, code, subcode: Number(json?.error?.error_subcode || 0) });
    if (body && (response.status >= 500 || !json)) throw new FacebookError('SEND_UNCERTAIN', 'No se ha podido confirmar el envío. Revísalo en Facebook antes de repetirlo.');
    if (code === 190 || response.status === 401) throw new FacebookError('TOKEN_EXPIRED', 'Administración debe renovar la autorización de Facebook.');
    if ([10, 200].includes(code) || response.status === 403) throw new FacebookError('META_PERMISSION', path.includes('conversations') || path.includes('messages') || path.includes('private_replies')
      ? 'Falta autorizar pages_messaging para leer y responder mensajes de Facebook. Administración debe completar la conexión.'
      : body ? 'Falta autorizar pages_manage_engagement para responder comentarios de Facebook.'
      : 'Facebook no permite leer estos comentarios. Administración debe comprobar pages_read_engagement y pages_read_user_content.');
    if ([4, 17, 32, 613].includes(code) || response.status === 429) throw new FacebookError('META_RATE_LIMIT', 'Facebook pide esperar antes de continuar. Inténtalo más tarde.', 429);
    if (!body && code === 100 && Number(json?.error?.error_subcode) === 33) throw new FacebookError('META_OBJECT_UNAVAILABLE', 'Este elemento de Facebook no está disponible para la conexión actual.');
    throw new FacebookError('META_REJECTED', body ? 'Facebook rechazó la respuesta. Comprueba los permisos y el plazo para responder.' : 'Facebook no permite cargar esta conversación. Revisa la conexión y los permisos.');
  }
  if (!json) throw new FacebookError(body ? 'SEND_UNCERTAIN' : 'META_UNAVAILABLE', 'Facebook no devolvió una confirmación válida.');
  return json as Record<string, any>;
}

let verified: { token: string; accountId: string; name: string; until: number } | null = null;
export async function verifyFacebookAccount(account: FacebookAccount) {
  if (verified?.token === account.token && verified.accountId === account.accountId && verified.until > Date.now()) return verified.name;
  const me = await facebookGraph(account, 'me', { fields: 'id,name' });
  if (String(me.id) !== account.accountId) throw new FacebookError('WRONG_ACCOUNT', 'La credencial debe pertenecer a la página de Facebook configurada, no a una cuenta personal. Administración debe revisar la conexión.');
  verified = { token: account.token, accountId: account.accountId, name: String(me.name || account.username), until: Date.now() + 300000 };
  return verified.name;
}
