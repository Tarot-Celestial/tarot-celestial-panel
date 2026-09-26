"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, History, Plus, RefreshCw,
  Search, ShieldCheck, SlidersHorizontal, UserRound, Wrench, X
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./AttendanceIncidentCenter.module.css";

type Mode = "manager" | "readonly" | "admin";

type Incident = {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_team?: string | null;
  invoice_month: string;
  incident_date: string;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  missed_start: string;
  missed_end: string;
  missed_minutes: number;
  recovered_minutes: number;
  justified_minutes: number;
  pending_minutes: number;
  reason_code: string;
  reason_detail?: string | null;
  notes?: string | null;
  status: "pending" | "partial" | "recovered" | "justified" | "closed";
  created_by_name?: string | null;
  created_at: string;
  recoveries?: any[];
  justifications?: any[];
  audit?: any[];
};

type Worker = { id: string; display_name: string; team?: string | null; is_active?: boolean };
type Schedule = { id: string; worker_id: string; day_of_week: number; start_time: string; end_time: string; timezone: string };
type Settings = {
  allow_central_justify: boolean;
  require_notes: boolean;
  notify_worker: boolean;
  show_in_invoice: boolean;
  allow_partial_recovery: boolean;
  reasons: string[];
};

type Payload = {
  ok: boolean;
  month: string;
  role: string;
  workers: Worker[];
  schedules: Schedule[];
  incidents: Incident[];
  settings: Settings;
  summary: {
    total: number;
    open: number;
    resolved: number;
    missed_minutes: number;
    recovered_minutes: number;
    justified_minutes: number;
    pending_minutes: number;
  };
};

const monthNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hm = (value?: string | null) => String(value || "").slice(0, 5) || "—";
const duration = (minutes: unknown) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
};
const dateLabel = (value: string) => {
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : value;
};
const statusLabel: Record<Incident["status"], string> = {
  pending: "Pendiente",
  partial: "Recuperación parcial",
  recovered: "Recuperada",
  justified: "Justificada",
  closed: "Cerrada",
};

