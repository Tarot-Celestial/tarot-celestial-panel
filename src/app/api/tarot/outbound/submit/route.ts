import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const batch_date: string = (body.batch_date || todayISO()).slice(0, 10);
    const note: string | null = body.note ?? null;
    const items: any[] = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      return NextResponse.json({ ok: false, error: "NO_ITEMS" }, { status: 400 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // 1) worker actual
    const { data: me, error: em } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
if (me.role !== "tarotista") {
  return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
}

    // 2) evitar duplicados por día (pies de plomo)
    const { data: existing, error: ee } = await db
      .from("outbound_batches")
      .select("id, status")
      .eq("batch_date", batch_date)
      .eq("created_by_worker_id", me.id)
      .maybeSingle();
    if (ee) throw ee;

    if (existing?.id) {
      return NextResponse.json(
        { ok: false, error: "BATCH_ALREADY_EXISTS", batch_id: existing.id, status: existing.status },
        { status: 409 }
      );
    }

    // 3) crear batch
    const { data: batch, error: eb } = await db
      .from("outbound_batches")
      .insert({
        batch_date,
        created_by_worker_id: me.id,
        note,
        status: "submitted",
      })
      .select("id, batch_date, status, created_at")
      .single();
    if (eb) throw eb;

    // 4) insertar items
    const payload = items
      .map((it, idx) => ({
        batch_id: batch.id,
        customer_name: String(it?.customer_name ?? it?.name ?? "").trim(),
        phone: it?.phone ?? null,
        priority: Number.isFinite(it?.priority) ? it.priority : 0,
        position: Number.isFinite(it?.position) ? it.position : idx + 1,
      }))
      .filter((x) => x.customer_name.length > 0);

    if (!payload.length) {
      return NextResponse.json({ ok: false, error: "EMPTY_ITEMS" }, { status: 400 });
    }

    const { error: ei } = await db.from("outbound_batch_items").insert(payload);
    if (ei) throw ei;

    return NextResponse.json({
      ok: true,
      batch: { ...batch, created_by_worker_id: me.id },
      inserted: payload.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
