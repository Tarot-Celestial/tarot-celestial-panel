"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, Clock3, Gem, History, Pause, Play, Plus, RefreshCw, Search, Settings2, Shield, Sparkles, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { announceRitualChange, RITUAL_CHANGED } from "@/lib/ritual-sync";
import { isOpenRitual, ritualModes, ritualStatus, type ComputedRitual, type RitualType } from "@/lib/rituals";
import styles from "./ClientRitualsAdminPanel.module.css";

const sb = supabaseBrowser();
type Client = { id: string; nombre?: string; apellido?: string; email?: string; telefono?: string };
type AdminRitual = ComputedRitual & { cliente?: Client | null };
type Payload = { clients: Client[]; types: RitualType[]; rituals: AdminRitual[] };
type Send = (body: Record<string, unknown>) => Promise<boolean>;
const clientName = (client?: Client | null) => [client?.nombre, client?.apellido].filter(Boolean).join(" ") || client?.email || client?.telefono || "Cliente sin nombre";
const ritualName = (ritual: AdminRitual) => ritual.nombre_personalizado || ritual.ritual_types?.nombre || "Ritual";
const formatDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "Sin fecha";
const durationOf = (r: AdminRitual) => r.fecha_fin_prevista ? Math.max(1, Math.round((Date.parse(r.fecha_fin_prevista) - Date.parse(r.fecha_inicio)) / 86400000 * 100) / 100) : 7;
async function headers() {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function ClientRitualsAdminPanel() {
  const [data, setData] = useState<Payload>({ clients: [], types: [], rituals: [] });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const auth = await headers();
      if (controller.signal.aborted) return;
      const response = await fetch(`/api/admin/client-rituals?q=${encodeURIComponent(query)}`, { headers: auth, cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo cargar el panel.");
      if (!controller.signal.aborted) { setData(result); setUpdated(new Date()); setError(""); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo actualizar el panel."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [query]);
  useEffect(() => {
    const debounce = window.setTimeout(() => void load(), 250);
    const refresh = () => { if (!document.hidden && !writing.current) void load(); };
    const storage = (event: StorageEvent) => { if (event.key === RITUAL_CHANGED) refresh(); };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh); window.addEventListener("storage", storage);
    return () => { clearTimeout(debounce); clearInterval(timer); request.current?.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("storage", storage); };
  }, [load]);
  const send: Send = async body => {
    if (writing.current) return false;
    writing.current = true; setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/client-rituals", { method: "POST", headers: await headers(), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo guardar.");
      announceRitualChange();
      setMessage(result.warning || "Cambios guardados. El panel cliente actualizará su ritual automáticamente.");
      if (result.id) setSelected(result.id);
      await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar. Actualiza para comprobar el estado antes de repetir."); return false; }
    finally { writing.current = false; setBusy(false); }
  };
  const open = data.rituals.filter(r => isOpenRitual(r.estado));
  const normalized = search.toLocaleLowerCase();
  const visible = data.rituals.filter(r => (filter === "all" || filter === "open" && isOpenRitual(r.estado) || filter === "closed" && !isOpenRitual(r.estado)) && `${clientName(r.cliente)} ${ritualName(r)}`.toLocaleLowerCase().includes(normalized));
  const current = data.rituals.find(r => r.id === selected);
  return <section className={styles.root}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>EXPERIENCIA DIAMANTE · CONTROL DE RITUALES</span><h1>Una intención. Cada etapa bajo control.</h1><p>Asigna rituales, ajusta su evolución y cuida lo que ve cada cliente.</p></div><button className={styles.secondary} onClick={() => void load()} disabled={busy}><RefreshCw size={15} /> Actualizar</button></header>
    <div className={styles.metrics}><div><Sparkles /><strong>{open.filter(r => r.estado === "activo").length}</strong><span>En proceso</span></div><div><Pause /><strong>{open.filter(r => r.estado === "pausado").length}</strong><span>En pausa</span></div><div><Check /><strong>{data.rituals.filter(r => r.estado === "completado").length}</strong><span>Completados</span></div><div><Clock3 /><strong>{updated ? updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"}</strong><span>Última actualización</span></div></div>
    <p className={styles.caption}>Resumen de los últimos {data.rituals.length} rituales cargados · máximo 150. Actualización cada 20 segundos.</p>
    {message && <div className={styles.success} role="status"><Check size={18} />{message}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}
    <div className={styles.workspace}>
      <CreateRitual clients={data.clients} types={data.types} open={open} query={query} setQuery={setQuery} busy={busy} send={send} />
      <div className={styles.management}>
        <section className={styles.card}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>SEGUIMIENTO</span><h2>Rituales de tus clientes</h2></div><span className={styles.count}>{visible.length}</span></div>
          <div className={styles.toolbar}><div className={styles.tabs}>{[["open", "Abiertos"], ["closed", "Historial"], ["all", "Todos"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className={styles.search}><Search size={16} /><input aria-label="Filtrar rituales por cliente o nombre" placeholder="Cliente o ritual…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
          <div className={styles.list}>{loading && !data.rituals.length ? <p>Cargando rituales…</p> : !visible.length ? <div className={styles.empty}><Sparkles /><p>No hay rituales en esta vista.</p></div> : visible.map(ritual => <button type="button" className={styles.ritualRow} key={ritual.id} aria-pressed={selected === ritual.id} onClick={() => setSelected(ritual.id)}><span className={styles.symbol}>{ritual.ritual_types?.icono === "gem" ? <Gem /> : ritual.ritual_types?.icono === "shield" ? <Shield /> : <Sparkles />}</span><span className={styles.rowCopy}><b>{clientName(ritual.cliente)}</b><span>{ritualName(ritual)}</span><small>{ritual.phase.name || "Sin fase"} · {ritual.progress}%</small></span><span className={styles.badge} data-status={ritual.estado}>{ritualStatus[ritual.estado]}</span><ChevronRight size={16} /></button>)}</div>
        </section>
        {current ? <Editor key={current.id} ritual={current} busy={busy} send={send} /> : <section className={`${styles.card} ${styles.empty}`}><Settings2 size={32} /><h2>Elige un ritual para gestionarlo</h2><p>Revisa su fase, personaliza sus mensajes y consulta los cambios registrados.</p></section>}
      </div>
    </div>
  </section>;
}

function CreateRitual({ clients, types, open, query, setQuery, busy, send }: { clients: Client[]; types: RitualType[]; open: AdminRitual[]; query: string; setQuery: (q: string) => void; busy: boolean; send: Send }) {
  const [client, setClient] = useState<Client | null>(null);
  const [typeId, setTypeId] = useState("");
  const [duration, setDuration] = useState(7);
  const [mode, setMode] = useState("automatico");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [advice, setAdvice] = useState("");
  const activeTypes = types.filter(type => type.activo !== false);
  const type = activeTypes.find(t => t.id === typeId) || activeTypes[0];
  useEffect(() => { if (!typeId && activeTypes[0]) { setTypeId(activeTypes[0].id); setDuration(activeTypes[0].duracion_default_dias || 7); } }, [typeId, types]);
  const existing = open.find(r => r.cliente_id === client?.id);
  const choices = client && !clients.some(c => c.id === client.id) ? [client, ...clients] : clients;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || !type || existing) return;
    if (await send({ action: "create", cliente_id: client.id, ritual_type_id: type.id, modo: mode, duracion_dias: duration, nombre_personalizado: name, mensaje: message, consejo: advice })) { setName(""); setMessage(""); setAdvice(""); }
  }
  return <section className={`${styles.card} ${styles.assignment}`}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>NUEVA EXPERIENCIA</span><h2>Asignar un ritual</h2></div><Plus size={21} /></div><form onSubmit={submit}>
    <fieldset disabled={busy}><label>Buscar cliente<input value={query} placeholder="Nombre, correo o teléfono" onChange={e => setQuery(e.target.value)} /></label><label>Cliente<select required value={client?.id || ""} onChange={e => setClient(choices.find(c => c.id === e.target.value) || null)}><option value="">Selecciona un cliente</option>{choices.map(c => <option key={c.id} value={c.id}>{clientName(c)}</option>)}</select></label>
    {existing && <p className={styles.notice}>Este cliente ya tiene «{ritualName(existing)}» abierto. Ciérralo antes de asignar otro.</p>}
    <label>Tipo de ritual<select required value={type?.id || ""} onChange={e => { setTypeId(e.target.value); setDuration(types.find(t => t.id === e.target.value)?.duracion_default_dias || 7); }}>{activeTypes.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
    {type && <div className={styles.typePreview}><Sparkles size={22} /><div><b>{type.nombre}</b><p>{type.descripcion}</p><small>{type.fases?.length || 0} fases configuradas</small></div></div>}
    <div className={styles.two}><label>Modo<select value={mode} onChange={e => setMode(e.target.value)}>{Object.entries(ritualModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Duración · días<input required type="number" min="1" max="3650" step="0.01" value={duration} onChange={e => setDuration(Number(e.target.value))} /></label></div>
    <p className={styles.hint}>{mode === "manual" ? "El avance se controla con el porcentaje que guardes." : mode === "hibrido" ? "Avanza según las fechas hasta que actives un ajuste manual." : "El porcentaje avanza según las fechas de inicio y finalización."}</p>
    <details className={styles.custom}><summary>Personalizar nombre y mensajes</summary><label>Nombre visible<input maxLength={160} value={name} placeholder={type?.nombre || "Nombre del ritual"} onChange={e => setName(e.target.value)} /></label><label>Mensaje personalizado<textarea maxLength={2000} value={message} placeholder="Vacío: usar el mensaje de la fase" onChange={e => setMessage(e.target.value)} /></label><label>Consejo personalizado<textarea maxLength={2000} value={advice} placeholder="Vacío: usar el consejo de la fase" onChange={e => setAdvice(e.target.value)} /></label></details>
    <button type="submit" className={styles.primary} disabled={!client || !type || !!existing}><Plus size={16} /> {busy ? "Guardando…" : "Iniciar ritual"}</button></fieldset>
  </form><p className={styles.hint}>Los mensajes vacíos utilizan la configuración de cada fase. El acceso del cliente conserva sus requisitos de rango.</p></section>;
}

function draftOf(r: AdminRitual) { return { name: r.nombre_personalizado || "", mode: r.modo, duration: durationOf(r), progress: r.progress, override: r.override_automatico || r.modo === "manual", phase: r.fase_manual == null ? "" : String(r.fase_manual), message: r.mensaje_actual || "", advice: r.consejo_actual || "" }; }
function Editor({ ritual, busy, send }: { ritual: AdminRitual; busy: boolean; send: Send }) {
  const [base, setBase] = useState(ritual);
  const [draft, setDraft] = useState(() => draftOf(ritual));
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<"complete" | "cancel" | null>(null);
  const closed = !isOpenRitual(ritual.estado);
  const stale = dirty && base.updated_at !== ritual.updated_at;
  useEffect(() => { if (!dirty) { setDraft(draftOf(ritual)); setBase(ritual); } }, [ritual, dirty]);
  function change<K extends keyof typeof draft>(key: K, value: typeof draft[K]) { setDraft(d => ({ ...d, [key]: value })); setDirty(true); }
  const phases = ritual.ritual_types?.fases || [];
  async function save(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = { action: "update", id: ritual.id, expected_updated_at: base.updated_at, modo: draft.mode, nombre_personalizado: draft.name, mensaje: draft.message, consejo: draft.advice };
    if (draft.duration !== durationOf(base)) body.duracion_dias = draft.duration;
    if (draft.override || draft.mode === "manual") { body.progreso = draft.progress; body.fase_manual = draft.phase === "" ? null : Number(draft.phase); }
    else body.clear_override = true;
    if (await send(body)) setDirty(false);
  }
  async function action(action: string) {
    if (await send({ action, id: ritual.id, expected_updated_at: ritual.updated_at })) { setDirty(false); setConfirmation(null); }
  }
  return <section className={`${styles.card} ${styles.editor}`}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{closed ? "DETALLE DEL HISTORIAL" : "CONFIGURACIÓN DEL RITUAL"}</span><h2>{ritualName(ritual)}</h2><p>{clientName(ritual.cliente)}</p></div><span className={styles.badge} data-status={ritual.estado}>{ritualStatus[ritual.estado]}</span></div>
    <div className={styles.progressPanel}><div><span>Así lo ve el cliente</span><strong>{ritual.progress}%</strong></div><progress max={100} value={ritual.progress} aria-label="Progreso real del ritual" /><p>Fase {ritual.phase.index + 1} · {ritual.phase.name || "Sin fase"} · {ritualModes[ritual.modo]}{ritual.override_automatico && ritual.modo !== "manual" ? " con ajuste manual" : ""}</p></div>
    <div className={styles.dates}><span>Inicio <b>{formatDate(ritual.fecha_inicio)}</b></span><span>{ritual.estado === "completado" ? "Finalizado" : "Fin previsto"}<b>{formatDate(ritual.estado === "completado" ? ritual.fecha_fin_real : ritual.fecha_fin_prevista)}</b></span></div>
    {closed ? <div className={styles.readOnly}><p>{ritual.message}</p><p><b>Consejo:</b> {ritual.advice}</p><small>Ritual cerrado. Sus datos se conservan para consulta.</small></div> : <form onSubmit={save}><fieldset disabled={busy}>
      {stale && <p className={styles.notice}>Este ritual ha cambiado en otra sesión. Tus cambios sin guardar se mantienen. <button type="button" onClick={() => { setDirty(false); setDraft(draftOf(ritual)); setBase(ritual); }}>Descartar borrador y cargar cambios</button></p>}
      <label>Nombre visible<input maxLength={160} value={draft.name} placeholder={ritual.ritual_types?.nombre} onChange={e => change("name", e.target.value)} /></label>
      <div className={styles.two}><label>Modo de avance<select value={draft.mode} onChange={e => { change("mode", e.target.value); if (e.target.value === "manual") change("override", true); }}>{Object.entries(ritualModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Duración total · días<input required type="number" min="1" max="3650" step="0.01" value={draft.duration} onChange={e => change("duration", Number(e.target.value))} /></label></div>
      <label className={styles.toggle}><input type="checkbox" checked={draft.override || draft.mode === "manual"} disabled={draft.mode === "manual"} onChange={e => change("override", e.target.checked)} /><span><b>Control manual del progreso y la fase</b><small>Desactívalo para volver al avance según las fechas.</small></span></label>
      {(draft.override || draft.mode === "manual") && <div className={styles.two}><label>Progreso · %<input required type="number" min="0" max="100" step="0.1" value={draft.progress} onChange={e => change("progress", Number(e.target.value))} /></label><label>Fase visible<select value={draft.phase} onChange={e => change("phase", e.target.value)}><option value="">Según el porcentaje</option>{phases.map((phase, index) => <option key={index} value={index}>{index + 1} · {phase.name}</option>)}</select></label></div>}
      <div className={styles.two}><label>Mensaje para el cliente<textarea maxLength={2000} value={draft.message} placeholder={ritual.phase.message || "Mensaje de la fase"} onChange={e => change("message", e.target.value)} /></label><label>Consejo para el cliente<textarea maxLength={2000} value={draft.advice} placeholder={ritual.phase.advice || "Consejo de la fase"} onChange={e => change("advice", e.target.value)} /></label></div>
      <p className={styles.hint}>Deja los textos vacíos para recuperar los mensajes de cada fase. Guardar una duración no activa el control manual.</p>
      <div className={styles.actions}><button className={styles.primary} type="submit" disabled={!dirty || stale}><Check size={16} />{busy ? "Guardando…" : "Guardar cambios"}</button><span className={styles.hint}>{dirty ? "Tienes cambios sin guardar" : "Configuración guardada"}</span></div>
      <div className={styles.lifecycle}><button className={styles.secondary} type="button" disabled={dirty} onClick={() => void action(ritual.estado === "activo" ? "pause" : "resume")}>{ritual.estado === "activo" ? <Pause size={15} /> : <Play size={15} />}{ritual.estado === "activo" ? "Pausar" : "Reanudar"}</button><button className={styles.secondary} type="button" disabled={dirty} onClick={() => setConfirmation("complete")}><Check size={15} />Completar</button><button className={styles.danger} type="button" disabled={dirty} onClick={() => setConfirmation("cancel")}><X size={15} />Cancelar ritual</button></div>
      {confirmation && <div className={styles.notice}><p>{confirmation === "complete" ? "Se marcará como completado al 100 % y pasará al historial." : "El ritual se cerrará como cancelado y conservará su historial."}</p><div className={styles.actions}><button type="button" className={styles.primary} onClick={() => void action(confirmation)}>Confirmar {confirmation === "complete" ? "finalización" : "cancelación"}</button><button type="button" className={styles.secondary} onClick={() => setConfirmation(null)}>Volver</button></div></div>}
    </fieldset></form>}
    <EventHistory id={ritual.id} version={ritual.updated_at} />
  </section>;
}

function EventHistory({ id, version }: { id: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<{ id: string; tipo: string; created_at: string; detalle: Record<string, unknown> }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/admin/client-rituals?ritual_id=${id}`, { headers: await headers(), cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo cargar el historial.");
        if (!controller.signal.aborted) setEvents(data.events || []);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [id, version, open, retry]);
  const names: Record<string, string> = { ritual_iniciado: "Ritual iniciado", ritual_update: "Configuración actualizada", ritual_pause: "Ritual pausado", ritual_resume: "Ritual reanudado", ritual_complete: "Ritual completado", ritual_cancel: "Ritual cancelado" };
  const fields: Record<string, string> = { estado: "Estado", modo: "Modo", progreso_manual: "Progreso", fase_manual: "Fase manual", mensaje_actual: "Mensaje", consejo_actual: "Consejo", nombre_personalizado: "Nombre", fecha_inicio: "Inicio", fecha_fin_prevista: "Fin previsto", fecha_fin_real: "Finalización", override_automatico: "Ajuste manual", duracion_dias: "Duración en días" };
  return <details className={styles.events} onToggle={e => setOpen(e.currentTarget.open)}><summary><History size={16} />Historial de cambios</summary>{open && (loading ? <p>Cargando…</p> : error ? <p role="alert">{error} <button className={styles.secondary} onClick={() => setRetry(n => n + 1)}>Reintentar</button></p> : events.length ? <ol>{events.map(event => <li key={event.id}><div><b>{names[event.tipo] || event.tipo}</b><time>{formatDate(event.created_at)}</time></div><dl>{Object.entries(event.detalle || {}).filter(([key]) => fields[key]).map(([key, value]) => <div key={key}><dt>{fields[key]}</dt><dd>{key === "fase_manual" && value != null ? Number(value) + 1 : typeof value === "boolean" ? value ? "Sí" : "No" : value == null ? "Predeterminado" : String(value)}</dd></div>)}</dl></li>)}</ol> : <p>No hay cambios registrados.</p>)}</details>;
}
