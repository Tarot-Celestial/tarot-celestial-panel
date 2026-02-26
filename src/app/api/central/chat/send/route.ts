import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type GateOk = {
  ok: true;
  admin: SupabaseClient;
  worker: { id: string; role: string; display_name: string | null };
};
type GateErr = { ok: false; status: number; error: string };
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

export async function POST(req: NextRequest) {
  const gate = await requireCentral(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const thread_id = String(body.thread_id || "");
  const text = String(body.text || "").trim();

  if (!thread_id) return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "EMPTY_TEXT" }, { status: 400 });

  const { data, error } = await gate.admin
    .from("chat_messages")
    .insert({
      thread_id,
      sender_worker_id: gate.worker.id,
      sender_display_name: gate.worker.display_name || "Central",
      text,
    })
    .select("id, thread_id, sender_worker_id, sender_display_name, text, created_at")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, message: data });
}
