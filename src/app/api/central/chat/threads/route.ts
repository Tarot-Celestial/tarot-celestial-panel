import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type GateOk = {
  ok: true;
  admin: SupabaseClient;
  worker: { id: string; role: string; display_name: string | null };
};

type GateErr = {
  ok: false;
  status: number;
  error: string;
};

type Gate = GateOk | GateErr;

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

function deny(status: number, error: string): GateErr {
  return { ok: false, status, error };
}

async function requireCentral(req: NextRequest): Promise<Gate> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return deny(401, "NO_AUTH");

  const admin = supabaseAdmin();

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return deny(401, "BAD_TOKEN");

  const { data: w, error: wErr } = await admin
    .from("workers")
    .select("id, role, display_name")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (wErr || !w) return deny(401, "NO_WORKER");
  if (w.role !== "central" && w.role !== "admin") return deny(403, "FORBIDDEN");

  return { ok: true, admin, worker: { id: String(w.id), role: String(w.role), display_name: w.display_name ?? null } };
}

export async function GET(req: NextRequest) {
  const gate = await requireCentral(req);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  // ✅ Aquí TS ya sabe que gate.admin existe
  const { admin } = gate;

  const { data, error } = await admin
    .from("chat_threads")
    .select(
      `
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
    `
    )
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  const threads = (data || []).map((t: any) => {
    const msgs = (t.chat_messages || []).slice().sort((a: any, b: any) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });
    const last = msgs[0] || null;

    return {
      id: String(t.id),
      title: t.title ?? null,
      tarotist_worker_id: t.tarotist_worker_id ?? null,
      tarotist_display_name: null,
      last_message_text: last?.text ?? null,
      last_message_at: last?.created_at ?? null,
      unread_count: null,
    };
  });

  return NextResponse.json({ ok: true, threads });
}
