import { NextResponse } from "next/server";
import { normalizeTeam, requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const worker_id = String(body?.worker_id || body?.id || "").trim();
    if (!worker_id) return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });

    const team = normalizeTeam(body?.team);

    const { data, error } = await gate.admin
      .from("workers")
      .update({ team })
      .eq("id", worker_id)
      .select("id, display_name, role, team, is_active")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, worker: data });
  } catch (e: any) {
    const status = e?.message === "INVALID_TEAM" ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}
