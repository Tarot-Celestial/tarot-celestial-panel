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

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // asegurar admin
    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const since = new Date(Date.now() - 90_000).toISOString();

    // últimos heartbeats recientes
    const { data: hb, error: ehb } = await admin
      .from("attendance_events")
      .select("worker_id, at, meta")
      .eq("event_type", "heartbeat")
      .gte("at", since)
      .order("at", { ascending: false });
    if (ehb) throw ehb;

    // dedupe por worker_id quedándonos con el más reciente
    const byWorker: Record<string, any> = {};
    for (const r of hb || []) {
      const wid = String(r.worker_id);
      if (!byWorker[wid]) byWorker[wid] = r;
    }

    const ids = Object.keys(byWorker);
    if (ids.length === 0) return NextResponse.json({ ok: true, online: [] });

    const { data: workers, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role, team, shift_type")
      .in("id", ids);
    if (ew) throw ew;

    const online = (workers || []).map((w: any) => ({
      worker_id: w.id,
      display_name: w.display_name,
      role: w.role,
      team: w.team,
      shift_type: w.shift_type,
      last_seen_at: byWorker[String(w.id)]?.at || null,
      path: byWorker[String(w.id)]?.meta?.path || "",
    }));

    online.sort((a: any, b: any) => String(a.role).localeCompare(String(b.role)));

    return NextResponse.json({ ok: true, online });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