async function request(url: string, body?: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión de nuevo.");
  const response = await fetch(url, {
    cache: "no-store",
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) throw new Error(json?.error || "No se pudo completar la operación.");
  return json;
}

export default function AttendanceIncidentCenter({
  mode = "manager",
  month: externalMonth,
  workerId,
  compact = false,
}: {
  mode?: Mode;
  month?: string;
  workerId?: string;
  compact?: boolean;
}) {
  const readonly = mode === "readonly";
  const adminMode = mode === "admin";
  const [month, setMonth] = useState(externalMonth || monthNow());
  const [data, setData] = useState<Payload | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedWorker, setSelectedWorker] = useState(workerId || "");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | "recovery" | "justify" | "history" | "settings" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ month: externalMonth || month });
      if (workerId) qs.set("worker_id", workerId);
      const next = await request(`/api/attendance/incidents?${qs.toString()}`);
      setData(next);
      if (!selectedWorker && next.workers?.length === 1) setSelectedWorker(next.workers[0].id);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    } finally {
      setBusy(false);
    }
  }, [externalMonth, month, workerId, selectedWorker]);

  useEffect(() => { void reload(); }, [externalMonth, month, workerId]);
  useEffect(() => {
    if (!data) return;
    const channel = supabaseBrowser().channel(`attendance-incidents-${externalMonth || month}-${workerId || "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_incidents" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_incident_recoveries" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_incident_justifications" }, () => void reload())
      .subscribe();
    return () => { void supabaseBrowser().removeChannel(channel); };
  }, [data?.month, externalMonth, month, workerId, reload]);

  const workers = data?.workers || [];
  const incidents = data?.incidents || [];
  const selectedWorkerData = workers.find(w => w.id === selectedWorker);
  const workerIncidents = useMemo(() => incidents.filter(i => !selectedWorker || i.worker_id === selectedWorker), [incidents, selectedWorker]);
  const visible = useMemo(() => workerIncidents.filter(i => {
    const q = query.trim().toLowerCase();
    if (q && ![`${i.worker_name}`, i.reason_code, i.reason_detail || "", i.notes || ""].join(" ").toLowerCase().includes(q)) return false;
    if (status === "open" && !["pending", "partial"].includes(i.status)) return false;
    if (status !== "all" && status !== "open" && i.status !== status) return false;
    return true;
  }), [workerIncidents, query, status]);

  const workerSummary = useMemo(() => workerIncidents.reduce((acc, i) => {
    acc.pending += Number(i.pending_minutes || 0);
    acc.recovered += Number(i.recovered_minutes || 0);
    acc.open += ["pending", "partial"].includes(i.status) ? 1 : 0;
    acc.resolved += ["recovered", "justified", "closed"].includes(i.status) ? 1 : 0;
    return acc;
  }, { pending: 0, recovered: 0, open: 0, resolved: 0 }), [workerIncidents]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true); setMessage(""); setError("");
    try {
      await request("/api/attendance/incidents", body);
      setDialog(null); setSelectedIncident(null); setMessage(success); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  };

  if (!data && busy) return <section className={styles.shell}><div className={styles.loading}><RefreshCw size={18} /> Cargando centro de incidencias…</div></section>;
  if (readonly && data?.settings?.show_in_invoice === false) return null;

  return <section className={`${styles.shell} ${compact ? styles.compact : ""}`}>
    {!readonly && <header className={styles.hero}>
      <div className={styles.heroGlow} />
      <div>
        <span className={styles.eyebrow}><ShieldCheck size={15} /> CONTROL OPERATIVO</span>
        <h2>Incidencias</h2>
        <p>Control de jornada, ausencias y recuperación de horas.</p>
      </div>
      <div className={styles.heroActions}>
        {adminMode && <button className={styles.secondary} onClick={() => setDialog("settings")}><SlidersHorizontal size={16} /> Configuración</button>}
        {!adminMode && <button className={styles.primary} onClick={() => setDialog("create")}><Plus size={17} /> Nueva incidencia</button>}
        <button className={styles.secondary} onClick={() => void reload()} disabled={busy}><RefreshCw size={16} /> Actualizar</button>
      </div>
    </header>}

    {error && <div className={styles.error}><AlertTriangle size={16} /> {error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={16} /> {message}</div>}

    <div className={styles.kpis}>
      <article><span><AlertTriangle size={16}/> Incidencias abiertas</span><strong>{data?.summary.open ?? 0}</strong><small>requieren seguimiento</small></article>
      <article><span><Clock3 size={16}/> Horas pendientes</span><strong>{duration(data?.summary.pending_minutes)}</strong><small>por recuperar o justificar</small></article>
      <article><span><Activity size={16}/> Horas recuperadas</span><strong>{duration(data?.summary.recovered_minutes)}</strong><small>registradas este mes</small></article>
      <article><span><CheckCircle2 size={16}/> Resueltas</span><strong>{data?.summary.resolved ?? 0}</strong><small>recuperadas o justificadas</small></article>
    </div>

    {!readonly && <div className={styles.toolbar}>
      <label><span>Mes</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
      <label className={styles.search}><span>Buscar</span><div><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Trabajadora, motivo…" /></div></label>
      <label><span>Estado</span><select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="all">Todos</option><option value="open">Pendientes</option><option value="partial">Parciales</option><option value="recovered">Recuperadas</option><option value="justified">Justificadas</option><option value="closed">Cerradas</option>
      </select></label>
    </div>}

    {!readonly && workers.length > 1 && <div className={styles.workerStrip}>
      <button className={!selectedWorker ? styles.workerActive : ""} onClick={() => setSelectedWorker("")}>Todas</button>
      {workers.map(worker => <button key={worker.id} className={selectedWorker === worker.id ? styles.workerActive : ""} onClick={() => setSelectedWorker(worker.id)}>
        <UserRound size={15}/><span>{worker.display_name}</span><small>{worker.team || "Tarotista"}</small>
      </button>)}
    </div>}

    {selectedWorker && !readonly && <div className={styles.workerSummary}>
      <div><span className={styles.avatar}>{selectedWorkerData?.display_name?.slice(0,2).toUpperCase() || "TC"}</span><div><small>Ficha mensual</small><strong>{selectedWorkerData?.display_name}</strong><span>{selectedWorkerData?.team || "Tarotista"}</span></div></div>
      <div className={styles.workerStats}><span><b>{duration(workerSummary.pending)}</b> pendientes</span><span><b>{duration(workerSummary.recovered)}</b> recuperadas</span><span><b>{workerSummary.open}</b> abiertas</span><span><b>{workerSummary.resolved}</b> resueltas</span></div>
    </div>}

    <div className={styles.list}>
      {!visible.length && <div className={styles.empty}><CheckCircle2 size={20}/><div><strong>Sin incidencias en esta vista</strong><span>No hay registros que coincidan con el periodo y filtros actuales.</span></div></div>}
      {visible.map(incident => <article className={styles.card} key={incident.id} data-status={incident.status}>
        <div className={styles.cardTop}>
          <div><span className={styles.date}>{dateLabel(incident.incident_date)}</span><h3>{incident.worker_name}</h3><p>{hm(incident.missed_start)} → {hm(incident.missed_end)} · {duration(incident.missed_minutes)} no trabajadas</p></div>
          <span className={styles.badge}>{statusLabel[incident.status]}</span>
        </div>
        <div className={styles.progressRow}>
          <div><span>Pendiente</span><strong>{duration(incident.pending_minutes)}</strong></div>
          <div><span>Recuperado</span><strong>{duration(incident.recovered_minutes)}</strong></div>
          <div><span>Justificado</span><strong>{duration(incident.justified_minutes)}</strong></div>
        </div>
        <div className={styles.details}>
          <div><span>Motivo</span><strong>{incident.reason_code}{incident.reason_detail ? ` · ${incident.reason_detail}` : ""}</strong></div>
          {incident.notes && <div><span>Observaciones</span><strong>{incident.notes}</strong></div>}
          <div><span>Registrada por</span><strong>{incident.created_by_name || "Sistema"} · {new Date(incident.created_at).toLocaleString("es-ES")}</strong></div>
        </div>
        {!readonly && <div className={styles.actions}>
          {incident.pending_minutes > 0 && <button onClick={() => { setSelectedIncident(incident); setDialog("recovery"); }}><Clock3 size={15}/> Registrar recuperación</button>}
          <button onClick={() => { setSelectedIncident(incident); setDialog("edit"); }}><Wrench size={15}/> Editar</button>
          {incident.pending_minutes > 0 && (data?.role === "admin" || data?.settings?.allow_central_justify) && <button onClick={() => { setSelectedIncident(incident); setDialog("justify"); }}><ShieldCheck size={15}/> Justificar horas</button>}
          <button onClick={() => { setSelectedIncident(incident); setDialog("history"); }}><History size={15}/> Ver historial</button>
          {incident.pending_minutes === 0 && incident.status !== "closed" && <button onClick={() => void act({ action: "close", incident_id: incident.id }, "Incidencia cerrada.")}><CheckCircle2 size={15}/> Cerrar</button>}
        </div>}
      </article>)}
    </div>

    {readonly && <p className={styles.disclaimer}>Estas incidencias son únicamente informativas y no modifican automáticamente el importe de tu factura.</p>}

    {dialog && <div className={styles.backdrop} onMouseDown={e => { if (e.currentTarget === e.target) setDialog(null); }}>
      <div className={styles.modal}>
        <div className={styles.modalHead}><div><span className={styles.eyebrow}>INCIDENCIAS · TAROT CELESTIAL</span><h3>{
          dialog === "create" ? "Nueva incidencia" : dialog === "edit" ? "Editar incidencia" : dialog === "recovery" ? "Registrar recuperación" : dialog === "justify" ? "Justificar horas" : dialog === "settings" ? "Configuración profesional" : "Historial de incidencia"
        }</h3></div><button onClick={() => setDialog(null)}><X size={18}/></button></div>

        {dialog === "create" && <CreateForm workers={workers} schedules={data?.schedules || []} reasons={data?.settings?.reasons || []} busy={busy} onSubmit={body => act(body, "Incidencia creada y sincronizada.")}/>}
        {dialog === "edit" && selectedIncident && <EditForm incident={selectedIncident} reasons={data?.settings?.reasons || []} busy={busy} onSubmit={body => act(body, "Incidencia actualizada.")}/>}
        {dialog === "recovery" && selectedIncident && <RecoveryForm incident={selectedIncident} busy={busy} onSubmit={body => act(body, "Recuperación registrada.")}/>}
        {dialog === "justify" && selectedIncident && <JustifyForm incident={selectedIncident} busy={busy} onSubmit={body => act(body, "Horas justificadas.")}/>}
        {dialog === "history" && selectedIncident && <HistoryView incident={selectedIncident}/>}
        {dialog === "settings" && data?.settings && <SettingsForm value={data.settings} busy={busy} onSubmit={body => act(body, "Configuración actualizada.")}/>}
      </div>
    </div>}
  </section>;
}

function CreateForm({ workers, schedules, reasons, busy, onSubmit }: { workers: Worker[]; schedules: Schedule[]; reasons: string[]; busy: boolean; onSubmit: (body: any) => void }) {
  const [worker, setWorker] = useState(workers[0]?.id || "");
  const [date, setDate] = useState(today());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState(reasons[0] || "Problema de internet");
  const [detail, setDetail] = useState("");
  const [notes, setNotes] = useState("");
  const workerSchedules = schedules.filter(s => s.worker_id === worker);
  const scheduleForDay = workerSchedules.find(s => Number(s.day_of_week) === new Date(date + "T12:00:00Z").getUTCDay());
  useEffect(() => { if (scheduleForDay) { setStart(hm(scheduleForDay.start_time)); setEnd(hm(scheduleForDay.end_time)); } }, [worker, date, scheduleForDay?.id]);
  return <form className={styles.form} onSubmit={e => { e.preventDefault(); onSubmit({ action:"create", worker_id:worker, incident_date:date, missed_start:start, missed_end:end, reason_code:reason, reason_detail:detail, notes, scheduled_start:scheduleForDay?.start_time || null, scheduled_end:scheduleForDay?.end_time || null }); }}>
    <label>Trabajadora<select value={worker} onChange={e => setWorker(e.target.value)} required>{workers.map(w => <option key={w.id} value={w.id}>{w.display_name}{w.team ? ` · ${w.team}` : ""}</option>)}</select></label>
    <label>Fecha<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
    <div className={styles.two}><label>Inicio afectado<input type="time" value={start} onChange={e => setStart(e.target.value)} required /></label><label>Fin afectado<input type="time" value={end} onChange={e => setEnd(e.target.value)} required /></label></div>
    {scheduleForDay && <div className={styles.context}><Wrench size={15}/> Horario configurado: {hm(scheduleForDay.start_time)} → {hm(scheduleForDay.end_time)} · {scheduleForDay.timezone}</div>}
    <label>Motivo<select value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(x => <option key={x}>{x}</option>)}</select></label>
    {reason === "Otro" && <label>Describe el motivo<input value={detail} onChange={e => setDetail(e.target.value)} required /></label>}
    <label>Observaciones internas<textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Contexto de la central, comunicación con la trabajadora, etc." /></label>
    <button className={styles.submit} disabled={busy}>{busy ? "Guardando…" : "Crear incidencia"}</button>
  </form>;
}

function EditForm({ incident, reasons, busy, onSubmit }: { incident: Incident; reasons: string[]; busy: boolean; onSubmit: (body:any)=>void }) {
  const [start,setStart]=useState(hm(incident.missed_start));
  const [end,setEnd]=useState(hm(incident.missed_end));
  const [reason,setReason]=useState(incident.reason_code);
  const [detail,setDetail]=useState(incident.reason_detail || "");
  const [notes,setNotes]=useState(incident.notes || "");
  return <form className={styles.form} onSubmit={e=>{e.preventDefault();onSubmit({action:"edit",incident_id:incident.id,missed_start:start,missed_end:end,reason_code:reason,reason_detail:detail,notes});}}>
    <div className={styles.context}><Wrench size={15}/> Editas la incidencia del <b>{dateLabel(incident.incident_date)}</b>. El historial anterior se conserva.</div>
    <div className={styles.two}><label>Inicio afectado<input type="time" value={start} onChange={e=>setStart(e.target.value)} required/></label><label>Fin afectado<input type="time" value={end} onChange={e=>setEnd(e.target.value)} required/></label></div>
    <label>Motivo<select value={reason} onChange={e=>setReason(e.target.value)}>{reasons.map(x=><option key={x}>{x}</option>)}</select></label>
    {reason === "Otro" && <label>Describe el motivo<input value={detail} onChange={e=>setDetail(e.target.value)} required/></label>}
    <label>Observaciones internas<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <button className={styles.submit} disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>
  </form>;
}

function RecoveryForm({ incident, busy, onSubmit }: { incident: Incident; busy: boolean; onSubmit: (body:any)=>void }) {
  const [date, setDate] = useState(today()), [start,setStart]=useState(""), [end,setEnd]=useState(""), [notes,setNotes]=useState("");
  return <form className={styles.form} onSubmit={e => {e.preventDefault(); onSubmit({action:"recovery",incident_id:incident.id,recovery_date:date,start_time:start,end_time:end,notes});}}>
    <div className={styles.context}><Clock3 size={15}/> Pendiente actual: <b>{duration(incident.pending_minutes)}</b></div>
    <label>Fecha de recuperación<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>
    <div className={styles.two}><label>Inicio<input type="time" value={start} onChange={e=>setStart(e.target.value)} required/></label><label>Fin<input type="time" value={end} onChange={e=>setEnd(e.target.value)} required/></label></div>
    <label>Observaciones<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <button className={styles.submit} disabled={busy}>Registrar recuperación</button>
  </form>;
}

function JustifyForm({ incident, busy, onSubmit }: { incident: Incident; busy: boolean; onSubmit:(body:any)=>void }) {
  const [minutes,setMinutes]=useState(incident.pending_minutes), [reason,setReason]=useState("");
  return <form className={styles.form} onSubmit={e=>{e.preventDefault();onSubmit({action:"justify",incident_id:incident.id,minutes,reason});}}>
    <div className={styles.context}><ShieldCheck size={15}/> Máximo justificable: <b>{duration(incident.pending_minutes)}</b></div>
    <label>Minutos a justificar<input type="number" min="1" max={incident.pending_minutes} value={minutes} onChange={e=>setMinutes(Number(e.target.value))} required/></label>
    <label>Motivo de justificación<textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} required/></label>
    <button className={styles.submit} disabled={busy}>Justificar horas</button>
  </form>;
}

function HistoryView({ incident }: { incident: Incident }) {
  const items = [
    ...(incident.recoveries || []).map((x:any)=>({at:x.created_at,title:`Recuperación · ${duration(x.recovered_minutes)}`,detail:`${dateLabel(x.recovery_date)} · ${hm(x.start_time)} → ${hm(x.end_time)}`})),
    ...(incident.justifications || []).map((x:any)=>({at:x.created_at,title:`Justificación · ${duration(x.justified_minutes)}`,detail:x.reason})),
    ...(incident.audit || []).map((x:any)=>({at:x.created_at,title:`Auditoría · ${String(x.action).replaceAll("_"," ")}`,detail:x.actor_role || "sistema"})),
  ].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return <div className={styles.timeline}>{items.map((x,i)=><div key={i}><span/><div><strong>{x.title}</strong><p>{x.detail}</p><small>{new Date(x.at).toLocaleString("es-ES")}</small></div></div>)}{!items.length && <p>Sin movimientos adicionales.</p>}</div>;
}

function SettingsForm({ value, busy, onSubmit }: { value: Settings; busy:boolean; onSubmit:(body:any)=>void }) {
  const [state,setState]=useState(value);
  const toggle=(key:keyof Settings)=>(e:any)=>setState(s=>({...s,[key]:e.target.checked}));
  return <form className={styles.form} onSubmit={e=>{e.preventDefault();onSubmit({action:"settings",...state});}}>
    {[
      ["allow_central_justify","Central puede justificar"],
      ["require_notes","Observaciones requeridas"],
      ["notify_worker","Notificar automáticamente"],
      ["show_in_invoice","Mostrar en factura"],
      ["allow_partial_recovery","Permitir recuperación parcial"],
    ].map(([key,label])=><label className={styles.toggle} key={key}><input type="checkbox" checked={Boolean((state as any)[key])} onChange={toggle(key as keyof Settings)}/><span>{label}</span></label>)}
    <label>Motivos disponibles<textarea rows={8} value={(state.reasons||[]).join("\n")} onChange={e=>setState(s=>({...s,reasons:e.target.value.split("\n").map(x=>x.trim()).filter(Boolean)}))}/></label>
    <button className={styles.submit} disabled={busy}>Guardar configuración</button>
  </form>;
}
