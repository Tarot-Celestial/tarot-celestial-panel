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

  const thread_id = req.nextUrl.searchParams.get("thread_id") || "";
  if (!thread_id) return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });

  const { data, error } = await gate.admin
    .from("chat_messages")
    .select("id, thread_id, sender_worker_id, sender_display_name, text, created_at")
    .eq("thread_id", thread_id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, messages: data || [] });
}
