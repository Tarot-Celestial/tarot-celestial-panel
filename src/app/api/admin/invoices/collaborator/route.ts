import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  createCollaboratorReportExclusion,
  findCollaboratorReportExclusion,
  loadCollaboratorMonthlyReport,
} from "@/lib/server/collaborator-billing";
import { normalizeText } from "@/lib/server/auth-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("INVALID_MONTH");
  return value;
}

function errorResponse(error: unknown) {
  const message = (error as any)?.message || "COLLABORATOR_REPORT_ERROR";
  const status = message === "COLLABORATOR_NOT_FOUND"
    ? 404
    : [
        "INVALID_MONTH",
        "MISSING_COLLABORATOR_ID",
        "INVALID_COLLABORATOR_ID",
        "INVALID_SOURCE_RECORD_ID",
        "INVALID_RECORD_TYPE",
        "INVALID_SOURCE_TABLE",
        "INVALID_DELETION_REASON",
      ].includes(message)
        ? 400
        : message === "RECORD_NOT_FOUND"
          ? 404
          : message === "MARIO_DELETE_ONLY"
            ? 403
            : message === "COLLABORATOR_EXCLUSIONS_MIGRATION_REQUIRED"
              ? 503
              : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
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
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const body = await req.json().catch(() => ({}));
    const collaboratorId = String(body?.collaborator_id || "").trim();
    const month = normalizeMonth(String(body?.month || "").trim());
    const recordType = String(body?.record_type || "").trim() as "service" | "payment";
    const sourceTable = String(body?.source || "").trim() as "rendimiento_llamadas" | "crm_cliente_pagos";
    const sourceRecordId = String(body?.record_id || "").trim();
    const deletionReason = String(body?.reason || "").trim();
    const deletionNote = String(body?.note || "").trim();

    if (!collaboratorId) throw new Error("MISSING_COLLABORATOR_ID");
    if (!["service", "payment"].includes(recordType)) throw new Error("INVALID_RECORD_TYPE");
    if (!["rendimiento_llamadas", "crm_cliente_pagos"].includes(sourceTable)) throw new Error("INVALID_SOURCE_TABLE");
    if (!sourceRecordId) throw new Error("INVALID_SOURCE_RECORD_ID");
    if (!["registro_prueba", "registro_duplicado", "importe_incorrecto", "cliente_incorrecto", "operacion_anulada", "otro"].includes(deletionReason)) {
      throw new Error("INVALID_DELETION_REASON");
    }

    const report = await loadCollaboratorMonthlyReport(gate.admin, collaboratorId, month);
    const isMario = normalizeText(report.collaborator?.display_name) === "mario"
      || normalizeText(report.tag?.name) === "call mario";
    if (!isMario) throw new Error("MARIO_DELETE_ONLY");

    const records = recordType === "service" ? report.services : recordType === "payment" ? report.payments : [];
    const targetExists = records.some((record: any) => (
      String(record?.id || "") === sourceRecordId
      && String(record?.source || "") === sourceTable
    ));

    if (!targetExists) {
      const existing = await findCollaboratorReportExclusion(
        gate.admin,
        collaboratorId,
        sourceTable,
        sourceRecordId
      );
      if (!existing) throw new Error("RECORD_NOT_FOUND");

      const refreshedReport = await loadCollaboratorMonthlyReport(gate.admin, collaboratorId, month);
      return NextResponse.json(
        { ok: true, already_deleted: true, report: refreshedReport },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const result = await createCollaboratorReportExclusion(gate.admin, {
      collaboratorId,
      recordType,
      sourceTable,
      sourceRecordId,
      monthKey: month,
      deletionReason,
      deletionNote,
      deletedByWorkerId: String(gate.me?.id || ""),
      deletedByName: String(gate.me?.display_name || gate.me?.email || "Administrador"),
    });

    const refreshedReport = await loadCollaboratorMonthlyReport(gate.admin, collaboratorId, month);
    return NextResponse.json(
      { ok: true, created: result.created, report: refreshedReport },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[admin/invoices/collaborator DELETE]", error);
    return errorResponse(error);
  }
}
