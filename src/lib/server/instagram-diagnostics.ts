import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { instagramConnection, instagramGraph, instagramReadWithQueryToken, InstagramError, graphId } from './instagram-graph';
import { instagramSubscriptionStatus } from './instagram-subscriptions';

type Check = { label: string; ok: boolean; count?: number; code?: string };

// Admin-only caller. Bounded reads of this account and its latest published post;
// no message contents, credentials, remote URLs or raw exceptions are returned.
export async function instagramDiagnostics() {
  const account = await instagramConnection();
  const { data, error } = await supabaseAdmin().from('tc_social_content')
    .select('external_post_id').eq('provider', 'instagram').eq('status', 'published')
    .in('content_type', ['post', 'reel', 'carousel']).not('external_post_id', 'is', null)
    .order('published_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const postId = graphId(data?.external_post_id) ? String(data?.external_post_id) : null;
  const count = async (label: string, read: () => Promise<Record<string, any>>): Promise<Check> => {
    try {
      const response = await read();
      if (!Array.isArray(response.data)) return { label, ok: false, code: 'META_INVALID_RESPONSE' };
      return { label, ok: true, count: response.data.length };
    } catch (error) {
      return { label, ok: false, code: error instanceof InstagramError ? error.code : 'SERVICE_UNAVAILABLE' };
    }
  };
  const mediaParams = { fields: 'id', limit: '8' };
  const commentParams = { fields: 'id,text,timestamp', limit: '50' };
  const checks = await Promise.all([
    count('Permisos de la conexión', () => instagramGraph(account, `${account.accountId}/permissions`)),
    count('Publicaciones · conexión actual', () => instagramGraph(account, `${account.accountId}/media`, mediaParams)),
    count('Publicaciones · conexión alternativa', () => instagramReadWithQueryToken(account, `${account.accountId}/media`, mediaParams)),
    ...(postId ? [
      count('Comentarios del último post · conexión actual', () => instagramGraph(account, `${postId}/comments`, commentParams)),
      count('Comentarios del último post · conexión alternativa', () => instagramReadWithQueryToken(account, `${postId}/comments`, commentParams)),
    ] : []),
  ]);
  let subscription: {subscribed:boolean;fields:string[];ready:boolean;code?:string};
  try {subscription=await instagramSubscriptionStatus(account);}
  catch(error){subscription={subscribed:false,fields:[],ready:false,code:error instanceof InstagramError?error.code:'SERVICE_UNAVAILABLE'};}
  return { ok: true, checks, postId, subscription, webhookConfigured:!!process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN };
}
