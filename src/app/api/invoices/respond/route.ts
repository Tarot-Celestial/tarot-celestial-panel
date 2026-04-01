import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;
  return { uid: data.user?.id || null };
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const invoice_id = String(body?.invoice_id || body?.id || "").trim();
    const ack = String(body?.worker_ack || body?.status || "").trim().toLowerCase();
    const note = String(body?.worker_ack_note || body?.note || "").trim() || null;

    if (!invoice_id) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });
    if (!["pending", "accepted", "rejected", "review"].includes(ack)) {
      return NextResponse.json({ ok: false, error: "INVALID_WORKER_ACK" }, { status: 400 });
    }

    const admin = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: me, error: meErr } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("id, worker_id, status, worker_ack")
      .eq("id", invoice_id)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!invoice?.id) return NextResponse.json({ ok: false, error: "INVOICE_NOT_FOUND" }, { status: 404 });

    if (me.role !== "admin" && String(invoice.worker_id || "") !== String(me.id)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const patch: any = {
      worker_ack: ack,
      worker_ack_note: note,
      worker_ack_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (ack === "accepted" || ack === "rejected") patch.status = ack;
    if (ack === "review") patch.status = "pending";

    const { data, error } = await admin
      .from("invoices")
      .update(patch)
      .eq("id", invoice_id)
      .select("id, worker_id, status, worker_ack, worker_ack_note, worker_ack_at, updated_at")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, invoice: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
