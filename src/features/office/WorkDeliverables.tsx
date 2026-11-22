"use client";

import { FormEvent, useId, useState } from "react";
import { Download, FileText } from "lucide-react";
import type { OfficeSnapshot, OfficeTask, OfficeVersion } from "./model";
import { OFFICE_FILE_LIMIT } from "./model";
import { Feedback, reviewStatuses, useOfficeSave, workerName } from "./WorkControls";
import { officeDownload } from "./office-client";
import OfficeInstagram from "./OfficeInstagram";
import OfficeMedia, { previewableMedia } from "./OfficeMedia";
import { latestVersions } from "./office-versions";
import { displayTime } from "./WorkTime";
import styles from "./OfficeWork.module.css";

async function fileData(file: File) {
  if (file.size > OFFICE_FILE_LIMIT || file.size === 0) throw new Error("El archivo debe contener datos y ocupar como máximo 2 MiB.");
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", pdf: "application/pdf", txt: "text/plain",
  };
  const mime = types[file.name.split(".").pop()?.toLowerCase() || ""];
  if (!mime || (file.type && file.type !== mime)) throw new Error("Adjunta un PDF, PNG, JPEG, WebP, MP4 o TXT válido.");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
    reader.readAsDataURL(file);
  });
  return { file_name: file.name, file_type: mime, file_base64: url.slice(url.indexOf(",") + 1) };
}

function MediaPreview({ version }: { version: OfficeVersion }) {
  const [open, setOpen] = useState(false);
  const alt = version.body.split("\n\nTexto alternativo\n\n")[1]?.trim() || version.title;
  return <details className={styles.details} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Ver {version.file_type === "video/mp4" ? "vídeo" : "imagen"} de la versión {version.version}</summary>
    {open && version.file_type && <OfficeMedia versionId={version.id} type={version.file_type} alt={alt} />}
  </details>;
}

