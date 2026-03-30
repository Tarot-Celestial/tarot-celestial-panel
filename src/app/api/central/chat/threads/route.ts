// src/app/api/central/chat/threads/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export async function GET(req: Request) {
  try {
    // ✅ Autoriza: central o admin
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // 1) Trae threads (solo columnas que existen)
    const { data: threads, error: thErr } = await admin
      .from("chat_threads")
      .select("id, tarotist_worker_id, created_at")
      .order("created_at", { ascending: false });

    if (thErr) return NextResponse.json({ ok: false, error: thErr.message }, { status: 400 });

    const threadIds = (threads || []).map((t: any) => t.id).filter(Boolean);

    // 2) Trae el último mensaje por thread (simple y robusto)
    const { data: msgs, error: msgErr } = await admin
      .from("chat_messages")
      .select("id, thread_id, body, created_at, sender_worker_id, sender_display_name")
      .in("thread_id", threadIds.length ? threadIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });

    if (msgErr) return NextResponse.json({ ok: false, error: msgErr.message }, { status: 400 });

    const lastByThread = new Map<string, any>();
    for (const m of msgs || []) {
      if (!lastByThread.has(String(m.thread_id))) lastByThread.set(String(m.thread_id), m);
    }

    // 3) Trae display_name de tarotistas
    const tarotistIds = Array.from(
      new Set((threads || []).map((t: any) => t.tarotist_worker_id).filter(Boolean).map(String))
    );

    const { data: workers, error: wErr } = await admin
      .from("workers")
      .select("id, display_name")
      .in("id", tarotistIds.length ? tarotistIds : ["00000000-0000-0000-0000-000000000000"]);

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });

    const nameById = new Map<string, string>();
    for (const w of workers || []) nameById.set(String(w.id), String(w.display_name || "—"));

    // 4) Normaliza salida para tu UI
    const out = (threads || []).map((t: any) => {
      const tid = String(t.id);
      const last = lastByThread.get(tid) || null;

      return {
        id: tid,
        title: null, // no existe columna title
        tarotist_worker_id: t.tarotist_worker_id ? String(t.tarotist_worker_id) : null,
        tarotist_display_name: t.tarotist_worker_id ? nameById.get(String(t.tarotist_worker_id)) || "—" : "—",
        last_message_text: last?.body != null ? String(last.body) : null,
        last_message_at: last?.created_at != null ? String(last.created_at) : null,
        unread_count: 0,
      };
    });

    // orden por último mensaje
    out.sort((a: any, b: any) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bt - at;
    });

    return NextResponse.json({ ok: true, threads: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
