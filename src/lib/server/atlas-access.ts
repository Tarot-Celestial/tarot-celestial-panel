import { getServiceClient } from '@/lib/admin/require-admin';
import type { SupabaseClient } from '@supabase/supabase-js';
export type AtlasContext = { db: SupabaseClient; worker: { id: string; user_id: string; role: string; display_name: string } };
export class AtlasError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function atlasContext(req: Request): Promise<AtlasContext> {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AtlasError('Inicia sesión para hablar con Atlas.', 401);
  const db = getServiceClient();
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new AtlasError('Tu sesión ha caducado.', 401);
  const { data, error } = await db.from('workers').select('id,user_id,role,display_name,is_active').eq('user_id', auth.data.user.id).maybeSingle();
  if (error) throw error;
  if (!data || data.role !== 'admin' || data.is_active === false) throw new AtlasError('Atlas está reservado a administración.', 403);
  return { db, worker: data };
}
export async function atlasChecked<T = any>(request: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await request; if (error) throw error; return data as T;
}
