import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifiedAttendanceWorker, panelAttendanceEvent } from '@/lib/server/panel-attendance';

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const gate = await verifiedAttendanceWorker(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const uid = gate.uid;
    const body = await req.json().catch(() => ({}));
    if (gate.worker.role === 'admin' || gate.worker.role === 'central') {
      const result = await panelAttendanceEvent(gate.db, gate.worker, 'heartbeat', body);
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    // guardamos heartbeat
    const ua = req.headers.get("user-agent") || "";
    const path = String(body?.path || "");

    const { error: ei } = await admin.from("attendance_events").insert({
      worker_id: me.id,
      event_type: "heartbeat",
      meta: { path, ua },
    });
    if (ei) throw ei;

    return NextResponse.json({ ok: true, worker_id: me.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
