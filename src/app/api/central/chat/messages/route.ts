// src/app/api/central/chat/messages/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export async function GET(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });
    }

    const url = new URL(req.url);
    const thread_id = url.searchParams.get("thread_id");
    if (!thread_id) return NextResponse.json({ ok: false, error: "MISSING_THREAD" }, { status: 400 });

    const admin = supabaseAdmin();

    const { data, error } = await admin
      .from("chat_messages")
      .select("id, thread_id, sender_worker_id, sender_display_name, body, created_at")
      .eq("thread_id", thread_id)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    // ✅ tu UI espera text, devolvemos text=body
    const messages = (data || []).map((m: any) => ({
      id: String(m.id),
      thread_id: String(m.thread_id),
      sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
      sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
      text: m.body != null ? String(m.body) : "",
      created_at: m.created_at != null ? String(m.created_at) : null,
    }));

    return NextResponse.json({ ok: true, messages });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
