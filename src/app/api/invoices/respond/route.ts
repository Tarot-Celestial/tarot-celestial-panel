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

export async function POST(req: Request) {
  try {
    const me = await getWorkerFromToken(req);
    if (!me.ok) return NextResponse.json(me, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const month = String(body.month || "");
    const action = String(body.action || ""); // accepted | rejected
    const note = String(body.note || "").trim();

    if (!month) return NextResponse.json({ ok: false, error: "month required" }, { status: 400 });
    if (action !== "accepted" && action !== "rejected") {
      return NextResponse.json({ ok: false, error: "action must be accepted|rejected" }, { status: 400 });
    }

    const { data: inv, error: invErr } = await me.admin
      .from("invoices")
      .select("id")
      .eq("worker_id", me.worker.id)
      .eq("month_key", month)
      .maybeSingle();

    if (invErr) throw invErr;
    if (!inv) return NextResponse.json({ ok: false, error: "invoice not found" }, { status: 404 });

    const { error } = await me.admin
      .from("invoices")
      .update({
        worker_ack: action,
        worker_ack_at: new Date().toISOString(),
        worker_ack_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inv.id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
