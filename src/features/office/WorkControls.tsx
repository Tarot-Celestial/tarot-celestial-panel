"use client";

import { useRef, useState } from "react";
import { OfficeRequestError, officeRequest } from "./office-client";
import type { OfficeMutation, OfficeSnapshot, OfficeTask } from "./model";
import styles from "./OfficeWork.module.css";

export const priorities = { baja: "Baja", media: "Media", alta: "Alta" };
export const taskStatuses = {
  pendiente: "Pendiente", en_curso: "En curso", en_revision: "En revisión",
  completado: "Completado", cancelado: "Cancelado",
};
export const reviewStatuses = {
  pendiente: "Pendiente de revisión", aprobado: "Aprobado", cambios: "Cambios solicitados", rechazado: "Rechazado",
};

export function workerName(data: OfficeSnapshot, id: string | null) {
  return data.workers.find(worker => worker.id === id)?.name || (id ? `Personal · ${id.slice(0, 8)}` : "Personal del equipo");
}

export function assigneeKey(task: OfficeTask) {
  return task.assignee_worker_id || task.assignee_role || "";
}

export function assigneeName(task: OfficeTask, data: OfficeSnapshot) {
  if (task.assignee_worker_id) return workerName(data, task.assignee_worker_id);
  if (task.assignee_role === "atlas") return "Atlas";
  if (task.assignee_role === "departamento") return "Equipo del departamento";
  return "Sin asignar";
}

export function AssigneeOptions({ data, current }: { data: OfficeSnapshot; current?: string }) {
  return <>
    <option value="atlas">Atlas</option>
    <option value="departamento">Equipo del departamento</option>
    {current && !["atlas", "departamento"].includes(current) && !data.workers.some(w => w.id === current) &&
      <option value={current}>{workerName(data, current)}</option>}
    {data.workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
  </>;
}

type OfficeAction = OfficeMutation extends infer M ? M extends { request_id: string } ? Omit<M, "request_id"> : never : never;

export function useOfficeSave(reload: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const locked = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);

  async function save(action: OfficeAction, success: string, afterSave?: (id: string) => void) {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setFeedback(null);
    let committed = false;
    try {
      const signature = JSON.stringify(action);
      if (request.current?.signature !== signature) {
        request.current = { signature, id: crypto.randomUUID() };
      }
      const result = await officeRequest<{ id: string }>("/api/admin/oficina", {
        method: "POST", body: JSON.stringify({ ...action, request_id: request.current.id }),
      });
      committed = true;
      await reload();
      request.current = null;
      setFeedback({ ok: true, text: success });
      afterSave?.(result.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Inténtalo de nuevo.";
      let message = committed ? "Se guardó el cambio. No se pudo actualizar la vista. " + detail : detail;
      if (!committed && error instanceof OfficeRequestError && error.status === 409) {
        try {
          await reload();
          message = "Otra persona ha actualizado el registro. Vuelve a abrirlo para trabajar con la versión actual.";
        } catch { /* Keep the server's conflict message when refresh also fails. */ }
      }
      setFeedback({ ok: false, text: message });
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  return { saving, save, feedback, error: (text: string) => setFeedback({ ok: false, text }) };
}

export function Feedback({ value }: { value: ReturnType<typeof useOfficeSave>["feedback"] }) {
  if (!value) return null;
  return <p className={value.ok ? styles.success : styles.error} role={value.ok ? "status" : "alert"}>{value.text}</p>;
}
