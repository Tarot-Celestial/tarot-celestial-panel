import { NextResponse } from 'next/server';
import { getStaffChatActor, requireStaffChatConnection } from '@/lib/server/staff-chat';
import { requireExpectedChatActor, staffMediaError } from '@/lib/server/staff-chat-media';
import { appearanceInput, readChatAppearance, saveChatAppearance, uploadChatAppearance } from '@/lib/server/staff-chat-appearance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const result = message === 'APPEARANCE_CHANGED' ? { code: message, status: 409 } : staffMediaError(error);
  return NextResponse.json({ ok: false, error: result.code }, { status: result.status, headers });
}
export async function GET(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const threadId = new URL(req.url).searchParams.get('thread_id') || '';
    return NextResponse.json({ ok: true, ...await readChatAppearance(db, me, threadId) }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    await requireStaffChatConnection(db, me);
    const body = await req.json(); requireExpectedChatActor(body, me);
    const input = appearanceInput(body), threadId = String(body.thread_id || '');
    await saveChatAppearance(db, me, threadId, input.scope, input.revision, input.values);
    return NextResponse.json({ ok: true, ...await readChatAppearance(db, me, threadId) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    await requireStaffChatConnection(db, me);
    if (Number(req.headers.get('content-length') || 0) > 3 * 1024 * 1024) throw new Error('INVALID_APPEARANCE_SIZE');
    const form = await req.formData(); requireExpectedChatActor({ expected_worker_id: form.get('expected_worker_id') }, me);
    const threadId = await uploadChatAppearance(db, me, form);
    return NextResponse.json({ ok: true, ...await readChatAppearance(db, me, threadId) }, { headers });
  } catch (error) { return failure(error); }
}
