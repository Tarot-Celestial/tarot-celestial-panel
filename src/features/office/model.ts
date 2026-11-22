export const OFFICE_FILE_LIMIT = 2 * 1024 * 1024;
export const OFFICE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"] as const;

export type OfficePriority = "baja" | "media" | "alta";
export type OfficeStatus = "pendiente" | "en_curso" | "en_revision" | "completado" | "cancelado";
export type OfficeDecision = "aprobado" | "cambios" | "rechazado";
export type OfficeWorker = { id: string; name: string };
export type OfficeDepartment = {
  id: string; name: string; purpose: string; lead_worker_id: string | null; revision: number;
};
export type OfficeTaskInput = {
  department_id: string;
  objective: string;
  priority: OfficePriority;
  due_at: string | null;
  time_zone: string;
  assignee_worker_id: string | null;
  assignee_role: "atlas" | "departamento" | null;
  expected_delivery: string;
  status: OfficeStatus;
};
export type OfficeTask = OfficeTaskInput & {
  id: string; revision: number; created_by: string; created_at: string; updated_at: string;
};
export type OfficeVersion = {
  id: string; task_id: string; deliverable_id: string; version: number; title: string; body: string;
  file_name: string | null; file_type: string | null; file_size: number | null;
  status: "pendiente" | OfficeDecision; review_note: string | null; reviewed_by: string | null;
  reviewed_at: string | null; created_at: string; created_by: string;
};
export type OfficeEvent = {
  id: string; department_id: string; task_id: string | null; actor_id: string;
  previous_department_id?: string | null; kind: string; note: string; created_at: string;
};
export type OfficeSnapshot = {
  departments: OfficeDepartment[]; workers: OfficeWorker[]; tasks: OfficeTask[]; versions: OfficeVersion[];
  events: OfficeEvent[]; actorId: string;
};
export type OfficeData = OfficeSnapshot;
export type OfficeMutation = { request_id: string } & (
  | ({ action: "create_task" } & OfficeTaskInput)
  | ({ action: "update_task"; id: string; revision: number } & OfficeTaskInput)
  | { action: "set_lead"; department_id: string; revision: number; lead_worker_id: string | null }
  | { action: "add_note"; task_id: string; note: string }
  | { action: "add_version"; task_id: string; deliverable_id: string | null; base_version: number;
      title: string; body: string; file_name?: string | null; file_type?: string | null; file_base64?: string | null }
  | { action: "review_version"; id: string; decision: OfficeDecision; note: string }
);
