"use client";

import { FormEvent, useId, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import type { OfficeSnapshot, OfficeTask } from "./model";
import { AssigneeOptions, assigneeKey, assigneeName, Feedback, priorities, taskStatuses, useOfficeSave, workerName } from "./WorkControls";
import WorkTaskForm from "./WorkTaskForm";
import { WorkDeliverables, WorkReviews } from "./WorkDeliverables";
import { displayTime } from "./WorkTime";
import styles from "./OfficeWork.module.css";

type Props = {
  view: "tasks" | "reviews";
  data: OfficeSnapshot;
  reload: () => Promise<void>;
  departmentId?: string;
};

export default function OfficeWork({ view, data, reload, departmentId }: Props) {
  if (view === "reviews") return <WorkReviews data={data} reload={reload} departmentId={departmentId} />;
  return <Tasks key={departmentId || "all"} data={data} reload={reload} departmentId={departmentId} />;
}

export function DepartmentOwner({ departmentId, data, reload }: Required<Omit<Props, "view">>) {
  const dept = data.departments.find(d => d.id === departmentId);
  if (!dept) return null;
  return <OwnerForm key={dept.id + "-" + dept.revision} dept={dept} data={data} reload={reload} />;
}

function OwnerForm({ dept, data, reload }: {
  dept: OfficeSnapshot["departments"][number]; data: OfficeSnapshot; reload: Props["reload"];
}) {
  const [owner, setOwner] = useState(dept.lead_worker_id || "");
  const labelId = useId();
  const operation = useOfficeSave(reload);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await operation.save({ action: "set_lead", department_id: dept.id, revision: dept.revision, lead_worker_id: owner || null }, "Responsable actualizado.");
  }
  return <form onSubmit={submit} className={styles.owner}>
    <label><span id={labelId}>Responsable del departamento</span>
      <select aria-labelledby={labelId} value={owner} onChange={e => setOwner(e.target.value)} disabled={operation.saving}>
        <option value="">Sin asignar</option>
        {owner && !data.workers.some(w => w.id === owner) && <option value={owner}>{workerName(data, owner)}</option>}
        {data.workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </label>
    <button type="submit" className={styles.button} disabled={operation.saving || owner === (dept.lead_worker_id || "")}>
      {operation.saving ? "Guardando…" : "Guardar responsable"}
    </button>
    <Feedback value={operation.feedback} />
  </form>;
}

function Tasks({ data, departmentId, reload }: Omit<Props, "view">) {
  const [dept, setDept] = useState(departmentId || "");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [owner, setOwner] = useState("");
  const [selected, setSelected] = useState("");
  const [editor, setEditor] = useState<{ task?: OfficeTask } | null>(null);
  const [notice, setNotice] = useState("");
  const id = useId();
  const tasks = data.tasks.filter(t => (!dept || t.department_id === dept) && (!status || t.status === status) &&
    (!priority || t.priority === priority) && (!owner || (assigneeKey(t) || "unassigned") === owner))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const task = tasks.find(t => t.id === selected) || tasks[0];
  function reset() { setDept(""); setStatus(""); setPriority(""); setOwner(""); }
  function onSaved(id: string) {
    reset();
    setSelected(id);
    setEditor(null);
    setNotice("Encargo guardado.");
  }
  return <section className={styles.root}>
    <div className={styles.heading}>
      <h2>Encargos</h2>
      {!editor && <button className={styles.primary} type="button" onClick={() => { setNotice(""); setEditor({}); }}>
        <Plus size={16} aria-hidden /> Nuevo encargo
      </button>}
    </div>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {editor ? <WorkTaskForm key={editor.task?.id || "new"} task={editor.task} departmentId={dept} data={data} reload={reload}
      onClose={() => setEditor(null)} onSaved={onSaved} /> : <>
      <div className={styles.filters} aria-label="Filtros de encargos">
        <label><span id={id + "-department"}>Departamento</span><select aria-labelledby={id + "-department"} value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">Todos</option>{data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
        <label><span id={id + "-status"}>Estado</span><select aria-labelledby={id + "-status"} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos</option>{Object.entries(taskStatuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        <label><span id={id + "-priority"}>Prioridad</span><select aria-labelledby={id + "-priority"} value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">Todas</option>{Object.entries(priorities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        <label><span id={id + "-owner"}>Responsable</span><select aria-labelledby={id + "-owner"} value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">Todos</option><option value="unassigned">Sin asignar</option><AssigneeOptions data={data} />
        </select></label>
      </div>
      {!tasks.length ? <div className={styles.empty}>
        <ClipboardList size={26} aria-hidden />
        <h3>{data.tasks.length ? "Ningún encargo coincide con estos filtros" : "Todavía no hay encargos"}</h3>
        {data.tasks.length > 0 && <button className={styles.button} type="button" onClick={reset}>Limpiar filtros</button>}
      </div> : <div className={styles.columns}>
        <div className={styles.list} aria-label="Lista de encargos">
          {tasks.map(t => <button type="button" key={t.id} className={styles.task} aria-pressed={task?.id === t.id} onClick={() => { setSelected(t.id); setNotice(""); }}>
            <span className={styles.meta}>{data.departments.find(d => d.id === t.department_id)?.name}</span>
            <strong>{t.objective}</strong>
            <span className={styles.meta}>{taskStatuses[t.status]} · Prioridad {priorities[t.priority].toLowerCase()}</span>
          </button>)}
        </div>
        {task && <TaskDetail key={task.id} task={task} data={data} reload={reload} onEdit={() => { setNotice(""); setEditor({ task }); }} />}
      </div>}
    </>}
  </section>;
}

function TaskDetail({ task, data, reload, onEdit }: {
  task: OfficeTask; data: OfficeSnapshot; reload: Props["reload"]; onEdit: () => void;
}) {
  const [note, setNote] = useState("");
  const noteId = useId();
  const operation = useOfficeSave(reload);
  const events = data.events.filter(e => e.task_id === task.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return operation.error("Escribe la nota de coordinación.");
    await operation.save({ action: "add_note", task_id: task.id, note: note.trim() }, "Nota guardada.", () => setNote(""));
  }
  return <article className={styles.card}>
    <div className={styles.row}>
      <span className={styles.tag}>{taskStatuses[task.status]}</span>
      <button className={styles.button} type="button" onClick={onEdit}>Editar encargo</button>
    </div>
    <h3 className={styles.body}>{task.objective}</h3>
    <dl className={styles.fields}>
      <div><dt>Departamento</dt><dd>{data.departments.find(d => d.id === task.department_id)?.name}</dd></div>
      <div><dt>Responsable</dt><dd>{assigneeName(task, data)}</dd></div>
      <div><dt>Prioridad</dt><dd>{priorities[task.priority]}</dd></div>
      <div><dt>Plazo</dt><dd>{task.due_at ? `${displayTime(task.due_at, task.time_zone)} (${task.time_zone})` : "Sin plazo"}</dd></div>
      <div className={styles.wide}><dt>Entrega esperada</dt><dd className={styles.body}>{task.expected_delivery}</dd></div>
    </dl>
    <WorkDeliverables task={task} data={data} reload={reload} />
    <section className={styles.section}>
      <h4>Coordinación e historial</h4>
      <form onSubmit={addNote} className={styles.stack}>
        <label><span id={noteId}>Nota de coordinación</span><textarea aria-labelledby={noteId} rows={2} maxLength={4000} required value={note} disabled={operation.saving} onChange={e => setNote(e.target.value)} /></label>
        <Feedback value={operation.feedback} />
        <div><button type="submit" className={styles.button} disabled={operation.saving}>{operation.saving ? "Guardando…" : "Añadir nota"}</button></div>
      </form>
      {events.length > 0 && <ol className={styles.timeline}>
        {events.map(e => <li key={e.id}>
          <strong className={styles.body}>{e.kind === "add_note" ? "Nota de coordinación" : e.note || "Actividad registrada"}</strong>
          <span className={styles.meta}>{workerName(data, e.actor_id)} · {displayTime(e.created_at)} (Madrid)</span>
          {e.kind === "add_note" && <p className={styles.body}>{e.note}</p>}
        </li>)}
      </ol>}
    </section>
  </article>;
}
