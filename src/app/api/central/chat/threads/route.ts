import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

async function requireCentral(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, error: "NO_AUTH" as const };

  const admin = supabaseAdmin();

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return { ok: false, error: "BAD_TOKEN" as const };

  // Tu tabla workers debe mapear user_id -> role
  const { data: w, error: wErr } = await admin
    .from("workers")
    .select("id, role, display_name")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (wErr || !w) return { ok: false, error: "NO_WORKER" as const };
  if (w.role !== "central" && w.role !== "admin") return { ok: false, error: "FORBIDDEN" as const };

  return { ok: true, worker: w, admin };
}

export async function GET(req: NextRequest) {
  const gate = await requireCentral(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 401 });

  const admin = gate.admin;

  // Trae threads + último mensaje (si tienes FK chat_messages.thread_id -> chat_threads.id)
  const { data, error } = await admin
    .from("chat_threads")
    .select(`
      id,
      title,
      tarotist_worker_id,
      created_at,
      chat_messages (
        id,
        text,
        created_at,
        sender_worker_id,
        sender_display_name
      )
    `)
    // Ordena threads por actividad: si no tienes updated_at, usamos created_at y luego el frontend ya ordena por last_message_at
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  // Normaliza "last_message_*" para tu UI
  const threads = (data || []).map((t: any) => {
    const msgs = (t.chat_messages || []).slice().sort((a: any, b: any) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });
    const last = msgs[0] || null;
    return {
      id: t.id,
      title: t.title ?? null,
      tarotist_worker_id: t.tarotist_worker_id ?? null,
      tarotist_display_name: null, // si quieres, lo unimos luego con workers
      last_message_text: last?.text ?? null,
      last_message_at: last?.created_at ?? null,
      unread_count: null, // opcional
    };
  });

  return NextResponse.json({ ok: true, threads });
}
