import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';

export type SocialInboxProvider = 'instagram' | 'facebook';
export type SocialInboxEvent = { kind: 'message' | 'comment'; remoteId: string; threadRemoteId: string; occurredAt: string };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_:.=\/-]{1,500}$/.test(value);
const unavailable = () => new Error('SOCIAL_INBOX_UNAVAILABLE');

/** Caller filters outbound/echo events; this ledger only inserts verified inbound IDs. */
export async function recordSocialActivity(provider: SocialInboxProvider, accountId: string, events: SocialInboxEvent[]) {
  if (!identifier(accountId)) throw unavailable();
  const rows = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    const occurred = Date.parse(event.occurredAt);
    if (!['message', 'comment'].includes(event.kind) || !identifier(event.remoteId) || !identifier(event.threadRemoteId)
        || !Number.isFinite(occurred) || occurred > Date.now() + 60_000) continue;
    rows.set(`${event.kind}:${event.remoteId}`, { provider, account_id: accountId, kind: event.kind,
      remote_id: event.remoteId, thread_remote_id: event.threadRemoteId, occurred_at: new Date(occurred).toISOString() });
  }
  const values = [...rows.values()];
  for (let offset = 0; offset < values.length; offset += 100) {
    const result = await supabaseAdmin().from('tc_social_inbox_activity').upsert(values.slice(offset, offset + 100), {
      onConflict: 'provider,account_id,kind,remote_id', ignoreDuplicates: true,
    });
    if (result.error) throw unavailable();
  }
}

export async function socialThreadUnread(provider: SocialInboxProvider, accountId: string, threadKeys: string[]) {
  const keys = [...new Set(threadKeys.filter(identifier))], output = new Map<string, number>();
  for (let offset = 0; offset < keys.length; offset += 100) {
    const result = await supabaseAdmin().rpc('tc_social_thread_unread', { p_provider: provider, p_account: accountId, p_threads: keys.slice(offset, offset + 100) });
    if (result.error || !Array.isArray(result.data)) throw unavailable();
    for (const row of result.data) output.set(String(row.thread_remote_id), Number(row.unread));
  }
  return output;
}

export async function markSocialThreadRead(userId: string, provider: SocialInboxProvider, accountId: string, threadKeys: string[], through: string) {
  if (typeof through !== 'string' || !Number.isFinite(Date.parse(through)) || Date.parse(through) > Date.now() + 60_000) throw new Error('INVALID_READ_BOUNDARY');
  const keys = [...new Set(threadKeys.filter(identifier))];
  if (!keys.length || keys.length > 20) throw new Error('INVALID_THREAD');
  const result = await supabaseAdmin().rpc('tc_social_mark_read', { p_user: userId, p_provider: provider, p_account: accountId, p_threads: keys, p_through: through });
  if (result.error) throw unavailable();
  return { ok: true, unread: Number(result.data?.unread || 0) };
}

export async function socialAttention(provider: SocialInboxProvider, accountId: string) {
  const result = await supabaseAdmin().rpc('tc_social_attention', { p_provider: provider, p_account: accountId });
  if (result.error || !result.data || !Number.isSafeInteger(result.data.count)) throw unavailable();
  return { ...result.data, account_id: accountId } as { count: number; messages: number; comments: number; revision: string; account_id: string };
}

export async function acquireSocialSync(provider: SocialInboxProvider, accountId: string, options: { cooldownSeconds?: number; force?: boolean } = {}) {
  const result = await supabaseAdmin().rpc('tc_social_claim_sync', { p_provider: provider, p_account: accountId,
    p_cooldown: Math.max(30, Math.min(300, options.cooldownSeconds || 60)), p_force: options.force === true });
  if (result.error) throw unavailable();
  return result.data?.token ? result.data as { token: string; cursor: Record<string, any> } : null;
}

export async function finishSocialSync(provider: SocialInboxProvider, accountId: string, token: string, cursor: Record<string, any>, errorCode?: string | null) {
  const result = await supabaseAdmin().rpc('tc_social_finish_sync', { p_provider: provider, p_account: accountId, p_token: token,
    p_cursor: cursor, p_error: errorCode ? String(errorCode).slice(0, 80) : null });
  if (result.error) throw unavailable();
}

export async function socialSyncState(provider: SocialInboxProvider, accountId: string) {
  const result = await supabaseAdmin().from('tc_social_inbox_sync').select('cursor,last_error').eq('provider', provider).eq('account_id', accountId).maybeSingle();
  if (result.error) throw unavailable();
  return { cursor: result.data?.cursor || {}, errorCode: result.data?.last_error || null };
}

export async function removeSocialActivity(provider: SocialInboxProvider, accountId: string, kind: 'message'|'comment', remoteIds: string[]) {
  const ids=[...new Set(remoteIds.filter(identifier))];
  if(!ids.length)return;
  const result=await supabaseAdmin().rpc('tc_social_remove_activity',{p_provider:provider,p_account:accountId,p_kind:kind,p_ids:ids});
  if(result.error)throw unavailable();
}
