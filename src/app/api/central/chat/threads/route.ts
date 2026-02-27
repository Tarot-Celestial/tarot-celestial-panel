// src/app/api/central/chat/threads/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin"; // usa tu helper admin
import { gateCentralOrAdmin } from "@/lib/gate"; // si tienes un gate, si no, abajo te digo alternativa

export async function GET() {
  try {
    // ✅ Autoriza: central o admin
    const gate = await gateCentralOrAdmin(); // ajusta al tuyo
    if (!gate.ok) return NextResponse.json({ ok: false, error: "UNAUTH" }, { status: 401 });

    const admin = supabaseAdmin(); // 🔥 aquí ya no puede ser undefined si tu helper está bien

    // 1) Trae threads (solo columnas que existen)
    const { data: threads, error: thErr } = await admin
      .from("chat_threads")
      .select("id, tarotist_worker_id, created_at")
      .order("created_at", { ascending: false });

    if (thErr) return NextResponse.json({ ok: false, error: thErr.message }, { status: 400 });

    const threadIds = (threads || []).map((t) => t.id);

    // 2) Trae el último mensaje por thread (simple y robusto)
    // OJO: esto trae mensajes y luego reducimos a "último por thread"
    const { data: msgs, error: msgErr } = await admin
      .from("chat_messages")
      .select("id, thread_id, body, created_at, sender_worker_id, sender_display_name")
      .in("thread_id", threadIds.length ? threadIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });

    if (msgErr) return NextResponse.json({ ok: false, error: msgErr.message }, { status: 400 });

    const lastByThread = new Map<string, any>();
    for (const m of msgs || []) {
      if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, m);
    }

    // 3) Trae display_name de tarotistas
    const tarotistIds = Array.from(new Set((threads || []).map((t) => t.tarotist_worker_id).filter(Boolean)));
    const { data: workers, error: wErr } = await admin
      .from("workers")
      .select("id, display_name")
      .in("id", tarotistIds.length ? tarotistIds : ["00000000-0000-0000-0000-000000000000"]);

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });

    const nameById = new Map<string, string>();
    for (const w of workers || []) nameById.set(w.id, w.display_name || "—");

    // 4) Normaliza salida para tu UI (manteniendo text)
    const out = (threads || []).map((t) => {
      const last = lastByThread.get(t.id) || null;
      return {
        id: String(t.id),
        title: null, // tu tabla no tiene title → lo dejamos null
        tarotist_worker_id: t.tarotist_worker_id ? String(t.tarotist_worker_id) : null,
        tarotist_display_name: t.tarotist_worker_id ? nameById.get(String(t.tarotist_worker_id)) || "—" : "—",
        last_message_text: last?.body != null ? String(last.body) : null,
        last_message_at: last?.created_at != null ? String(last.created_at) : null,
        unread_count: 0, // si luego quieres unread real, lo añadimos
      };
    });

    // orden por último mensaje
    out.sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bt - at;
    });

    return NextResponse.json({ ok: true, threads: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
