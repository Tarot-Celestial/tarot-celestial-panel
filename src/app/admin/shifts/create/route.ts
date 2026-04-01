import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

function validateTime(value: any) {
  const s = String(value || "").trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) throw new Error("INVALID_TIME");
  return s.length === 5 ? `${s}:00` : s;
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const worker_id = String(body?.worker_id || "").trim();
    const day_of_week = Number(body?.day_of_week);
    const start_time = validateTime(body?.start_time);
    const end_time = validateTime(body?.end_time);
    const timezone = String(body?.timezone || "Europe/Madrid").trim() || "Europe/Madrid";
    const active = body?.active === undefined ? true : !!body.active;

    if (!worker_id) return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });
    if (![0,1,2,3,4,5,6].includes(day_of_week)) return NextResponse.json({ ok: false, error: "INVALID_DAY_OF_WEEK" }, { status: 400 });

    const { data, error } = await gate.admin
      .from("shift_schedules")
      .insert({ worker_id, day_of_week, start_time, end_time, timezone, active })
      .select("id, worker_id, day_of_week, start_time, end_time, timezone, active, created_at")
      .maybeSingle();

    if (error) throw error;
    return NextResponse.json({ ok: true, schedule: data });
  } catch (e: any) {
    const status = e?.message === "INVALID_TIME" ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}
