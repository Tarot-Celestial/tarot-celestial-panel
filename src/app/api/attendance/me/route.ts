import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getWorkerByUserIdCached } from "@/lib/server/worker-cache";
import { verifiedAttendanceWorker, panelAttendanceEvent } from '@/lib/server/panel-attendance';

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    const gate = await verifiedAttendanceWorker(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const uid = gate.uid;
    if (['admin', 'central', 'tarotista'].includes(gate.worker.role)) {
      return NextResponse.json(await panelAttendanceEvent(gate.db, gate.worker, 'status'));
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const me = await getWorkerByUserIdCached(admin, uid, "id, display_name, role");
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const worker_id = String(me.id);

    // estado manual (NO depende de heartbeat)
    const { data: st, error: es } = await admin
      .from("attendance_state")
      .select("worker_id, is_online, status, last_event_at, updated_at")
      .eq("worker_id", worker_id)
      .maybeSingle();
    if (es) throw es;

    // señal/heartbeat (solo informativo)
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: hb, error: eh } = await admin
      .from("attendance_events")
      .select("at")
      .eq("worker_id", worker_id)
      .eq("event_type", "heartbeat")
      .order("at", { ascending: false })
      .limit(1);
    if (eh) throw eh;

    const lastHeartbeatAt = hb && hb[0]?.at ? String(hb[0].at) : null;
    const heartbeatOk = lastHeartbeatAt ? new Date(lastHeartbeatAt).getTime() >= new Date(since).getTime() : false;

    // ✅ ONLINE MANUAL: solo depende del estado
    const manualOnline = st?.is_online === true;
    const status = manualOnline ? String(st?.status || "working") : "offline";

    return NextResponse.json({
      ok: true,
      worker: { id: worker_id, display_name: me.display_name, role: me.role },

      // ✅ lo que manda para el sistema
      online: manualOnline,
      status,

      // ✅ informativo (para “señal”)
      heartbeat_ok: heartbeatOk,
      last_heartbeat_at: lastHeartbeatAt,

      last_event_at: st?.last_event_at || null,
      updated_at: st?.updated_at || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
