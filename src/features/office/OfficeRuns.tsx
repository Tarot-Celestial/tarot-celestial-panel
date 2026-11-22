"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Orbit } from "lucide-react";
import type { OfficeTask, OfficeVersion } from "./model";
import { officeRequest } from "./office-client";
import { isActiveRun, officeRunsPath, runStatus, startOfficeRun, type OfficeRun } from "./office-runs";
import { latestVersions } from "./office-versions";
import { displayTime } from "./WorkTime";
import styles from "./OfficeWork.module.css";

const stages = ["Atlas · Briefing", "Marketing · Texto", "Contenido · Pieza visual"];
const POLL_LIMIT = 48;
const POLL_DELAY_MS = 5000;
type Props = {
  task: OfficeTask;
  versions: OfficeVersion[];
  reload: () => Promise<void>;
  onEdit: () => void;
  retryId?: string;
  startError?: string;
  preferredVersion?: string;
};
const describeError = (e: unknown) => e instanceof Error ? e.message : "No se pudo consultar la ejecución.";

function RunSummary({ run }: { run: OfficeRun }) {
  const caption = run.outputs?.["1"]?.caption;
  const brief = run.outputs?.["0"]?.brief;
  const sources = run.outputs?.["0"]?.sources;
  const artwork = run.outputs?.["2"];
  return <div className={styles.stack}>
    <p className={styles.meta}>Iniciado el {displayTime(run.created_at)} (Madrid)</p>
    <ol className={styles.stages} aria-label="Etapas del encargo">
      {stages.map((stage, i) => {
        const done = run.status === "review" || i < run.step;
        const current = run.step === i && run.status === "running";
        return <li key={stage} aria-current={current ? "step" : undefined}>
          <strong>{stage}</strong><span>{done ? "Completada" : current ? "En curso" : "Pendiente"}</span>
        </li>;
      })}
    </ol>
    {run.last_error && <p className={styles.body}>{run.last_error}</p>}
    {brief && <details className={styles.details}><summary>Briefing de Atlas</summary><p className={styles.body}>{brief}</p>
      {sources && sources.length > 0 && <ul aria-label="Fuentes del briefing">{sources.map(s => <li key={s.id + s.version}>{s.label} · v{s.version}</li>)}</ul>}
    </details>}
    {caption && <details className={styles.details}><summary>Texto de Marketing</summary><p className={styles.body}>{caption}</p></details>}
    {typeof artwork?.title === "string" && typeof artwork.width === "number" && typeof artwork.height === "number" &&
      <p className={styles.meta}>Pieza de Contenido · {artwork.title} · {artwork.width} × {artwork.height} px</p>}
    {run.status === "review" && <p className={styles.muted}>{run.result_version_id ?
      <a className={styles.runLink} href={"#office-version-" + run.result_version_id}>Ver la versión entregada</a> : "La versión está disponible en Entregables y Revisiones."}</p>}
    {typeof run.usage?.input_tokens === "number" && typeof run.usage?.output_tokens === "number" &&
      <p className={styles.meta}>Consumo registrado · {run.usage.input_tokens} tokens de entrada y {run.usage.output_tokens} de salida</p>}
    {typeof run.usage?.cost_usd === "number" && <p className={styles.meta}>Coste calculado · {run.usage.cost_usd} USD</p>}
    {typeof run.usage?.estimated_cost_usd === "number" && <p className={styles.meta}>Coste estimado · {run.usage.estimated_cost_usd} USD</p>}
  </div>;
}

