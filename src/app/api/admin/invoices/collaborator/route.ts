import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadCollaboratorMonthlyReport } from "@/lib/server/collaborator-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("INVALID_MONTH");
  return value;
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const url = new URL(req.url);
    const collaboratorId = String(url.searchParams.get("collaborator_id") || "").trim();
    const month = normalizeMonth(String(url.searchParams.get("month") || "").trim());
    if (!collaboratorId) {
      return NextResponse.json({ ok: false, error: "MISSING_COLLABORATOR_ID" }, { status: 400 });
    }

    const report = await loadCollaboratorMonthlyReport(gate.admin, collaboratorId, month);
    return NextResponse.json(
      { ok: true, report },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    const message = e?.message || "COLLABORATOR_REPORT_ERROR";
    const status = message === "COLLABORATOR_NOT_FOUND" ? 404 : message === "INVALID_MONTH" ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
