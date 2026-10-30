import { NextResponse } from "next/server";
import { getStaffChatActor } from "@/lib/server/staff-chat";
import { readStaffMedia, staffMediaError } from "@/lib/server/staff-chat-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
 try {
  const { db, me } = await getStaffChatActor(req);
  const data = await readStaffMedia(db, me, new URL(req.url).searchParams.get("attachment_id") || "");
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
 } catch (error) {
  const { code, status } = staffMediaError(error);
  return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
 }
}
