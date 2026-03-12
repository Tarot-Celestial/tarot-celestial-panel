import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getAdminFromToken(req: Request) {
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

  let { data: me } = await admin
    .from("workers")
    .select("id, role, email, user_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (!me && email) {
    const r2 = await admin
      .from("workers")
      .select("id, role, email, user_id")
      .eq("email", email)
      .maybeSingle();
    me = r2.data as any;
  }

  if (!me) return { ok: false as const, error: "NO_WORKER" as const };
  if (me.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };

  return { ok: true as const, admin, me };
}

export async function GET(req: Request) {
  try {
    const gate = await getAdminFromToken(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    }

    const { admin } = gate;

    const { data: workers, error: workersErr } = await admin
      .from("workers")
      .select("id, display_name, role, team, is_active, email, user_id")
      .in("role", ["tarotista", "central"])
      .order("role", { ascending: true })
      .order("display_name", { ascending: true });

    if (workersErr) throw workersErr;

    const workerIds = (workers || []).map((w: any) => w.id);

    let schedules: any[] = [];
    if (workerIds.length > 0) {
      const { data: sch, error: schErr } = await admin
        .from("shift_schedules")
        .select("id, worker_id, day_of_week, start_time, end_time, timezone, is_active, created_at")
        .in("worker_id", workerIds)
        .order("worker_id", { ascending: true })
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true });

      if (schErr) throw schErr;
      schedules = sch || [];
    }

    return NextResponse.json({
      ok: true,
      workers: workers || [],
      schedules,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
