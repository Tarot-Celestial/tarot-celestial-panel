import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { FacebookError, facebookIdentity } from '@/lib/server/facebook-graph';
import { facebookInbox, facebookMessages, facebookRead, facebookResolve, facebookSend, ensureFacebookFresh } from '@/lib/server/facebook-inbox';
import { facebookDiagnostics, facebookSubscribe } from '@/lib/server/facebook-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  if (error instanceof FacebookError) return json({ ok: false, code: error.code, error: error.message }, error.status);
  return json({ ok: false, code: 'SERVICE_UNAVAILABLE', error: 'No se ha podido cargar Facebook. Actualiza en unos instantes.' }, 503);
}
export async function GET(req: Request) {
  try {
    const identity = await facebookIdentity(req);
    const params = new URL(req.url).searchParams;
    if (params.get('action') === 'diagnostics') {
      if (identity.worker.role !== 'admin') throw new FacebookError('FORBIDDEN', 'Solo administración puede comprobar la conexión.', 403);
      return json(await facebookDiagnostics());
    }
    if (params.get('action') === 'messages') return json(await facebookMessages(params.get('threadId') || '', params.get('requestId')));
    waitUntil(ensureFacebookFresh().catch(() => undefined));
    return json(await facebookInbox(params.get('kind') === 'comment' ? 'comment' : 'message', params.get('cursor')));
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const identity = await facebookIdentity(req);
    const action = new URL(req.url).searchParams.get('action');
    const body = await req.json().catch(() => null);
    if (action === 'subscribe') {
      if (identity.worker.role !== 'admin') throw new FacebookError('FORBIDDEN', 'Solo administración puede configurar la conexión.', 403);
      return json(await facebookSubscribe(body));
    }
    if (action === 'read') return json(await facebookRead(identity.userId, body));
    if (action === 'resolve') return json(await facebookResolve(identity.userId, body));
    if (action === 'send') return json(await facebookSend(identity.userId, body));
    return json({ ok: false, error: 'Acción no válida.' }, 400);
  } catch (error) { return failure(error); }
}
