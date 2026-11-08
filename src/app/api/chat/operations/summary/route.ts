import { NextResponse } from 'next/server';
import { getStaffChatActor } from '@/lib/server/staff-chat';
import { staffOperationError, staffOperationsSummary } from '@/lib/server/staff-chat-operations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export async function GET(req: Request) {
  try { const { db, me } = await getStaffChatActor(req); return NextResponse.json({ ok: true, ...await staffOperationsSummary(db, me) }, { headers }); }
  catch (error) { const { code, status } = staffOperationError(error); return NextResponse.json({ ok: false, error: code }, { status, headers }); }
}
