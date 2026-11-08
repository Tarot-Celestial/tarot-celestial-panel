import { CHAT_CHARACTERS, CHAT_WALLPAPERS } from '@/lib/staff-chat-appearance';
import { requireStaffChatThread, type StaffChatActor } from '@/lib/server/staff-chat';
import { validMediaBytes } from '@/lib/server/staff-chat-media';

export const APPEARANCE_BUCKET = 'staff-chat-appearance';
export const APPEARANCE_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_COLUMNS = 'worker_id,avatar_kind,character,photo_path,revision';
const PREFERENCE_COLUMNS = 'worker_id,thread_id,wallpaper,background_path,revision';

export function appearanceInput(body: any) {
  if (!Number.isSafeInteger(body?.revision) || body.revision < 0) throw new Error('INVALID_REVISION');
  if (body?.scope === 'profile') {
    if (!['initials', 'character'].includes(body.avatar_kind)) throw new Error('INVALID_AVATAR');
    if (body.avatar_kind === 'character' && !CHAT_CHARACTERS.some(item => item.id === body.character)) throw new Error('INVALID_AVATAR');
    return { scope: 'profile', revision: body.revision, values: { avatar_kind: body.avatar_kind, character: body.avatar_kind === 'character' ? body.character : null, photo_path: null } };
  }
  if (body?.scope === 'background' && CHAT_WALLPAPERS.some(item => item.id === body.wallpaper)) {
    return { scope: 'background', revision: body.revision, values: { wallpaper: body.wallpaper, background_path: null } };
  }
  throw new Error('INVALID_APPEARANCE');
}
async function signedPhoto(db: any, path: string | null) {
  if (!path) return null;
  const { data, error } = await db.storage.from(APPEARANCE_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
  return data.signedUrl as string;
}
async function profileDTO(db: any, row: any, workerId: string) {
  return { worker_id: workerId, avatar_kind: row?.avatar_kind || 'initials', character: row?.character || null, photo_url: row?.avatar_kind === 'photo' ? await signedPhoto(db, row.photo_path) : null, revision: Number(row?.revision || 0) };
}
export async function readChatAppearance(db: any, me: StaffChatActor, threadId: string) {
  if (threadId) await requireStaffChatThread(db, me, threadId);
  // Match the current chat directory's role boundary; never expose Auth or CRM fields.
  const roles = me.can_admin ? ['admin', 'central', 'tarotista'] : me.role === 'tarotista' ? ['central', 'admin'] : ['tarotista', 'admin'];
  const { data: workers, error: workersError } = await db.from('workers').select('id').in('role', roles).eq('is_active', true).limit(1000);
  if (workersError) throw workersError;
  const ids = [...new Set<string>([me.id, ...(workers || []).map((worker: any) => String(worker.id))])];
  const [{ data: profiles, error: profileError }, preferenceResult] = await Promise.all([
    db.from('staff_chat_profiles').select(PROFILE_COLUMNS).in('worker_id', ids),
    threadId ? db.from('staff_chat_preferences').select(PREFERENCE_COLUMNS).eq('worker_id', me.id).eq('thread_id', threadId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (profileError) throw profileError;
  if (preferenceResult.error) throw preferenceResult.error;
  const profilePairs = await Promise.all((profiles || []).map(async (row: any) => [String(row.worker_id), await profileDTO(db, row, String(row.worker_id))] as const));
  const map = Object.fromEntries(profilePairs);
  const preference = preferenceResult.data;
  return { profile: map[me.id] || await profileDTO(db, null, me.id), profiles: map,
    preference: { wallpaper: preference?.wallpaper || 'aurora', background_url: await signedPhoto(db, preference?.background_path || null), revision: Number(preference?.revision || 0) } };
}

export async function saveChatAppearance(db: any, me: StaffChatActor, threadId: string, scope: string, revision: number, values: Record<string, unknown>) {
  if (scope !== 'profile') await requireStaffChatThread(db, me, threadId);
  const table = scope === 'profile' ? 'staff_chat_profiles' : 'staff_chat_preferences';
  const pathField = scope === 'profile' ? 'photo_path' : 'background_path';
  const keys = scope === 'profile' ? { worker_id: me.id } : { worker_id: me.id, thread_id: threadId };
  let read = db.from(table).select(`revision,${pathField}`).eq('worker_id', me.id);
  if (scope !== 'profile') read = read.eq('thread_id', threadId);
  const { data: previous, error: readError } = await read.maybeSingle();
  if (readError) throw readError;
  if (Number(previous?.revision || 0) !== revision) throw new Error('APPEARANCE_CHANGED');
  const row = { ...values, revision: revision + 1, updated_at: new Date().toISOString() };
  let result;
  if (!previous) result = await db.from(table).insert({ ...keys, ...row }).select('revision').single();
  else {
    let update = db.from(table).update(row).eq('worker_id', me.id).eq('revision', revision);
    if (scope !== 'profile') update = update.eq('thread_id', threadId);
    result = await update.select('revision').maybeSingle();
  }
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('APPEARANCE_CHANGED');
  if (result.error) throw result.error;
  // Paths are generated server-side and unique per upload. The replaced object
  // cannot belong to another worker or a newer write.
  if (previous?.[pathField] && previous[pathField] !== values[pathField]) await db.storage.from(APPEARANCE_BUCKET).remove([previous[pathField]]);
}
export async function uploadChatAppearance(db: any, me: StaffChatActor, form: FormData) {
  const scope = String(form.get('scope') || ''), threadId = String(form.get('thread_id') || ''), revision = Number(form.get('revision'));
  if (!['profile', 'background'].includes(scope) || !Number.isSafeInteger(revision) || revision < 0 || form.get('revision') === null) throw new Error('INVALID_APPEARANCE');
  if (scope === 'background') await requireStaffChatThread(db, me, threadId);
  const file = form.get('file');
  if (!(file instanceof File)) throw new Error('INVALID_MEDIA_TYPE');
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!extensions[file.type]) throw new Error('INVALID_MEDIA_TYPE');
  if (file.size <= 0 || file.size > APPEARANCE_MAX_BYTES) throw new Error('INVALID_APPEARANCE_SIZE');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validMediaBytes(bytes, file.type)) throw new Error('INVALID_MEDIA_CONTENT');
  const path = `${me.id}/${scope}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const storage = db.storage.from(APPEARANCE_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
  try {
    await saveChatAppearance(db, me, threadId, scope, revision, scope === 'profile' ? { avatar_kind: 'photo', character: null, photo_path: path } : { wallpaper: 'custom', background_path: path });
  } catch (error) {
    // A transport failure may arrive after the row was committed. Keep this
    // private object on unknown outcomes; deleting it could break a saved photo.
    // Only the explicit CAS rejection proves this upload was never attached.
    if (error instanceof Error && error.message === 'APPEARANCE_CHANGED') await storage.remove([path]);
    throw error;
  }
  return threadId;
}
