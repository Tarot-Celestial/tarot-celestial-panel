import { NextResponse } from "next/server";
import { GET as getThreads } from "@/app/api/chat/threads/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const response = await getThreads(req);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) return NextResponse.json(body || { ok: false, error: "CHAT_ERROR" }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  if (!["central", "admin"].includes(body.mode)) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  // Preserve the old inbox field names while retaining private-thread scoping
  // and the exact unread counts returned by the shared authenticated endpoint.
  const threads = (body.threads || []).map((thread: any) => ({
    ...thread,
    tarotist_display_name: thread.contact?.display_name || "Tarotista",
    last_message_text: thread.last_message_preview || null,
  }));
  return NextResponse.json({ ...body, threads }, { status: response.status, headers: { "Cache-Control": "no-store" } });
}
