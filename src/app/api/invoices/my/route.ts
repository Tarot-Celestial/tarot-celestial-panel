import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getWorkerFromToken(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, error: "NO_TOKEN" as const };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || null;
  const email = u?.user?.email || null;
  if (!uid) return { ok: false as const, error: "BAD_TOKEN" as const };

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let { data: w } = await admin
    .from("workers")
    .select("id, role, display_name, user_id, email")
    .eq("user_id", uid)
    .maybeSingle();

  if (!w && email) {
    const r2 = await admin
      .from("workers")
      .select("id, role, display_name, user_id, email")
      .eq("email", email)
      .maybeSingle();
    w = r2.data as any;
  }

  if (!w) return { ok: false as const, error: "NO_WORKER" as const };
  return { ok: true as const, worker: w, admin };
}

export async function GET(req: Request) {
  try {
    const me = await getWorkerFromToken(req);
    if (!me.ok) return NextResponse.json(me, { status: 401 });

    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || "";
    if (!month) return NextResponse.json({ ok: false, error: "month required" }, { status: 400 });

    const { data: inv, error: invErr } = await me.admin
      .from("invoices")
      .select("id, month_key, status, total, worker_ack, worker_ack_at, worker_ack_note, updated_at")
      .eq("worker_id", me.worker.id)
      .eq("month_key", month)
      .maybeSingle();

    if (invErr) throw invErr;

    if (!inv) return NextResponse.json({ ok: true, invoice: null, lines: [] });

    const { data: lines, error: lerr } = await me.admin
      .from("invoice_lines")
      .select("id, kind, label, amount, meta, created_at")
      .eq("invoice_id", inv.id)
      .order("created_at", { ascending: true });

    if (lerr) throw lerr;

    return NextResponse.json({ ok: true, invoice: inv, lines: lines || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
