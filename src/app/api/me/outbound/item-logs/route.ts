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

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const item_id = String(searchParams.get("item_id") || "").trim();
    if (!item_id) return NextResponse.json({ ok: false, error: "MISSING_ITEM_ID" }, { status: 400 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // asegurar tarotista
    const { data: me, error: em } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;

    if (!me || me.role !== "tarotista") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    // comprobar que el item pertenece al tarotista
    const { data: owns, error: eo } = await db
      .from("outbound_batch_items")
      .select(`
        id,
        batch:outbound_batches!outbound_batch_items_batch_id_fkey (id, created_by_worker_id)
      `)
      .eq("id", item_id)
      .maybeSingle();

    if (eo) throw eo;
    if (!owns?.id) return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });

    const createdBy = owns.batch?.[0]?.created_by_worker_id;
    if (String(createdBy) !== String(me.id)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    // logs del item
    const { data: logs, error: el } = await db
      .from("outbound_call_logs")
      .select(`
        id, status, note, created_at, duration_seconds,
        called_by:workers!outbound_call_logs_called_by_worker_id_fkey (id, display_name)
      `)
      .eq("item_id", item_id)
      .order("created_at", { ascending: false });

    if (el) throw el;

    return NextResponse.json({ ok: true, item_id, logs: logs ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
