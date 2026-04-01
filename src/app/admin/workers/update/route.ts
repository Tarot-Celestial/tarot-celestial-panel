import { NextResponse } from "next/server";
import { normalizeRole, normalizeTeam, requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const worker_id = String(body?.worker_id || body?.id || "").trim();
    if (!worker_id) return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });

    const patch: any = {};
    if (body?.display_name !== undefined) patch.display_name = String(body.display_name || "").trim();
    if (body?.email !== undefined) patch.email = String(body.email || "").trim() || null;
    if (body?.role !== undefined) patch.role = normalizeRole(body.role);
    if (body?.team !== undefined) patch.team = normalizeTeam(body.team);
    if (body?.is_active !== undefined) patch.is_active = !!body.is_active;

    const { error } = await gate.admin.from("workers").update(patch).eq("id", worker_id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.message === "INVALID_ROLE" || e?.message === "INVALID_TEAM" ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}
