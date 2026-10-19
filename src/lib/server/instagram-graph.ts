import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { decryptSecret, SOCIAL_CONNECTIONS_TABLE } from '@/lib/server/social-connections';

export class InstagramError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}

export async function instagramIdentity(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new InstagramError('NO_AUTH', 'Inicia sesión para acceder.', 401);
  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new InstagramError('NO_AUTH', 'Tu sesión ha caducado. Vuelve a entrar.', 401);
  const workers = await db.from('workers').select('id,role,is_active').eq('user_id', data.user.id);
  if (workers.error) throw workers.error;
  const worker = workers.data?.find(w => w.is_active !== false && ['central', 'admin'].includes(w.role));
  if (!worker) throw new InstagramError('FORBIDDEN', 'Solo las centrales y administración pueden atender Instagram.', 403);
  return { db, worker, userId: data.user.id };
}

export async function instagramConnection() {
  const db = supabaseAdmin();
  const { data, error } = await db.from(SOCIAL_CONNECTIONS_TABLE)
    .select('account_id,username,access_token_ciphertext,token_expires_at').eq('provider', 'instagram').maybeSingle();
  if (error) throw error;
  if (!data?.account_id) throw new InstagramError('NOT_CONNECTED', 'Conecta @tarotcelestialof desde Administración → Redes sociales.');
  if (String(data.username || '').toLowerCase() !== 'tarotcelestialof') {
    throw new InstagramError('WRONG_ACCOUNT', 'La cuenta conectada debe ser @tarotcelestialof.');
  }
  if (data.token_expires_at && Date.parse(data.token_expires_at) <= Date.now()) {
    throw new InstagramError('TOKEN_EXPIRED', 'La conexión con Instagram ha caducado. Vuelve a conectarla desde Administración.');
  }
  const token = decryptSecret(data.access_token_ciphertext);
  if (!token) throw new InstagramError('TOKEN_MISSING', 'Vuelve a conectar Instagram desde Administración.');
  return { accountId: String(data.account_id), username: String(data.username), token };
}

export type InstagramAccount = Awaited<ReturnType<typeof instagramConnection>>;

// All resource paths and cursors are constructed locally; never fetch Meta's
// paging.next URL, which can contain tokens or an unexpected destination.
export async function instagramGraph(account: InstagramAccount, path: string, params: Record<string, string> = {}, body?: object) {
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '') ? process.env.META_GRAPH_API_VERSION : 'v24.0';
  const url = new URL(`https://graph.instagram.com/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${account.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new InstagramError(body ? 'SEND_UNCERTAIN' : 'META_UNAVAILABLE', body
      ? 'Instagram no confirmó el envío. Comprueba la conversación antes de repetirlo.'
      : 'Instagram no responde ahora. Actualiza en unos instantes.');
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.error) {
    const code = Number(json?.error?.code);
    console.warn('instagram-api-error', { operation: body ? 'send' : 'read', status: response.status, code, subcode: Number(json?.error?.error_subcode || 0) });
    if (body && (response.status >= 500 || !json)) throw new InstagramError('SEND_UNCERTAIN', 'No se ha podido confirmar el envío. Revísalo en Instagram antes de repetirlo.');
    if (code === 190 || response.status === 401) throw new InstagramError('TOKEN_EXPIRED', 'Vuelve a conectar Instagram desde Administración; la autorización ya no es válida.');
    if ([10, 200].includes(code) || response.status === 403) throw new InstagramError('META_PERMISSION', 'Instagram no ha concedido el permiso necesario. Revisa los permisos de mensajes y comentarios en Administración.');
    if ([4, 17, 32, 613].includes(code) || response.status === 429) throw new InstagramError('META_RATE_LIMIT', 'Instagram pide esperar antes de continuar. Inténtalo más tarde.', 429);
    throw new InstagramError('META_REJECTED', body ? 'Instagram rechazó la respuesta. Comprueba los permisos y el plazo permitido para responder.' : 'Instagram no permite cargar esta conversación. Revisa la conexión y los permisos.');
  }
  if (!json) throw new InstagramError(body ? 'SEND_UNCERTAIN' : 'META_UNAVAILABLE', 'Instagram no devolvió una confirmación válida.');
  return json as Record<string, any>;
}

export const graphId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_:.=-]{1,500}$/.test(value);
export const replyWindowOpen = (date: string | null | undefined, hours: number, now = Date.now()) => {
  const time = date ? Date.parse(date) : NaN;
  return Number.isFinite(time) && time <= now + 60000 && now - time < hours * 60 * 60 * 1000;
};
