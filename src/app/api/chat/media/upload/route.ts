import { NextResponse } from "next/server";
import { getStaffChatActor, requireStaffChatConnection } from "@/lib/server/staff-chat";
import { reserveStaffMedia, staffMediaError, requireExpectedChatActor } from "@/lib/server/staff-chat-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
 try {
  const { db, me } = await getStaffChatActor(req);
  const body = await req.json().catch(() => ({}));
  requireExpectedChatActor(body, me);
  await requireStaffChatConnection(db, me);
  const data = await reserveStaffMedia(db, me, body);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
 } catch (error) {
  const { code, status } = staffMediaError(error);
  return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
 }
}
