import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { SOCIAL_CONNECTIONS_TABLE } from '@/lib/server/social-connections';
import { validInstagramSignature, instagramWebhookEvents } from '@/lib/server/instagram-webhook';
import { processInstagramWebhook } from '@/lib/server/instagram-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: object, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const token = Buffer.from(params.get('hub.verify_token') || '');
  const expected = Buffer.from(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '');
  if (params.get('hub.mode') !== 'subscribe' || !expected.length || token.length !== expected.length || !timingSafeEqual(token, expected)) return json({ ok: false }, 403);
  return new Response(params.get('hub.challenge') || '', { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1000000) return json({ ok: false }, 413);
  if (!validInstagramSignature(raw, req.headers.get('x-hub-signature-256'), process.env.INSTAGRAM_APP_SECRET || '')) return json({ ok: false }, 401);
  try {
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return json({ ok: false }, 400); }
    const db = supabaseAdmin();
    const connection = await db.from(SOCIAL_CONNECTIONS_TABLE).select('account_id,username,metadata').eq('provider', 'instagram').maybeSingle();
    if (connection.error || !connection.data?.account_id) return json({ ok: false }, 503);
    const verified=connection.data.metadata?.instagram_verified_account_ids;
    const verifiedAccountIds=Array.isArray(verified)?verified.filter((value:unknown):value is string=>typeof value==='string'&&/^\d{1,40}$/.test(value)).slice(0,10):[];
    await processInstagramWebhook(body, {accountId:String(connection.data.account_id),username:String(connection.data.username || ''),token:'',verifiedAccountIds});
    const events = instagramWebhookEvents(body, String(connection.data.account_id), verifiedAccountIds);
    if (events.length) {
      const saved = await db.from('tc_instagram_webhook_events').upsert(events, { onConflict: 'event_key', ignoreDuplicates: true });
      if (saved.error) return json({ ok: false }, 503);
    }
    return json({ ok: true });
  } catch { return json({ ok: false }, 503); }
}
