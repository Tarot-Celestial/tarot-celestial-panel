import { NextResponse } from "next/server";
import { getStaffChatActor, staffChatError } from "@/lib/server/staff-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicWorker(worker: any) {
  return { id: String(worker.id), display_name: String(worker.display_name || "Sin nombre"), role: String(worker.role), team: worker.team ? String(worker.team) : null, state: String(worker.state || "offline") };
}

export async function GET(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const contactRole = me.role === "tarotista" ? "central" : "tarotista";
    const contactsQuery = db.from("workers").select("id, display_name, role, team, state").eq("role", contactRole).eq("is_active", true).order("display_name");
    let threadsQuery = db.from("chat_threads").select("id, central_worker_id, tarotist_worker_id, status, created_at, last_message_at, last_message_preview, title").order("last_message_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
    if (me.role === "central") threadsQuery = threadsQuery.eq("central_worker_id", me.id);
    if (me.role === "tarotista") threadsQuery = threadsQuery.eq("tarotist_worker_id", me.id);
    const [{ data: contacts, error: contactsError }, { data: threads, error: threadsError }] = await Promise.all([contactsQuery, threadsQuery]);
    if (contactsError) throw contactsError;
    if (threadsError) throw threadsError;

    const threadIds = (threads || []).map((thread: any) => String(thread.id));
    const participantIds = Array.from(new Set((threads || []).flatMap((thread: any) => [thread.central_worker_id, thread.tarotist_worker_id]).filter(Boolean).map(String)));
    const { data: participants, error: participantError } = await db
      .from("workers")
      .select("id, display_name, role, team, state")
      .in("id", participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]);
    if (participantError) throw participantError;
    const workerById = new Map((participants || []).map((worker: any) => [String(worker.id), publicWorker(worker)]));
    const unreadByThread = new Map<string, number>();
    const { data: unreadRows, error: unreadError } = threadIds.length
      ? await db.rpc("staff_chat_unread_counts", { p_worker_id: me.id, p_thread_ids: threadIds })
      : { data: [], error: null };
    if (unreadError) throw unreadError;
    for (const row of unreadRows || []) unreadByThread.set(String(row.thread_id), Number(row.unread_count || 0));
    const normalizedThreads = (threads || []).map((thread: any) => {
      const otherId = me.role === "tarotista" ? thread.central_worker_id : thread.tarotist_worker_id;
      const legacyContact = !otherId && me.role === "tarotista" ? { id: `legacy:${thread.id}`, display_name: "Historial anterior", role: "central", team: null, state: "offline" } : null;
      return { ...thread, id: String(thread.id), contact: otherId ? workerById.get(String(otherId)) || null : legacyContact, unread_count: unreadByThread.get(String(thread.id)) || 0, legacy: !thread.central_worker_id };
    });
    const legacyContacts = normalizedThreads.filter((thread: any) => thread.legacy && thread.contact).map((thread: any) => thread.contact);
    return NextResponse.json({ ok: true, mode: me.role, me, contacts: [...(contacts || []).map(publicWorker), ...legacyContacts], threads: normalizedThreads, unread_total: normalizedThreads.reduce((total: number, thread: any) => total + Number(thread.unread_count || 0), 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    if (me.role === "admin") throw new Error("FORBIDDEN");
    const body = await req.json().catch(() => ({}));
    const requestedId = String(body?.contact_worker_id || body?.tarotist_worker_id || "").trim();
    if (!requestedId) throw new Error("MISSING_CONTACT_WORKER_ID");
    const { data: contact, error: contactError } = await db.from("workers").select("id, display_name, role, team, state, is_active").eq("id", requestedId).eq("is_active", true).maybeSingle();
    if (contactError) throw contactError;
    if (!contact?.id) throw new Error("CONTACT_NOT_FOUND");
    if ((me.role === "central" && contact.role !== "tarotista") || (me.role === "tarotista" && contact.role !== "central")) throw new Error("INVALID_CONTACT_ROLE");
    const centralWorkerId = me.role === "central" ? me.id : String(contact.id);
    const tarotistWorkerId = me.role === "tarotista" ? me.id : String(contact.id);
    const { data: existing, error: existingError } = await db.from("chat_threads").select("*").eq("central_worker_id", centralWorkerId).eq("tarotist_worker_id", tarotistWorkerId).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) return NextResponse.json({ ok: true, thread: existing, created: false });
    const { data: created, error: createError } = await db.from("chat_threads").insert({ central_worker_id: centralWorkerId, tarotist_worker_id: tarotistWorkerId, status: "open", title: `${me.display_name} · ${contact.display_name || "Chat"}` }).select("*").single();
    if (createError?.code === "23505") {
      const { data: raced, error: racedError } = await db.from("chat_threads").select("*").eq("central_worker_id", centralWorkerId).eq("tarotist_worker_id", tarotistWorkerId).single();
      if (racedError) throw racedError;
      return NextResponse.json({ ok: true, thread: raced, created: false });
    }
    if (createError) throw createError;
    return NextResponse.json({ ok: true, thread: created, created: true }, { status: 201 });
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}
