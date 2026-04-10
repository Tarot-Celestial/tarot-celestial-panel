import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const threadId = String(searchParams.get("thread_id") || "").trim();
    if (!threadId) return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });

    const admin = supabaseAdmin();
    const { data: thread, error: threadErr } = await admin.from("cliente_chat_threads").select("*").eq("id", threadId).maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });

    const { data: messages, error } = await admin
      .from("cliente_chat_messages")
      .select("id, thread_id, sender_type, sender_worker_id, sender_cliente_id, sender_display_name, body, kind, meta, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(400);
    if (error) throw error;

    return NextResponse.json({ ok: true, thread, messages: messages || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_THREAD" }, { status: 500 });
  }
}
