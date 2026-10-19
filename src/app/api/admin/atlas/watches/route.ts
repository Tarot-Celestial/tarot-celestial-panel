import { NextResponse } from 'next/server';
import { atlasContext, AtlasError } from '@/lib/server/atlas-access';
import { atlasChangeMinuteWatch, atlasMinuteWatches } from '@/lib/server/atlas-minute-watches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  if (error instanceof AtlasError) return reply({ ok: false, error: error.message }, error.status);
  const message = error instanceof Error ? error.message : String((error as any)?.message || '');
  if (/CLIENT_NOT_FOUND|WATCH_NOT_FOUND|ALERT_NOT_FOUND/.test(message)) return reply({ ok: false, error: 'No encuentro este seguimiento en tu cuenta. Actualiza los avisos.' }, 404);
  if (/FORBIDDEN/.test(message)) return reply({ ok: false, error: 'Atlas está reservado a administración.' }, 403);
  return reply({ ok: false, error: 'No pude comprobar los avisos de minutos. Reintenta; no se ha supuesto ningún saldo.' }, 503);
}
export async function GET(req: Request) {
  try { return reply({ ok: true, ...await atlasMinuteWatches(await atlasContext(req)) }); }
  catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const ctx = await atlasContext(req);
    const raw = await req.text();
    if (raw.length > 2000) throw new AtlasError('Solicitud demasiado larga.', 413);
    let body: unknown; try { body = JSON.parse(raw); } catch { throw new AtlasError('Solicitud no válida.'); }
    return reply({ ok: true, ...await atlasChangeMinuteWatch(ctx, body) });
  } catch (error) { return failure(error); }
}
