import { officeRequest } from "./office-client";

export const runStatus = {
  queued: "En cola", running: "En curso", review: "Listo para revisión",
  waiting_input: "Faltan datos del encargo", waiting_connection: "Pendiente de conexión",
  failed: "La ejecución falló", limit_reached: "Límite alcanzado", cancelled: "Cancelado",
  needs_reconciliation: "Resultado pendiente de comprobación",
};

export type OfficeRun = {
  id: string;
  task_id: string;
  step: 0 | 1 | 2 | 3;
  status: keyof typeof runStatus;
  outputs: { "0"?: { brief?: string; sources?: { id: string; version: string; label: string }[] }; "1"?: { caption?: string }; "2"?: Record<string, unknown> } | null;
  last_error: string | null;
  usage: Record<string, unknown> | null;
  revision_id: string | null;
  result_version_id?: string | null;
  created_at: string;
  updated_at: string;
};

export const officeRunsPath = "/api/admin/office/runs";

export function startOfficeRun(taskId: string, requestId: string, revisionId?: string) {
  return officeRequest(officeRunsPath, {
    method: "POST",
    body: JSON.stringify({ action: "start", task_id: taskId, request_id: requestId, revision_id: revisionId }),
  });
}

export function isActiveRun(run: OfficeRun) {
  return run.status === "queued" || run.status === "running";
}
