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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const batch_date = String(body?.batch_date || todayISO()).slice(0, 10);
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) return NextResponse.json({ ok: false, error: "ITEMS_REQUIRED" }, { status: 400 });

    const db = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: me, error: meErr } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (me.role !== "tarotista") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const { data: existing, error: existingErr } = await db
      .from("outbound_batches")
      .select("id")
      .eq("batch_date", batch_date)
      .eq("created_by_worker_id", me.id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing?.id) return NextResponse.json({ ok: false, error: "BATCH_ALREADY_EXISTS" }, { status: 409 });

    const { data: batch, error: batchErr } = await db
      .from("outbound_batches")
      .insert({
        batch_date,
        created_by_worker_id: me.id,
        status: "pending",
      })
      .select("id, batch_date, status, created_at")
      .single();
    if (batchErr) throw batchErr;

    const payload = items.map((item: any, idx: number) => ({
      batch_id: batch.id,
      customer_name: String(item?.customer_name || item?.name || "").trim(),
      phone: item?.phone ? String(item.phone).trim() : null,
      priority: Number(item?.priority || 0),
      position: Number(item?.position || idx + 1),
      current_status: "pending",
    })).filter((x: any) => x.customer_name);

    if (!payload.length) {
      await db.from("outbound_batches").delete().eq("id", batch.id);
      return NextResponse.json({ ok: false, error: "VALID_ITEMS_REQUIRED" }, { status: 400 });
    }

    const { error: itemsErr } = await db.from("outbound_batch_items").insert(payload);
    if (itemsErr) throw itemsErr;

    return NextResponse.json({ ok: true, batch });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
