import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { validFacebookSignature } from '@/lib/server/facebook-webhook';
import { processFacebookWebhook } from '@/lib/server/facebook-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const expected = Buffer.from(String(process.env.META_VERIFY_TOKEN || '').trim());
  const actual = Buffer.from(params.get('hub.verify_token') || '');
  if (params.get('hub.mode') !== 'subscribe' || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new NextResponse('VERIFY_FAILED', { status: 403 });
  return new NextResponse(params.get('hub.challenge') || '', { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > 524288) return NextResponse.json({ ok: false }, { status: 413 });
  if (!validFacebookSignature(raw, req.headers.get('x-hub-signature-256'), String(process.env.META_APP_SECRET || '').trim())) return NextResponse.json({ ok: false }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  try { return NextResponse.json({ ok: true, ...await processFacebookWebhook(body) }); }
  catch { return NextResponse.json({ ok: false, error: 'FACEBOOK_INGEST_UNAVAILABLE' }, { status: 503 }); }
}
