import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const schedule_id = String(body?.schedule_id || body?.id || "").trim();
    if (!schedule_id) return NextResponse.json({ ok: false, error: "SCHEDULE_ID_REQUIRED" }, { status: 400 });

    const { error } = await gate.admin.from("shift_schedules").delete().eq("id", schedule_id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
