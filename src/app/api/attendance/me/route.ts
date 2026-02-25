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

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, display_name, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const worker_id = String(me.id);

    // estado actual
    const { data: st } = await admin
      .from("attendance_state")
      .select("worker_id, is_online, status, last_event_at, updated_at")
      .eq("worker_id", worker_id)
      .maybeSingle();

    // online REAL: heartbeat reciente
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: hb } = await admin
      .from("attendance_events")
      .select("at")
      .eq("worker_id", worker_id)
      .eq("event_type", "heartbeat")
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(1);

    const hasRecentHeartbeat = !!(hb && hb[0]?.at);

    const realOnline = hasRecentHeartbeat && (st?.is_online !== false);
    const status = realOnline ? (st?.status || "working") : "offline";

    return NextResponse.json({
      ok: true,
      worker: { id: worker_id, display_name: me.display_name, role: me.role },
      online: realOnline,
      status,
      last_event_at: st?.last_event_at || null,
      last_heartbeat_at: hb?.[0]?.at || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
