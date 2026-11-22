"use client";

import { FormEvent, useId, useMemo, useState } from "react";
import type { OfficeSnapshot, OfficeTask, OfficeTaskInput } from "./model";
import { AssigneeOptions, assigneeKey, Feedback, priorities, taskStatuses, useOfficeSave } from "./WorkControls";
import { canonicalZone, deadlineCandidates, localMinute } from "./WorkTime";
import styles from "./OfficeWork.module.css";

type Props = {
  task?: OfficeTask;
  departmentId?: string;
  data: OfficeSnapshot;
  reload: () => Promise<void>;
  onClose: () => void;
  onSaved: (id: string) => void;
};

export default function WorkTaskForm({ task, departmentId, data, reload, onClose, onSaved }: Props) {
  const [department, setDepartment] = useState(task?.department_id || departmentId || "");
  const [objective, setObjective] = useState(task?.objective || "");
  const [delivery, setDelivery] = useState(task?.expected_delivery || "");
  const [priority, setPriority] = useState<OfficeTask["priority"]>(task?.priority || "media");
  const [status, setStatus] = useState<OfficeTask["status"]>(task?.status || "pendiente");
  const [assignee, setAssignee] = useState(task ? assigneeKey(task) : "departamento");
  const [zone, setZone] = useState(task?.time_zone || "Europe/Madrid");
  const originalDate = task?.due_at ? localMinute(new Date(task.due_at), task.time_zone) : "";
  const originalInstant = task?.due_at ? new Date(Math.floor(Date.parse(task.due_at) / 60000) * 60000).toISOString() : "";
  const [date, setDate] = useState(originalDate);
  const [instant, setInstant] = useState(originalInstant);
  const id = useId();
  const operation = useOfficeSave(reload);
  const dates = useMemo(() => {
    try { return deadlineCandidates(date, zone.trim()); } catch { return null; }
  }, [date, zone]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!objective.trim() || !delivery.trim()) return operation.error("Escribe el objetivo y la entrega esperada.");
    if (!dates) return operation.error("Introduce una zona horaria válida, por ejemplo Europe/Madrid.");
    if (date && !dates.length) return operation.error("Esta hora no existe en la zona elegida. Revisa la fecha o la hora.");
    if (dates.length > 1 && !dates.includes(instant)) return operation.error("Elige cuál de las dos horas corresponde al plazo.");
    const selectedInstant = dates.length > 1 ? instant : dates[0] || null;
    const keepDeadline = task?.due_at && zone === task.time_zone && date === originalDate && selectedInstant === originalInstant;
    const input: OfficeTaskInput = {
      department_id: department, objective: objective.trim(), expected_delivery: delivery.trim(),
      priority, status, time_zone: zone === task?.time_zone ? zone : canonicalZone(zone),
      due_at: keepDeadline ? task.due_at : selectedInstant,
      assignee_role: assignee === "atlas" || assignee === "departamento" ? assignee : null,
      assignee_worker_id: assignee && assignee !== "atlas" && assignee !== "departamento" ? assignee : null,
    };
    await operation.save(task
      ? { action: "update_task", id: task.id, revision: task.revision, ...input }
      : { action: "create_task", ...input }, "Encargo guardado.", onSaved);
  }

  return <form className={styles.card} onSubmit={submit} aria-labelledby={id}>
    <h3 id={id}>{task ? "Editar encargo" : "Nuevo encargo"}</h3>
    <fieldset disabled={operation.saving} className={styles.formGrid}>
      <label className={styles.wide}><span id={id + "-objective"}>Objetivo</span>
        <textarea aria-labelledby={id + "-objective"} autoFocus required maxLength={4000} rows={2} value={objective} onChange={e => setObjective(e.target.value)} />
      </label>
      <label><span id={id + "-department"}>Departamento</span>
        <select aria-labelledby={id + "-department"} required value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="" disabled>Seleccionar departamento</option>
          {data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label><span id={id + "-assignee"}>Responsable</span>
        <select aria-labelledby={id + "-assignee"} value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">Sin asignar</option><AssigneeOptions data={data} current={assignee} />
        </select>
      </label>
      <label><span id={id + "-priority"}>Prioridad</span>
        <select aria-labelledby={id + "-priority"} value={priority} onChange={e => setPriority(e.target.value as OfficeTask["priority"])}>
          {Object.entries(priorities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      <label><span id={id + "-status"}>Estado</span>
        <select aria-labelledby={id + "-status"} value={status} onChange={e => setStatus(e.target.value as OfficeTask["status"])}>
          {Object.entries(taskStatuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      <label><span id={id + "-due"}>Plazo</span>
        <input aria-labelledby={id + "-due"} type="datetime-local" value={date} onChange={e => { setDate(e.target.value); setInstant(""); }} />
      </label>
      <label><span id={id + "-zone"}>Zona horaria</span>
        <input aria-labelledby={id + "-zone"} required list={id + "-zones"} value={zone} onChange={e => { setZone(e.target.value); setInstant(""); }} />
        <datalist id={id + "-zones"}>
          {["Europe/Madrid", "America/Puerto_Rico", "America/Santo_Domingo", "Atlantic/Canary", "UTC"].map(z => <option key={z} value={z} />)}
        </datalist>
      </label>
      {dates && dates.length > 1 && <label className={styles.wide}><span id={id + "-fold"}>Esta hora se repite al cambiar el horario</span>
        <select aria-labelledby={id + "-fold"} required value={dates.includes(instant) ? instant : ""} onChange={e => setInstant(e.target.value)}>
          <option value="" disabled>Elige la hora de entrega</option>
          {dates.map((v, i) => <option value={v} key={v}>{i ? "Segunda" : "Primera"} · {v.slice(11, 16)} UTC</option>)}
        </select>
      </label>}
      <label className={styles.wide}><span id={id + "-delivery"}>Entrega esperada</span>
        <textarea aria-labelledby={id + "-delivery"} required maxLength={4000} rows={3} value={delivery} onChange={e => setDelivery(e.target.value)} />
      </label>
    </fieldset>
    <Feedback value={operation.feedback} />
    <div className={styles.actions}>
      <button type="submit" className={styles.primary} disabled={operation.saving}>{operation.saving ? "Guardando…" : "Guardar encargo"}</button>
      <button type="button" className={styles.button} disabled={operation.saving} onClick={onClose}>Cancelar</button>
    </div>
  </form>;
}
