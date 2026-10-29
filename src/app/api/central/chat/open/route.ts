import { NextResponse } from "next/server";
import { POST as openThread } from "@/app/api/chat/threads/route";
import { getStaffChatActor, staffChatError } from "@/lib/server/staff-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { me } = await getStaffChatActor(req);
    if (!["central", "admin"].includes(me.role)) throw new Error("FORBIDDEN");
    // The secure route accepts the legacy tarotist_worker_id field as well.
    return openThread(req);
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}
