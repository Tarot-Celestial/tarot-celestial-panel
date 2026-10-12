import { NextResponse } from 'next/server';
import { assistantAuth, AssistantError } from '@/lib/server/central-assistant';
import { learningAction, learningPayload, reviewLearning } from '@/lib/server/central-assistant-learning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(e: unknown) { return json({ ok: false, error: e instanceof AssistantError ? e.message : 'No he podido actualizar el aprendizaje. Reintenta la operación.' }, e instanceof AssistantError ? e.status : 500); }
export async function GET(req: Request) {
  try { return json(await learningPayload(await assistantAuth(req), [], new URL(req.url).searchParams.get('episodeId'))); } catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    const ctx = await assistantAuth(req);
    if (Number(req.headers.get('content-length') || 0) > 4000) throw new AssistantError('Petición demasiado grande.', 413);
    const raw = await req.text();
    if (raw.length > 4000) throw new AssistantError('Petición demasiado grande.', 413);
    let body: any;
    try { body = JSON.parse(raw); } catch { throw new AssistantError('Petición no válida.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AssistantError('Petición no válida.');
    const focusedId = new URL(req.url).searchParams.get('episodeId');
    if (body.action === 'review') return json(await learningPayload(ctx, await reviewLearning(ctx), focusedId));
    await learningAction(ctx, body);
    return json(await learningPayload(ctx, [], focusedId || body.episodeId));
  } catch (e) { return failure(e); }
}
