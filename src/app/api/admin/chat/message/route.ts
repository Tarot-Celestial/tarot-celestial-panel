import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";
import { getClientChatCredits } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const threadId = String(body?.thread_id || "").trim();
    const text = String(body?.body || body?.text || "").trim();
    const kind = String(body?.kind || "text").trim();
    if (!threadId) return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "EMPTY_BODY" }, { status: 400 });

    const admin = supabaseAdmin();
    const { data: thread, error: threadErr } = await admin.from("cliente_chat_threads").select("*").eq("id", threadId).maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });

    const senderName = String(gate.me?.display_name || gate.me?.worker?.display_name || gate.me?.user?.email || "Admin");
    const senderWorkerId = String(gate.me?.id || gate.me?.worker?.id || "").trim() || null;

    const { data: inserted, error: insertErr } = await admin
      .from("cliente_chat_messages")
      .insert({
        thread_id: threadId,
        sender_type: kind === "payment_link" ? "admin" : "tarotista",
        sender_worker_id: senderWorkerId,
        sender_display_name: senderName,
        body: text,
        kind,
        meta: body?.meta || null,
      })
      .select("id, thread_id, sender_type, sender_worker_id, sender_cliente_id, sender_display_name, body, kind, meta, created_at")
      .single();
    if (insertErr) throw insertErr;

    const balance = await getClientChatCredits(admin, String(thread.cliente_id));
    const patch: any = {
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 140),
      creditos_restantes: balance,
      estado: "open",
    };
    if (!thread.free_reply_used) patch.free_reply_used = true;

    const { error: updateErr } = await admin.from("cliente_chat_threads").update(patch).eq("id", threadId);
    if (updateErr) throw updateErr;

    await admin.from("cliente_chat_tarotistas").upsert({
      worker_id: thread.tarotista_worker_id,
      is_online: true,
      is_busy: true,
      chat_enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "worker_id" });

    return NextResponse.json({ ok: true, message: inserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_MESSAGE" }, { status: 500 });
  }
}
