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

function normalizeAction(input: any): "accepted" | "rejected" | "review" | null {
  const v = String(input || "").trim().toLowerCase();

  if (v === "accepted") return "accepted";
  if (v === "rejected") return "rejected";
  if (v === "review") return "review";

  return null;
}

export async function POST(req: Request) {
  try {
    const me = await getWorkerFromToken(req);
    if (!me.ok) return NextResponse.json(me, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // Compatibilidad con frontend actual y con el formato nuevo
    const invoiceId = String(body.invoiceId || "").trim();
    const month = String(body.month || "").trim();

    const action =
      normalizeAction(body.status) ||
      normalizeAction(body.action);

    const note = String(body.workerNote ?? body.note ?? "").trim();

    if (!invoiceId && !month) {
      return NextResponse.json(
        { ok: false, error: "invoiceId or month required" },
        { status: 400 }
      );
    }

    if (!action) {
      return NextResponse.json(
        { ok: false, error: "status/action must be accepted|rejected|review" },
        { status: 400 }
      );
    }

    let query = me.admin
      .from("invoices")
      .select("id, worker_id, month_key, status, worker_ack")
      .eq("worker_id", me.worker.id);

    if (invoiceId) {
      query = query.eq("id", invoiceId);
    } else {
      query = query.eq("month_key", month);
    }

    const { data: inv, error: invErr } = await query.maybeSingle();

    if (invErr) throw invErr;

    if (!inv) {
      return NextResponse.json(
        { ok: false, error: "invoice not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    const payload = {
      status: action,                 // ← ESTO ES LO QUE FALTABA
      worker_ack: action,
      worker_ack_at: now,
      worker_ack_note: note || null,
      updated_at: now,
    };

    const { error: updateErr } = await me.admin
      .from("invoices")
      .update(payload)
      .eq("id", inv.id)
      .eq("worker_id", me.worker.id);

    if (updateErr) throw updateErr;

    const { data: updated, error: readBackErr } = await me.admin
      .from("invoices")
      .select("*")
      .eq("id", inv.id)
      .maybeSingle();

    if (readBackErr) throw readBackErr;

    return NextResponse.json({
      ok: true,
      invoice: updated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
