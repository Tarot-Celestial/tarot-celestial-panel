import { NextResponse } from "next/server";
import { getStaffChatActor, requireStaffChatUuid, staffChatError } from "@/lib/server/staff-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hiding is a personal preference: never delete a thread or its messages.
export async function POST(req: Request) {
  try {
    const { db, me } = await getStaffChatActor(req);
    const body = await req.json().catch(() => ({}));
    const contactId = String(body?.contact_worker_id || "").trim();
    requireStaffChatUuid(contactId, "CONTACT");
    if (typeof body?.hidden !== "boolean") throw new Error("INVALID_VISIBILITY");
    if (contactId === me.id) throw new Error("FORBIDDEN");

    const allowedRoles = me.can_admin ? ["admin", "central", "tarotista"] : me.role === "tarotista" ? ["central", "admin"] : ["tarotista", "admin"];
    const { data: contact, error: contactError } = await db.from("workers")
      .select("id, role, is_active").eq("id", contactId).maybeSingle();
    if (contactError) throw contactError;
    if (!contact || !allowedRoles.includes(contact.role)) throw new Error("CONTACT_NOT_FOUND");

    // Former colleagues remain eligible only when this actor can already see
    // a shared historical thread (or can supervise it as administrator).
    if (contact.is_active === false) {
      const scope = me.can_admin
        ? `central_worker_id.eq.${contactId},tarotist_worker_id.eq.${contactId}`
        : `and(central_worker_id.eq.${me.id},tarotist_worker_id.eq.${contactId}),and(tarotist_worker_id.eq.${me.id},central_worker_id.eq.${contactId})`;
      const { data: history, error: historyError } = await db.from("chat_threads").select("id").or(scope).limit(1);
      if (historyError) throw historyError;
      if (!history?.length) throw new Error("CONTACT_NOT_FOUND");
    }

    if (body.hidden) {
      const { error } = await db.from("staff_chat_hidden_contacts")
        .upsert({ worker_id: me.id, contact_worker_id: contactId }, { onConflict: "worker_id,contact_worker_id" });
      if (error) throw error;
    } else {
      const { error } = await db.from("staff_chat_hidden_contacts")
        .delete().eq("worker_id", me.id).eq("contact_worker_id", contactId);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, contact_worker_id: contactId, hidden: body.hidden }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { code, status } = staffChatError(error);
    return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
