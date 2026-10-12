import { NextResponse } from 'next/server';
import { assistantAuth, AssistantError } from '@/lib/server/central-assistant';
import { claimReservationReminder, upcomingReservations } from '@/lib/server/central-assistant-reservations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  return json({ ok: false, error: error instanceof AssistantError ? error.message : 'No puedo consultar las reservas ahora. Volveré a intentarlo.' }, error instanceof AssistantError ? error.status : 503);
}

export async function GET(request: Request) {
  try {
    const ctx = await assistantAuth(request);
    const reservations = await upcomingReservations(ctx);
    return json({ ok: true, workerId: ctx.worker.id, userId: ctx.worker.user_id, reservations, serverNow: new Date().toISOString() });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await assistantAuth(request);
    if (Number(request.headers.get('content-length') || 0) > 1024) throw new AssistantError('Petición demasiado grande.', 413);
    const body = await request.json();
    const result = await claimReservationReminder(ctx, body);
    return json({ ok: true, workerId: ctx.worker.id, userId: ctx.worker.user_id, ...result });
  } catch (error) { return failure(error); }
}
