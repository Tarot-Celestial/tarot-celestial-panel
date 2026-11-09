import { NextResponse } from "next/server";
import { getStaffChatActor, requireStaffChatConnection, requireStaffChatThread, staffChatError } from "@/lib/server/staff-chat";
import { messageAttachments, sendStaffMediaMessage, staffMediaError, requireExpectedChatActor } from "@/lib/server/staff-chat-media";
import { enrichStaffOperationMessages } from "@/lib/server/staff-chat-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseBefore(value: string | null): { createdAt: string; id: string | null } | null {
  if (value === null) return null;
  if (value.length > 100) throw new Error("INVALID_CURSOR");
  const parts = value.split("|");
  const composite = parts.length === 3 && parts[0] === "v1";
  if (parts.length !== 1 && !composite) throw new Error("INVALID_CURSOR");
  const createdAt = composite ? parts[1] : value;
  const id = composite ? parts[2] : null;
  // These values enter PostgREST's filter grammar: allow only a complete ISO
  // timestamp and UUID, never arbitrary filter expressions or delimiters.
  if (id !== null && (id.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error("INVALID_CURSOR");
  const date = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!date || date[0] !== createdAt) throw new Error("INVALID_CURSOR");
  const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
    Number(date[4]) > 23 || Number(date[5]) > 59 || Number(date[6]) > 59 ||
    Number(date[7] || 0) > 15 || Number(date[8] || 0) > 59 || !Number.isFinite(Date.parse(createdAt))) throw new Error("INVALID_CURSOR");
  // Do not round-trip through Date/toISOString: Postgres retains microseconds.
  return { createdAt, id: id?.toLowerCase() ?? null };
}

export async function GET(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const url = new URL(req.url);
    const threadId = String(url.searchParams.get("thread_id") || "");
    const before = parseBefore(url.searchParams.get("before"));
    const requestedLimit = url.searchParams.get("limit");
    if (requestedLimit !== null && (!/^\d+$/.test(requestedLimit) || !Number.isSafeInteger(Number(requestedLimit)) || Number(requestedLimit) < 1)) throw new Error("INVALID_LIMIT");
    const limit = Math.min(50, Math.max(10, Number(requestedLimit ?? 40)));
    if (!threadId) throw new Error("MISSING_THREAD_ID");
    const thread = await requireStaffChatThread(db, me, threadId);

    let query = db.from("chat_messages").select("id, thread_id, sender_worker_id, sender_display_name, body, created_at, updated_at, kind, client_message_id").eq("thread_id", threadId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (before?.id) {
      query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
    } else if (before) {
      // Existing tabs may still hold the previous timestamp-only cursor.
      query = query.lt("created_at", before.createdAt);
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const hasMore = rows.length > limit;
    const page: Record<string, any>[] = await enrichStaffOperationMessages(db, thread, rows.slice(0, limit).reverse());
    const attachments = await messageAttachments(db, page.map((message: any) => String(message.id)));
    const otherWorkerId = me.id === String(thread.central_worker_id || "") ? String(thread.tarotist_worker_id) : String(thread.central_worker_id || "");
    const { data: otherRead, error: readError } = otherWorkerId ? await db.from("chat_thread_reads").select("last_read_at").eq("thread_id", threadId).eq("worker_id", otherWorkerId).maybeSingle() : { data: null, error: null };
    if (readError) throw readError;
    // Fetching or preloading a conversation never acknowledges it. The visible
    // chat sends its rendered message ID to /api/chat/read separately.
    return NextResponse.json({
      ok: true,
      thread_id: threadId,
      messages: page.map((message: any) => ({
        id: String(message.id), thread_id: String(message.thread_id), sender_worker_id: String(message.sender_worker_id), sender_display_name: String(message.sender_display_name || ""), text: String(message.body || ""), created_at: String(message.created_at), client_message_id: message.client_message_id ? String(message.client_message_id) : null,
        read_at: otherRead?.last_read_at && new Date(otherRead.last_read_at).getTime() >= new Date(message.created_at).getTime() ? String(otherRead.last_read_at) : null,
        attachment: attachments.get(String(message.id)) || null,
        kind: message.kind || "text",
        updated_at: message.updated_at ? String(message.updated_at) : null,
        consultation: message.consultation || null,
      })),
      has_more: hasMore,
      next_cursor: hasMore && page[0] ? `v1|${page[0].created_at}|${page[0].id}` : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const body = await req.json().catch(() => ({}));
    requireExpectedChatActor(body, me);
    await requireStaffChatConnection(db, me);
    const threadId = String(body?.thread_id || "").trim();
    const text = String(body?.text ?? body?.body ?? "").trim();
    const clientMessageId = String(body?.client_message_id || "").trim() || crypto.randomUUID();
    const attachmentId = String(body?.attachment_id || "").trim();
    if (!threadId) throw new Error("MISSING_THREAD_ID");
    if (!text && !attachmentId) throw new Error("EMPTY_BODY");
    if (text.length > 2000) throw new Error("INVALID_MESSAGE_LENGTH");
    if (clientMessageId.length > 128) throw new Error("INVALID_CLIENT_MESSAGE_ID");
    await requireStaffChatThread(db, me, threadId);

    if (attachmentId) {
      const result = await sendStaffMediaMessage(db, me, threadId, clientMessageId, text, attachmentId);
      const saved = result.message;
      return NextResponse.json({ ok: true, thread_id: threadId, message: {
        id: String(saved.id), thread_id: String(saved.thread_id), sender_worker_id: String(saved.sender_worker_id),
        sender_display_name: String(saved.sender_display_name || me.display_name), text: String(saved.body || ""),
        created_at: String(saved.created_at), client_message_id: saved.client_message_id, read_at: null, attachment: result.attachment,
      } }, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
    }

    const { data: inserted, error } = await db.from("chat_messages").insert({ thread_id: threadId, sender_worker_id: me.id, sender_display_name: me.display_name, body: text, client_message_id: clientMessageId }).select("id, thread_id, sender_worker_id, sender_display_name, body, created_at, client_message_id").single();
    let saved = inserted;
    if (error?.code === "23505") {
      const { data: existing, error: existingError } = await db.from("chat_messages").select("id, thread_id, sender_worker_id, sender_display_name, body, created_at, client_message_id").eq("sender_worker_id", me.id).eq("client_message_id", clientMessageId).single();
      if (existingError) throw existingError;
      if (String(existing?.thread_id) !== threadId || String(existing?.body) !== text) throw new Error("MESSAGE_ID_CONFLICT");
      if ((await messageAttachments(db, [String(existing.id)])).size) throw new Error("MESSAGE_ID_CONFLICT");
      saved = existing;
    } else if (error) throw error;
    if (!saved) throw new Error("MESSAGE_NOT_SAVED");

    await db.from("chat_threads").update({ last_message_at: saved.created_at, last_message_preview: text.slice(0, 180), status: "open" }).eq("id", threadId);
    return NextResponse.json({ ok: true, thread_id: threadId, message: { id: String(saved.id), thread_id: String(saved.thread_id), sender_worker_id: String(saved.sender_worker_id), sender_display_name: String(saved.sender_display_name || me.display_name), text: String(saved.body || ""), created_at: String(saved.created_at), client_message_id: saved.client_message_id ? String(saved.client_message_id) : clientMessageId, read_at: null } }, { status: error?.code === "23505" ? 200 : 201 });
  } catch (error) {
    const { code, status } = staffMediaError(error);
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}
