import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const url = new URL(req.url);
    const worker_id = String(url.searchParams.get("worker_id") || "").trim();

    let query = gate.admin
      .from("shift_schedules")
      .select("id, worker_id, day_of_week, start_time, end_time, timezone, active, created_at")
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (worker_id) query = query.eq("worker_id", worker_id);

    const { data: schedules, error } = await query;
    if (error) throw error;

    const workerIds = Array.from(new Set((schedules || []).map((s: any) => s.worker_id).filter(Boolean)));
    const { data: workers, error: wErr } = await gate.admin
      .from("workers")
      .select("id, display_name, role, team, is_active")
      .in("id", workerIds.length ? workerIds : ["00000000-0000-0000-0000-000000000000"]);

    if (wErr) throw wErr;
    const workerMap = new Map((workers || []).map((w: any) => [String(w.id), w]));

    const rows = (schedules || []).map((s: any) => ({
      ...s,
      worker: workerMap.get(String(s.worker_id)) || null,
      is_active: !!s.active,
    }));

    return NextResponse.json({ ok: true, schedules: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