export function VersionContent({ version, data }: { version: OfficeVersion; data: OfficeSnapshot }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    if (!version.file_name) return;
    setDownloading(true);
    setError("");
    try { await officeDownload(version.id, version.file_name); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo descargar el archivo."); }
    finally { setDownloading(false); }
  }
  return <div className={styles.stack} id={"office-version-" + version.id}>
    <p className={styles.meta}>Entregado por {workerName(data, version.created_by)} · {displayTime(version.created_at)} (Madrid)</p>
    {version.body && <p className={styles.body}>{version.body}</p>}
    {previewableMedia(version.file_type) && <MediaPreview key={version.id} version={version} />}
    {version.file_name && <button className={styles.file} type="button" disabled={downloading} onClick={download}>
      <Download size={15} aria-hidden /> {downloading ? "Descargando…" : version.file_name}
    </button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {version.reviewed_at && <div className={styles.reviewResult}>
      <strong>{reviewStatuses[version.status]}</strong> · {workerName(data, version.reviewed_by)} · {displayTime(version.reviewed_at)} (Madrid)
      {version.review_note && <p className={styles.body}>{version.review_note}</p>}
    </div>}
  </div>;
}

type DeliveryProps = { data: OfficeSnapshot; task: OfficeTask; reload: () => Promise<void> };
export function WorkDeliverables({ task, data, reload }: DeliveryProps) {
  const versions = data.versions.filter(version => version.task_id === task.id);
  const current = Array.from(latestVersions(versions).values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [series, setSeries] = useState<OfficeVersion | "new" | null>(null);
  const [saved, setSaved] = useState(false);
  const add = (version: OfficeVersion | "new") => { setSeries(version); setSaved(false); };
  return <section className={styles.section}>
    <div className={styles.row}>
      <h4>Entregables</h4>
      {!series && <button type="button" className={styles.button} onClick={() => add("new")}>Añadir entregable</button>}
    </div>
    {series && <VersionForm key={series === "new" ? "new" : series.id}
      previous={series === "new" ? undefined : series} task={task} reload={reload}
      onClose={() => setSeries(null)} onSaved={() => { setSeries(null); setSaved(true); }} />}
    {saved && <p className={styles.success} role="status">Versión guardada y disponible para revisión.</p>}
    {!current.length && <p className={styles.muted}>Aún no hay entregables.</p>}
    {current.map(v => <div className={styles.record} key={v.deliverable_id}>
      <div className={styles.row}>
        <div><span className={styles.meta}>Versión {v.version} · {reviewStatuses[v.status]}</span><h5><FileText size={16} aria-hidden />{v.title}</h5></div>
        {!series && <button type="button" className={styles.button} onClick={() => add(v)}>Nueva versión</button>}
      </div>
      <VersionContent version={v} data={data} />
      {task.department_id === "marketing" && ["aprobado","pendiente"].includes(v.status) && <OfficeInstagram key={v.id} version={v} current onApproved={reload} />}
      {v.version > 1 && <details className={styles.details}>
        <summary>Versiones anteriores</summary>
        {versions.filter(old => old.deliverable_id === v.deliverable_id && old.id !== v.id).sort((a, b) => b.version - a.version).map(old =>
          <article className={styles.record} key={old.id}>
            <h5>{old.title} · v{old.version}</h5><span className={styles.meta}>{old.status === "pendiente" ? "Sustituida antes de revisión" : reviewStatuses[old.status]}</span>
            <VersionContent version={old} data={data} />
            {task.department_id === "marketing" && old.status === "aprobado" && <OfficeInstagram version={old} current={false} />}
          </article>
        )}
      </details>}
    </div>)}
  </section>;
}

function VersionForm({ previous, task, reload, onSaved, onClose }: {
  previous?: OfficeVersion; task: OfficeTask; reload: () => Promise<void>; onSaved: () => void; onClose: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(previous?.title || "");
  const [body, setBody] = useState(previous?.body || "");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const operation = useOfficeSave(reload);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return operation.error("Escribe el título del entregable.");
    if (!body.trim() && !file) return operation.error("Escribe el contenido o adjunta un archivo.");
    setReading(true);
    try {
      const attachment = file ? await fileData(file) : {};
      await operation.save({
        action: "add_version", task_id: task.id, deliverable_id: previous?.deliverable_id || null,
        base_version: previous?.version || 0, title: title.trim(), body: body.trim(), ...attachment,
      }, "Versión guardada.", onSaved);
    } catch (e) {
      operation.error(e instanceof Error ? e.message : "No se pudo preparar el entregable.");
    } finally { setReading(false); }
  }
  return <form className={styles.subform} onSubmit={submit} aria-labelledby={id}>
    <h5 id={id}>{previous ? "Nueva versión" : "Nuevo entregable"}</h5>
    <fieldset disabled={reading || operation.saving} className={styles.stack}>
      <label><span id={id + "-title"}>Título</span><input aria-labelledby={id + "-title"} required autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label><span id={id + "-body"}>Contenido de esta versión</span><textarea aria-labelledby={id + "-body"} rows={4} maxLength={32000} value={body} onChange={e => setBody(e.target.value)} /></label>
      <label><span id={id + "-file"}>Archivo de esta versión</span>
        <input aria-labelledby={id + "-file"} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.txt" onChange={e => setFile(e.target.files?.[0] || null)} aria-describedby={id + "-formats"} />
        <small id={id + "-formats"}>PDF, PNG, JPEG, WebP, MP4 o TXT · Hasta 2 MiB.
          {previous?.file_name && ` Para incluir «${previous.file_name}» en esta versión, vuelve a adjuntarlo.`}
        </small>
      </label>
    </fieldset>
    <Feedback value={operation.feedback} />
    <div className={styles.actions}>
      <button className={styles.primary} type="submit" disabled={reading || operation.saving}>{reading || operation.saving ? "Guardando…" : "Guardar versión"}</button>
      <button className={styles.button} type="button" onClick={onClose} disabled={reading || operation.saving}>Cancelar</button>
    </div>
  </form>;
}

export function WorkReviews({ data, reload, departmentId, onOpenTask }: { data: OfficeSnapshot; reload: () => Promise<void>; departmentId?: string; onOpenTask?: (id: string, version?: string) => void }) {
  const [tab, setTab] = useState("pending");
  const [notice, setNotice] = useState("");
  const [requested, setRequested] = useState<OfficeVersion>();
  const current = latestVersions(data.versions);
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  const versions = data.versions.filter(v => (!departmentId || tasks.get(v.task_id)?.department_id === departmentId) &&
    (tab === "pending" ? current.get(v.deliverable_id)?.id === v.id && v.status === "pendiente" : v.status !== "pendiente"))
    .sort((a, b) => (b.reviewed_at || b.created_at).localeCompare(a.reviewed_at || a.created_at));
  return <section className={styles.root}>
    <div className={styles.heading}><h2>Revisiones</h2></div>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {requested && onOpenTask && <div><button type="button" className={styles.button} onClick={() => onOpenTask(requested.task_id, requested.id)}>Abrir corrección con Atlas</button></div>}
    <div className={styles.actions} aria-label="Mostrar revisiones">
      <button type="button" aria-pressed={tab === "pending"} className={styles.toggle} onClick={() => setTab("pending")}>Pendientes</button>
      <button type="button" aria-pressed={tab === "history"} className={styles.toggle} onClick={() => setTab("history")}>Historial</button>
    </div>
    {!versions.length && <div className={styles.empty}><FileText size={24} aria-hidden /><h3>{tab === "pending" ? "No hay entregas pendientes de revisión" : "Todavía no hay revisiones registradas"}</h3></div>}
    {versions.map(v => {
      const task = tasks.get(v.task_id);
      const dept = data.departments.find(d => d.id === task?.department_id);
      return <article className={styles.card} key={v.id}>
        <div className={styles.meta}>{dept?.name} · Versión {v.version} · {reviewStatuses[v.status]}</div>
        <h3>{v.title}</h3>
        {task && <p className={styles.meta}>Encargo · {task.objective}</p>}
        <VersionContent version={v} data={data} />
        {task?.department_id === "marketing" && ["aprobado","pendiente"].includes(v.status) &&
          <OfficeInstagram version={v} current={current.get(v.deliverable_id)?.id === v.id} onApproved={async () => {
            await reload();
            setTab("history");
            setNotice(`Aprobación de Instagram registrada para «${v.title}», versión ${v.version}.`);
          }} />}
        {tab === "history" && onOpenTask && task?.department_id === "marketing" && v.status === "cambios" && current.get(v.deliverable_id)?.id === v.id &&
          <div><button type="button" className={styles.button} onClick={() => onOpenTask(v.task_id, v.id)}>Abrir corrección con Atlas</button></div>}
        {tab === "pending" && <ReviewForm version={v} reload={reload} onSaved={decision => {
          setNotice(`Decisión guardada para «${v.title}», versión ${v.version}.`);
          setRequested(task?.department_id === "marketing" && decision === "cambios" ? v : undefined);
        }} />}
      </article>;
    })}
  </section>;
}

function ReviewForm({ version, reload, onSaved }: { version: OfficeVersion; reload: () => Promise<void>; onSaved: (decision: string) => void }) {
  const id = useId();
  const [decision, setDecision] = useState<"aprobado" | "cambios" | "rechazado">("aprobado");
  const [note, setNote] = useState("");
  const op = useOfficeSave(reload);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (decision !== "aprobado" && !note.trim()) return op.error("Escribe el motivo de la decisión.");
    await op.save({ action: "review_version", id: version.id, decision, note: note.trim() }, "Decisión guardada.", () => onSaved(decision));
  }
  return <form onSubmit={submit} className={styles.subform}>
    <fieldset disabled={op.saving} className={styles.formGrid}>
      <label><span id={id + "-decision"}>Decisión</span>
        <select aria-labelledby={id + "-decision"} value={decision} onChange={e => setDecision(e.target.value as typeof decision)}>
          <option value="aprobado">Aprobar</option><option value="cambios">Solicitar cambios</option><option value="rechazado">Rechazar</option>
        </select>
      </label>
      <label><span><span id={id + "-comment"}>Comentario</span>{decision === "aprobado" ? " (opcional)" : ""}</span>
        <textarea aria-labelledby={id + "-comment"} rows={2} required={decision !== "aprobado"} maxLength={4000} value={note} onChange={e => setNote(e.target.value)} />
      </label>
    </fieldset>
    <Feedback value={op.feedback} />
    <div><button className={styles.primary} type="submit" disabled={op.saving}>{op.saving ? "Guardando…" : "Guardar decisión"}</button></div>
  </form>;
}
