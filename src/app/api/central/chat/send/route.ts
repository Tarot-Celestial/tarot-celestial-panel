// src/app/api/central/chat/send/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const thread_id = String(body?.thread_id || "");
    const text = String(body?.text || "").trim();

    if (!thread_id) return NextResponse.json({ ok: false, error: "MISSING_THREAD" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "EMPTY_TEXT" }, { status: 400 });

    const admin = supabaseAdmin();

    // ✅ quién envía (central/admin)
    const me = gate.me || {};
    const sender_worker_id =
      (me.worker?.id ? String(me.worker.id) : me.worker_id ? String((me as any).worker_id) : null) || null;

    const sender_display_name =
      (me.worker?.display_name
        ? String((me.worker as any).display_name)
        : me.display_name
        ? String((me as any).display_name)
        : me.role === "admin"
        ? "Admin"
        : "Central") || "Central";

    const { data, error } = await admin
      .from("chat_messages")
      .insert({
        thread_id,
        sender_worker_id,
        sender_display_name,
        body: text, // ✅ en BD es body
      })
      .select("id, thread_id, sender_worker_id, sender_display_name, body, created_at")
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    // devuelve message con text=body
    const message = {
      id: String(data.id),
      thread_id: String(data.thread_id),
      sender_worker_id: data.sender_worker_id != null ? String(data.sender_worker_id) : null,
      sender_display_name: data.sender_display_name != null ? String(data.sender_display_name) : null,
      text: data.body != null ? String(data.body) : "",
      created_at: data.created_at != null ? String(data.created_at) : null,
    };

    return NextResponse.json({ ok: true, message });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