export default function OfficeRuns({ task, versions, reload, onEdit, retryId, startError, preferredVersion }: Props) {
  const id = useId();
  const [runs, setRuns] = useState<OfficeRun[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [commandProblem, setCommandProblem] = useState(startError || "");
  const [paused, setPaused] = useState(false);
  const [chosen, setChosen] = useState(preferredVersion || "");
  const update = () => setRefresh(x => x + 1);
  const requests = useRef(new Map<string, string>(retryId ? [["", retryId]] : []));
  const observed = useRef(new Set<string>());
  const locked = useRef(false);

  useEffect(() => {
    let stopped = false, checks = 0;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setReading(true);
    setPaused(false);
    setProblem("");
    async function read() {
      try {
        const data = await officeRequest<{ runs: OfficeRun[] }>(officeRunsPath + "?task_id=" + encodeURIComponent(task.id), { signal: controller.signal });
        if (stopped) return;
        const history = [...data.runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
        setRuns(history);
        const deliveries = history.filter(r => r.status === "review" && !observed.current.has(r.id));
        if (deliveries.length) {
          await reload();
          if (stopped) return;
          deliveries.forEach(r => observed.current.add(r.id));
        }
        if (history.some(isActiveRun)) {
          if (++checks < POLL_LIMIT) timer = setTimeout(read, POLL_DELAY_MS);
          else setPaused(true);
        }
      } catch (e) {
        if (!stopped) setProblem(describeError(e));
      } finally {
        if (!stopped) setReading(false);
      }
    }
    void read();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [task.id, refresh, reload]);

  const current = runs?.find(isActiveRun) || runs?.[0];
  const active = current && isActiveRun(current);
  const corrections = Array.from(latestVersions(versions.filter(v => v.task_id === task.id)).values()).filter(v => v.status === "cambios");
  const correction = corrections.find(v => v.id === chosen) || corrections[0];
  const unresolved = current?.status === "needs_reconciliation";
  const ready = runs !== null && !reading && !busy && !problem;
  async function command(action: "start" | "cancel", version?: OfficeVersion) {
    if (locked.current || !ready) return;
    locked.current = true;
    setBusy(true);
    setCommandProblem("");
    try {
      if (action === "cancel" && current) {
        await officeRequest(officeRunsPath, { method: "POST", body: JSON.stringify({ action, run_id: current.id }) });
      } else if (action === "start") {
        const key = version?.id || "";
        const requestId = requests.current.get(key) || crypto.randomUUID();
        requests.current.set(key, requestId);
        await startOfficeRun(task.id, requestId, version?.id);
        requests.current.delete(key);
      }
    } catch (e) { setCommandProblem(describeError(e)); }
    finally { locked.current = false; setBusy(false); update(); }
  }

  return <section className={styles.section} aria-labelledby={id}>
    <div className={styles.row}>
      <h4 id={id} className={styles.runHeading}><Orbit size={18} aria-hidden /> Atlas, Marketing y Contenido</h4>
      <button className={styles.button} type="button" onClick={update} disabled={reading || busy}>Actualizar estado</button>
    </div>
    <div role="status" aria-live="polite" className={styles.meta}>
      {current ? runStatus[current.status] : reading ? "Consultando ejecuciones…" : runs && !problem ? "Todavía no se ha iniciado una ejecución." : ""}
      {current?.status === "running" && stages[current.step] ? " · " + stages[current.step] : ""}
    </div>
    {current && <RunSummary run={current} />}
    {paused && <p className={styles.muted}>Puedes actualizar el estado para seguir consultando el avance.</p>}
    {problem && <p role="alert" className={styles.error}>{problem}</p>}
    {commandProblem && <p role="alert" className={styles.error}>{commandProblem}</p>}
    {active && <div><button className={styles.button} type="button" disabled={!ready} onClick={() => command("cancel")}>Cancelar ejecución</button></div>}
    {current?.status === "waiting_input" && <div><button className={styles.button} type="button" onClick={onEdit}>Completar datos del encargo</button></div>}
    {!active && !unresolved && runs && <>
      {correction && <div className={styles.subform}>
        <label><span id={id + "-correction"}>Versión con cambios solicitados</span>
          <select aria-labelledby={id + "-correction"} value={correction.id} onChange={e => setChosen(e.target.value)}>
            {corrections.map(v => <option key={v.id} value={v.id}>{v.title} · v{v.version}</option>)}
          </select></label>
        {correction.review_note && <p className={styles.body}>{correction.review_note}</p>}
        <div><button className={styles.primary} type="button" disabled={!ready} onClick={() => command("start", correction)}>Pedir la corrección a Atlas</button></div>
      </div>}
      {!correction && current?.status !== "review" && <div><button className={styles.primary} type="button" disabled={!ready} onClick={() => command("start")}>
        {current ? "Volver a encargar a Atlas" : "Encargar a Atlas"}
      </button></div>}
    </>}
    {runs && runs.length > 1 && <details className={styles.details}><summary>Historial de ejecuciones</summary>
      {runs.filter(r => r.id !== current?.id).map(r => <div key={r.id} className={styles.record}>
        <strong>{runStatus[r.status]}</strong><RunSummary run={r} />
      </div>)}
    </details>}
  </section>;
}
