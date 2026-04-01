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
    const schedule_id = String(body?.schedule_id || body?.id || "").trim();
    if (!schedule_id) return NextResponse.json({ ok: false, error: "SCHEDULE_ID_REQUIRED" }, { status: 400 });

    const patch: any = {};
    if (body?.worker_id !== undefined) patch.worker_id = String(body.worker_id || "").trim();
    if (body?.day_of_week !== undefined) {
      const day = Number(body.day_of_week);
      if (![0,1,2,3,4,5,6].includes(day)) return NextResponse.json({ ok: false, error: "INVALID_DAY_OF_WEEK" }, { status: 400 });
      patch.day_of_week = day;
    }
    if (body?.start_time !== undefined) patch.start_time = validateTime(body.start_time);
    if (body?.end_time !== undefined) patch.end_time = validateTime(body.end_time);
    if (body?.timezone !== undefined) patch.timezone = String(body.timezone || "Europe/Madrid").trim() || "Europe/Madrid";
    if (body?.active !== undefined) patch.active = !!body.active;

    const { error } = await gate.admin.from("shift_schedules").update(patch).eq("id", schedule_id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.message === "INVALID_TIME" ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}
