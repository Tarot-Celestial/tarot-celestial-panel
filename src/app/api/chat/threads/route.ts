import { NextResponse } from "next/server";
import { getStaffChatActor, loadStaffChatPresence, requireStaffChatConnection, requireStaffChatUuid, staffChatError, type StaffChatPresence } from "@/lib/server/staff-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicWorker(worker: any, presence: Map<string, StaffChatPresence>) {
  const state = worker.is_active === false ? null : presence.get(String(worker.id));
  return { id: String(worker.id), display_name: String(worker.display_name || "Sin nombre"), role: String(worker.role), team: worker.team ? String(worker.team) : null, state: state?.state || 'offline', presence_expires_at: state?.presence_expires_at || null };
}

export async function GET(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const contactRoles = me.can_admin ? ["admin", "central", "tarotista"] : me.role === "tarotista" ? ["central", "admin"] : ["tarotista", "admin"];
    const contactsQuery = db.from("workers").select("id, display_name, role, team, state, is_active").in("role", contactRoles).eq("is_active", true).order("display_name");
    let threadsQuery = db.from("chat_threads").select("id, central_worker_id, tarotist_worker_id, status, created_at, last_message_at, last_message_preview, title").order("last_message_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
    if (me.role === "central" && !me.can_admin) threadsQuery = threadsQuery.eq("central_worker_id", me.id);
    if (me.role === "tarotista") threadsQuery = threadsQuery.eq("tarotist_worker_id", me.id);
    const [{ data: contacts, error: contactsError }, { data: threads, error: threadsError }, { data: hiddenContacts, error: hiddenContactsError }] = await Promise.all([
      contactsQuery,
      threadsQuery,
      db.from("staff_chat_hidden_contacts").select("contact_worker_id").eq("worker_id", me.id),
    ]);
    if (contactsError) throw contactsError;
    if (threadsError) throw threadsError;
    if (hiddenContactsError) throw hiddenContactsError;

    const threadIds = (threads || []).map((thread: any) => String(thread.id));
    const participantIds = Array.from(new Set((threads || []).flatMap((thread: any) => [thread.central_worker_id, thread.tarotist_worker_id]).filter(Boolean).map(String)));
    const { data: participants, error: participantError } = await db
      .from("workers")
      .select("id, display_name, role, team, is_active")
      .in("id", participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]);
    if (participantError) throw participantError;
    const presence = await loadStaffChatPresence(db, [me.id, ...(contacts || []).map((worker: any) => String(worker.id)), ...participantIds]);
    const workerById = new Map((participants || []).map((worker: any) => [String(worker.id), publicWorker(worker, presence.states)]));
    const unreadByThread = new Map<string, number>();
    const [{ data: unreadRows, error: unreadError }, { data: incomingRows, error: incomingError }] = threadIds.length
      ? await Promise.all([
        db.rpc("staff_chat_unread_counts", { p_worker_id: me.id, p_thread_ids: threadIds }),
        db.rpc("staff_chat_latest_incoming", { p_worker_id: me.id, p_thread_ids: threadIds }),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (unreadError) throw unreadError;
    if (incomingError) throw incomingError;
    for (const row of unreadRows || []) unreadByThread.set(String(row.thread_id), Number(row.unread_count || 0));
    const incomingByThread = new Map<string, any>((incomingRows || []).map((row: any) => [String(row.thread_id), {
      id: String(row.id), thread_id: String(row.thread_id), sender_worker_id: String(row.sender_worker_id),
      sender_display_name: String(row.sender_display_name || ""), text: String(row.text || ""), created_at: String(row.created_at),
    }]));
    const normalizedThreads = (threads || []).map((thread: any) => {
      const otherId = String(thread.tarotist_worker_id) === me.id ? thread.central_worker_id : thread.tarotist_worker_id;
      const legacyContact = !otherId && me.role === "tarotista" ? { id: `legacy:${thread.id}`, display_name: "Historial anterior", role: "central", team: null, state: "offline", presence_expires_at: null } : null;
      return { ...thread, id: String(thread.id), central_display_name: thread.central_worker_id ? workerById.get(String(thread.central_worker_id))?.display_name || 'Central' : 'Historial anterior', contact: otherId ? workerById.get(String(otherId)) || null : legacyContact, unread_count: unreadByThread.get(String(thread.id)) || 0, latest_incoming: incomingByThread.get(String(thread.id)) || null, legacy: !thread.central_worker_id };
    });
    // The contact list is also the entry point to existing conversations. A
    // worker leaving the team must not hide authorized history. Add only the
    // other participants of the already-scoped threads, never all inactive staff.
    // The active-worker/role requirements for opening a new chat stay in POST.
    const contactsById = new Map<string, ReturnType<typeof publicWorker>>();
    for (const worker of contacts || []) {
      if (String(worker.id) !== me.id) contactsById.set(String(worker.id), workerById.get(String(worker.id)) || publicWorker(worker, presence.states));
    }
    for (const thread of normalizedThreads) {
      const contact = thread.contact;
      if (contact && contact.id !== me.id && contactRoles.includes(contact.role) && !contactsById.has(contact.id)) {
        contactsById.set(contact.id, contact);
      }
    }
    return NextResponse.json({ ok: true, mode: me.can_admin ? "admin" : me.role, me: { ...me, ...presence.states.get(me.id) }, presence_checked_at: presence.checkedAt, contacts: [...contactsById.values()], threads: normalizedThreads, hidden_contact_ids: (hiddenContacts || []).map((row: any) => String(row.contact_worker_id)), unread_total: normalizedThreads.reduce((total: number, thread: any) => total + Number(thread.unread_count || 0), 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    await requireStaffChatConnection(db, me);
    const body = await req.json().catch(() => ({}));
    const requestedId = String(body?.contact_worker_id || body?.tarotist_worker_id || "").trim();
    if (!requestedId) throw new Error("MISSING_CONTACT_WORKER_ID");
    requireStaffChatUuid(requestedId, "CONTACT");
    const { data: contact, error: contactError } = await db.from("workers").select("id, display_name, role, team, state, is_active").eq("id", requestedId).eq("is_active", true).maybeSingle();
    if (contactError) throw contactError;
    if (!contact?.id) throw new Error("CONTACT_NOT_FOUND");
    const allowedRoles = me.can_admin ? ["admin", "central", "tarotista"] : me.role === "central" ? ["tarotista", "admin"] : ["central", "admin"];
    if (me.id === String(contact.id) || !allowedRoles.includes(contact.role)) throw new Error("INVALID_CONTACT_ROLE");
    // Legacy column names are preserved. A Central occupies the first slot,
    // a Tarotista the second; Admin takes the other slot. Either participant
    // therefore resolves the same unique pair without changing old histories.
    const centralWorkerId = me.role === "central" ? me.id : contact.role === "central" ? String(contact.id) : me.role === "admin" ? me.id : String(contact.id);
    const tarotistWorkerId = centralWorkerId === me.id ? String(contact.id) : me.id;
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
