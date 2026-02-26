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

function isRecent(ts: string | null, seconds: number) {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= seconds * 1000;
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // Verificar que es central
    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (String(me.role) !== "central") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // Traer tarotistas (OJO: tu tabla workers NO tiene team_key)
    const { data: ws, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role")
      .eq("role", "tarotista");

    if (ew) throw ew;

    const workerIds = (ws || []).map((w: any) => String(w.id));
    if (!workerIds.length) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    // Traer estados actuales
    const { data: st, error: es } = await admin
      .from("attendance_state")
      .select("worker_id, is_online, status, last_event_at, updated_at")
      .in("worker_id", workerIds);

    if (es) throw es;

    const byId = new Map<string, any>();
    for (const r of st || []) byId.set(String(r.worker_id), r);

    // Online real: heartbeat/actividad reciente
    const ONLINE_WINDOW_SECONDS = 90;

    const rows = (ws || []).map((w: any) => {
      const sid = String(w.id);
      const s = byId.get(sid) || null;
      const last = s?.last_event_at ? String(s.last_event_at) : null;

      const onlineReal = !!s?.is_online && isRecent(last, ONLINE_WINDOW_SECONDS);
      const status = onlineReal ? String(s?.status || "working") : "offline";

      return {
        worker_id: sid,
        display_name: w.display_name || "—",
        team_key: null, // compat: tu tabla no tiene team_key
        online: onlineReal,
        status,
        last_event_at: last,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
