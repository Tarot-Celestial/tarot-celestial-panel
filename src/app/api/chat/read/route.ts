import { NextResponse } from "next/server";
import { getStaffChatActor, requireStaffChatConnection, requireStaffChatThread, requireStaffChatUuid, staffChatError } from "@/lib/server/staff-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    await requireStaffChatConnection(db, me);
    const body = await req.json().catch(() => ({}));
    const threadId = String(body?.thread_id || "").trim();
    const messageId = String(body?.through_message_id || "").trim();
    if (!threadId) throw new Error("MISSING_THREAD_ID");
    if (!messageId) throw new Error("MISSING_MESSAGE_ID");
    requireStaffChatUuid(messageId, "MESSAGE");
    await requireStaffChatThread(db, me, threadId);
    const { data, error } = await db.rpc("staff_chat_mark_read", {
      p_worker_id: me.id, p_thread_id: threadId, p_through_message_id: messageId,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, thread_id: threadId, last_read_at: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
