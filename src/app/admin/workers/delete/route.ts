import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const worker_id = String(body?.worker_id || body?.id || "").trim();
    const hard = !!body?.hard_delete;
    if (!worker_id) return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });

    if (hard) {
      const { error: schErr } = await gate.admin.from("shift_schedules").delete().eq("worker_id", worker_id);
      if (schErr) throw schErr;
      const { error: workerErr } = await gate.admin.from("workers").delete().eq("id", worker_id);
      if (workerErr) throw workerErr;
      return NextResponse.json({ ok: true, deleted: true, hard_delete: true });
    }

    const { error: workerErr } = await gate.admin.from("workers").update({ is_active: false }).eq("id", worker_id);
    if (workerErr) throw workerErr;

    const { error: schErr } = await gate.admin.from("shift_schedules").update({ active: false }).eq("worker_id", worker_id);
    if (schErr) throw schErr;

    return NextResponse.json({ ok: true, deleted: true, hard_delete: false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
