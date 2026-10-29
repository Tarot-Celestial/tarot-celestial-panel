import { NextResponse } from "next/server";
import { GET as getMessages } from "@/app/api/chat/messages/route";
import { getStaffChatActor, staffChatError } from "@/lib/server/staff-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { me } = await getStaffChatActor(req);
    if (!["central", "admin"].includes(me.role)) throw new Error("FORBIDDEN");
    return getMessages(req);
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
