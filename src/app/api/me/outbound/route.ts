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
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;
  return { uid: data.user?.id || null };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || todayISO()).slice(0, 10);

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me?.id) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    const { data: batch, error } = await db
      .from("outbound_batches")
      .select(`
        id, batch_date, note, status, created_at,
        sender:workers!outbound_batches_created_by_worker_id_fkey (id, display_name, role, team),
        outbound_batch_items (
          id, customer_name, phone, priority, position,
          current_status, last_call_at, last_note,
          last_called_by:workers!outbound_batch_items_last_called_by_worker_id_fkey (id, display_name)
        )
      `)
      .eq("batch_date", date)
      .eq("created_by_worker_id", me.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const normalized = batch
      ? {
          ...batch,
          outbound_batch_items: (batch.outbound_batch_items ?? [])
            .slice()
            .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
        }
      : null;

    return NextResponse.json({ ok: true, date, batch: normalized });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
