import 'server-only';
import { instagramConnection, instagramGraph, InstagramError, sameConnectionTime } from './instagram-graph';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { SOCIAL_CONNECTIONS_TABLE } from './social-connections';

const username = 'tarotcelestialof';
const required = ['instagram_business_basic', 'instagram_business_content_publish'];
type Credentials = Awaited<ReturnType<typeof instagramConnection>>;
export type OfficeInstagramBinding = { persisted_account_id: string; connected_at: string | null; owner_id?: string | null };
export type OfficeInstagramStatus = {
  username: string; account_id: string; persisted_account_id: string; owner_id: string | null; connected_at: string | null;
  checked_at: string; expires_at: string | null; account_type: string | null; can_publish: boolean; message: string;
  permissions: string[]; reported_permissions: string[]; permission_source: 'reported' | 'quota' | 'none';
};
export class OfficeInstagramError extends Error {
  constructor(public code: string, message: string, public uncertain = false) { super(message); }
}
function failure(error: unknown) {
  if (error instanceof OfficeInstagramError) return error;
  if (error instanceof InstagramError) {
    const messages: Record<string, string> = {
      META_PERMISSION: 'Meta no permite esta operación. Comprueba los permisos de Instagram.',
      META_REJECTED: 'Meta rechazó la operación solicitada.',
      META_UNAVAILABLE: 'Meta no está disponible ahora.',
      SEND_UNCERTAIN: 'Meta no confirmó el resultado. Comprueba el contenedor antes de repetir.',
    };
    return new OfficeInstagramError(error.code, messages[error.code] || error.message, error.code === 'SEND_UNCERTAIN');
  }
  return new OfficeInstagramError('UNAVAILABLE', 'No se pudo verificar la conexión de Instagram.');
}
function isId(value: unknown): value is string { return typeof value === 'string' && /^\d{1,40}$/.test(value); }
function assertId(value: string) { if (!isId(value)) throw new OfficeInstagramError('BAD_ID', 'El identificador de Instagram no es válido.'); }
async function request(account: Credentials, path: string, params: Record<string,string> = {}, body?: Record<string,string>) {
  try { return await instagramGraph(account, path, params, body); } catch (e) { throw failure(e); }
}
async function credentials(refreshForAccount?: string, binding?: Pick<Credentials, 'connectedAt' | 'ownerId'>) {
  try { return await instagramConnection(refreshForAccount, binding); } catch (e) { throw failure(e); }
}
function unsupported(e: unknown) { return e instanceof OfficeInstagramError && ['META_REJECTED','META_OBJECT_UNAVAILABLE','META_PERMISSION'].includes(e.code); }
async function identity(account: Credentials) {
  let profile: Record<string, any> | undefined;
  for (const fields of ['user_id,id,username,account_type', 'user_id,username', 'id,username']) {
    try {
      const result = await request(account, 'me', { fields });
      profile = Array.isArray(result.data) ? result.data[0] : result;
      break;
    } catch (e) { if (!unsupported(e) || fields === 'id,username') throw e; }
  }
  const remoteIds = [...new Set([profile?.user_id, profile?.id].filter(isId))];
  const knownIds = [account.accountId, ...(account.verifiedAccountIds || [])];
  if (String(profile?.username || '').toLowerCase() !== username || !remoteIds.some(id => knownIds.includes(id))) {
    throw new OfficeInstagramError('WRONG_ACCOUNT', 'La identidad que devolvió Meta no coincide con @tarotcelestialof.');
  }
  const type = profile?.account_type ? String(profile.account_type).toUpperCase() : null;
  if (type && !['BUSINESS','MEDIA_CREATOR','CREATOR'].includes(type)) throw new OfficeInstagramError('WRONG_TYPE', 'Se necesita una cuenta profesional de Instagram.');
  return { ids: [...new Set([...(remoteIds.includes(account.accountId) ? [account.accountId] : []), ...remoteIds])], type };
}
async function quota(account: Credentials, ids: string[]) {
  for (const id of ids) {
    try {
      const json = await request(account, id + '/content_publishing_limit', { fields:'quota_usage,config' });
      const record = json?.data?.[0];
      if (!Number.isInteger(record?.quota_usage) || record.quota_usage < 0) throw new OfficeInstagramError('INVALID_QUOTA', 'Meta no devolvió una cuota de publicación verificable.');
      const total = record?.config?.quota_total;
      return { id, available: !Number.isFinite(total) || record.quota_usage < total };
    } catch (e) { if (!unsupported(e) || id === ids[ids.length - 1]) throw e; }
  }
  throw new OfficeInstagramError('NO_ACCOUNT', 'Meta no devolvió una cuenta verificable.');
}
export async function officeInstagramConnection(): Promise<OfficeInstagramStatus> {
  const result: OfficeInstagramStatus = { username, account_id:'', persisted_account_id:'', owner_id:null, connected_at:null,
    checked_at:new Date().toISOString(), expires_at:null, account_type:null, can_publish:false, message:'',
    permissions:[], reported_permissions:[], permission_source:'none' };
  try {
    const account = await credentials();
    Object.assign(result, { account_id:account.accountId, persisted_account_id:account.accountId, owner_id:account.ownerId, connected_at:account.connectedAt, expires_at:account.expiresAt });
    const profile = await identity(account);
    result.account_type = profile.type;
    const checked = await quota(account, profile.ids);
    result.account_id = checked.id;
    let denied = false;
    try {
      const response = await request(account, checked.id + '/permissions');
      const rows: {status?:string; permission?:string}[] = Array.isArray(response.data) ? response.data : [];
      result.reported_permissions = rows.filter(p => p.status === 'granted' && typeof p.permission === 'string').map(p => p.permission!);
      denied = rows.some(p => required.includes(p.permission || '') && p.status !== 'granted');
    } catch (e) { if (!unsupported(e)) throw e; }
    result.permissions = denied ? result.reported_permissions : [...new Set([...result.reported_permissions, ...required])];
    result.permission_source = denied || required.every(p => result.reported_permissions.includes(p)) ? 'reported' : 'quota';
    result.can_publish = checked.available && !denied;
    result.message = denied ? 'Meta informa de un permiso de publicación denegado.' : checked.available
      ? 'Meta verificó la cuenta y la cuota de publicación.' : 'La cuenta agotó su cuota de publicación en Meta.';
  } catch (e) {
    const problem = failure(e);
    result.message = problem.message;
    // The authenticated helper deliberately rejects expired or missing tokens.
    // Keep the saved expiry and destination visible for reconnection.
    if (!result.persisted_account_id && ['TOKEN_EXPIRED','TOKEN_MISSING'].includes(problem.code)) {
      const { data } = await supabaseAdmin().from(SOCIAL_CONNECTIONS_TABLE)
        .select('username,account_id,connected_at,connected_by,token_expires_at').eq('provider','instagram').maybeSingle();
      if (data && String(data.username || '').toLowerCase() === username) Object.assign(result,{
        account_id:data.account_id, persisted_account_id:data.account_id, connected_at:data.connected_at, owner_id:data.connected_by, expires_at:data.token_expires_at,
      });
    }
  }
  return result;
}
function checkedBinding(account: Credentials, pin?: OfficeInstagramBinding) {
  if (pin && (pin.persisted_account_id !== account.accountId || !sameConnectionTime(pin.connected_at,account.connectedAt) ||
      (pin.owner_id !== undefined && pin.owner_id !== account.ownerId))) {
    throw new OfficeInstagramError('CONNECTION_CHANGED', 'La conexión cambió desde la autorización.');
  }
}
async function bound(accountId: string, pin?: OfficeInstagramBinding, refresh = false) {
  assertId(accountId);
  let account = await credentials();
  checkedBinding(account, pin);
  const remote = await identity(account);
  if (!remote.ids.includes(accountId)) throw new OfficeInstagramError('WRONG_ACCOUNT','El destino autorizado ya no corresponde a la cuenta conectada.');
  if (refresh && account.expiresAt && Date.parse(account.expiresAt) - Date.now() < 7 * 86400000) {
    const original = account;
    account = await credentials(original.accountId, original);
    checkedBinding(account, { persisted_account_id:original.accountId, owner_id:original.ownerId, connected_at:original.connectedAt });
    if (account.token !== original.token && !(await identity(account)).ids.includes(accountId)) throw new OfficeInstagramError('WRONG_ACCOUNT','La conexión renovada no corresponde al destino autorizado.');
  }
  return account;
}
function confirmedId(response: Record<string,any>) {
  if (!isId(response.id)) throw new OfficeInstagramError('SEND_UNCERTAIN','Meta respondió sin un identificador de confirmación.',true);
  return response.id;
}
export async function createOfficeContainer(accountId:string, url:string, caption:string, alt:string, mediaType:string, pin?:OfficeInstagramBinding) {
  if (!['image/jpeg','video/mp4'].includes(mediaType)) throw new OfficeInstagramError('FORMAT','Instagram requiere un JPEG o un vídeo MP4.');
  let media: URL;
  try { media = new URL(url); } catch { throw new OfficeInstagramError('BAD_URL','La URL del archivo no es válida.'); }
  if (media.protocol !== 'https:' || media.username || media.password) throw new OfficeInstagramError('BAD_URL','La entrega a Meta requiere una URL HTTPS.');
  const account = await bound(accountId, pin, true);
  const payload: Record<string,string> = mediaType === 'image/jpeg' ? { image_url:url, caption, alt_text:alt }
    : { media_type:'REELS', video_url:url, caption, share_to_feed:'true' };
  return confirmedId(await request(account, accountId + '/media', {}, payload));
}
async function statusOf(account: Credentials, id: string) {
  assertId(id);
  const result = await request(account, id, { fields:'status_code' });
  if (!['IN_PROGRESS','FINISHED','PUBLISHED','ERROR','EXPIRED'].includes(result.status_code)) throw new OfficeInstagramError('INVALID_STATUS','Meta no devolvió un estado válido del contenedor.');
  return result.status_code as string;
}
export async function getOfficeContainerStatus(accountId:string, id:string, pin?:OfficeInstagramBinding) { return statusOf(await bound(accountId,pin),id); }
export async function sendOfficeContainer(accountId:string, id:string, pin?:OfficeInstagramBinding) {
  assertId(id);
  const account = await bound(accountId,pin);
  return confirmedId(await request(account, accountId + '/media_publish', {}, { creation_id:id }));
}
function nonnegative(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function permalink(input: unknown) {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && ['www.instagram.com','instagram.com'].includes(url.hostname)
      && /^\/(p|reel|tv)\/[\w-]+\/?$/.test(url.pathname) ? url.origin + url.pathname : null;
  } catch { return null; }
}
async function receipt(account: Credentials, mediaId:string) {
  assertId(mediaId);
  let media: Record<string,any>;
  try { media = await request(account,mediaId,{ fields:'id,username,permalink,like_count,comments_count' }); }
  catch (e) {
    if (!unsupported(e)) throw e;
    media = await request(account,mediaId,{ fields:'id,username,permalink' });
  }
  if (media.id !== mediaId || String(media.username || '').toLowerCase() !== username) throw new OfficeInstagramError('WRONG_MEDIA','Meta no confirmó el contenido en la cuenta autorizada.');
  let reach: number | null = null;
  try {
    const insights = await request(account,mediaId + '/insights',{ metric:'reach' });
    const item = Array.isArray(insights.data) && insights.data.find((r: {name?:string}) => r.name === 'reach');
    reach = nonnegative(item?.values?.[0]?.value ?? item?.total_value?.value);
  } catch { /* Insights are optional. The confirmed media ID remains authoritative. */ }
  return { id:mediaId, permalink:permalink(media.permalink), metrics:{ likes:nonnegative(media.like_count), comments:nonnegative(media.comments_count), reach,
    period:'lifetime', checked_at:new Date().toISOString() } };
}
export async function readOfficeReceipt(accountId:string, mediaId:string,pin?:OfficeInstagramBinding) { return receipt(await bound(accountId,pin),mediaId); }
async function scan(account:Credentials, accountId:string, caption:string, since:string, unique:boolean) {
  const start = Date.parse(since);
  if (!Number.isFinite(start) || !caption.trim()) throw new OfficeInstagramError('INVALID_SEARCH','Falta el texto o la fecha de comprobación del post.');
  const matches = new Set<string>();
  const cursors = new Set<string>();
  const cutoff = Math.floor(start/1000)*1000;
  const until = String(Math.ceil(Date.now()/1000));
  let previous = Infinity;
  let chronological = true;
  let oldPages = 0;
  let after = '';
  for (let page = 0; page < 8; page++) {
    const params: Record<string,string> = { fields:'id,caption,timestamp', limit:'50', since:String(cutoff/1000), until };
    if (after) params.after = after;
    const result = await request(account, accountId + '/media', params);
    if (!Array.isArray(result.data)) throw new OfficeInstagramError('INVALID_RESPONSE','Meta no devolvió el historial de publicaciones.');
    let older = result.data.length >= 4;
    for (const item of result.data) {
      const stamp = Date.parse(item.timestamp);
      if (!Number.isFinite(stamp)) throw new OfficeInstagramError('INVALID_RESPONSE','Meta no devolvió la fecha de una publicación.');
      if (stamp > previous) chronological = false;
      previous = stamp;
      if (stamp >= cutoff) older = false;
      if (stamp < cutoff || typeof item.caption !== 'string' || item.caption.normalize('NFC') !== caption.normalize('NFC')) continue;
      assertId(item.id);
      matches.add(item.id);
      if (!unique) return receipt(account,item.id);
      if (matches.size > 1) return null;
    }
    // Some Graph versions return items older than the requested window. Require
    // two old pages and verified order across pages, so pinned items do not
    // masquerade as a time boundary. Unordered/incomplete feeds fail closed.
    oldPages = older ? oldPages+1 : 0;
    if (!result.paging?.next || (chronological && oldPages >= 2)) return matches.size === 1 ? receipt(account,[...matches][0]) : null;
    const cursor = result.paging.cursors?.after;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) break;
    cursors.add(cursor);
    after = cursor;
  }
  throw new OfficeInstagramError('INCOMPLETE_HISTORY','Meta no permitió comprobar todo el intervalo. Requiere conciliación.');
}
export async function findRecentExactPost(accountId:string, caption:string, since:string,pin?:OfficeInstagramBinding) {
  return scan(await bound(accountId,pin),accountId,caption,since,false);
}
export async function findOfficeReceipt(accountId:string, containerId:string, caption:string, since:string,pin?:OfficeInstagramBinding) {
  const account = await bound(accountId,pin);
  return await statusOf(account,containerId) === 'PUBLISHED' ? scan(account,accountId,caption,since,true) : null;
}
