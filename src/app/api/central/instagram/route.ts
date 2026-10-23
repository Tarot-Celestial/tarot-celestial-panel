import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { InstagramError, instagramIdentity } from '@/lib/server/instagram-graph';
import { instagramInbox, instagramMessages, instagramSend, instagramResolve, instagramRead } from '@/lib/server/instagram-inbox';
import { ensureInstagramFresh } from '@/lib/server/instagram-sync';
import { subscribeInstagram } from '@/lib/server/instagram-subscriptions';
import { instagramDiagnostics } from '@/lib/server/instagram-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  if (error instanceof InstagramError) return json({ ok: false, code: error.code, error: error.message }, error.status);
  return json({ ok: false, code: 'SERVICE_UNAVAILABLE', error: 'No se ha podido cargar Instagram. Actualiza en unos instantes.' }, 503);
}
export async function GET(req: Request) {
  try {
    const identity = await instagramIdentity(req);
    const params = new URL(req.url).searchParams;
    if (params.get('action') === 'diagnostics') {
      if (identity.worker.role !== 'admin') throw new InstagramError('FORBIDDEN', 'Solo administración puede comprobar la conexión.', 403);
      return json(await instagramDiagnostics());
    }
    if (params.get('action') === 'messages') return json(await instagramMessages(params.get('threadId') || '', params.get('requestId')));
    const result=await instagramInbox(params.get('kind') === 'comment' ? 'comment' : 'message', params.get('cursor'));
    waitUntil(ensureInstagramFresh().catch(()=>{}));
    return json(result);
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const identity = await instagramIdentity(req);
    const action = new URL(req.url).searchParams.get('action');
    if(action==='subscribe') {
      if(identity.worker.role!=='admin')throw new InstagramError('FORBIDDEN','Solo administración puede configurar la conexión.',403);
      return json(await subscribeInstagram());
    }
    if (action !== 'send' && action !== 'resolve' && action !== 'read') return json({ ok: false, error: 'Acción no válida.' }, 400);
    const body = await req.json().catch(() => null);
    return json(await (action==='read'?instagramRead(identity.userId,body):action === 'resolve' ? instagramResolve(identity.userId, body) : instagramSend(identity.userId, body)));
  } catch (error) { return failure(error); }
}
