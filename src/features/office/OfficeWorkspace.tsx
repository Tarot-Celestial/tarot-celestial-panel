"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, ArrowUpRight, Boxes, CalendarDays, CheckCheck, ChevronDown, ChevronRight, ClipboardList, Clock3, FileStack, Layers3, ListChecks, Network, Orbit, UsersRound } from "lucide-react";
import { officeDepartments } from "./catalog";
import OfficeMap from "./OfficeMap";
import OfficeCatalog from "./OfficeCatalog";
import OfficeClients from "./OfficeClients";
import OfficeClientLink, { type ClientArea } from "./OfficeClientLink";
import OfficeWork, { DepartmentOwner } from "./OfficeWork";
import type { OfficeSnapshot } from "./model";
import { latestVersions } from "./office-versions";
import s from "./OfficeWorkspace.module.css";

type WorkspaceView = "map" | "org" | "tasks" | "reviews";
type View = WorkspaceView | ClientArea;
type Entry = { task?: string; version?: string; compose?: boolean };
function isClientArea(value: string | null): value is ClientArea { return value === "clientes" || value === "captacion-reservas"; }
function readLocation(tasks: OfficeSnapshot["tasks"]): { view: View; clientId: string | null; entry: Entry } {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const area = params.get("departamento"), id = params.get("cliente"), task = params.get("task");
  if (isClientArea(area)) return { view: area, clientId: id && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id) ? id.toLowerCase() : null, entry: {} };
  if (task && tasks.some(item => item.id === task)) return { view: "tasks", clientId: null, entry: { task } };
  const previous = typeof window !== "undefined" && window.history.state?.officeView;
  return { view: previous === "org" || previous === "tasks" || previous === "reviews" ? previous : "map", clientId: null, entry: {} };
}
const navigation = [
  { id: "map", label: "Plano", icon: Layers3 },
  { id: "org", label: "Organigrama", icon: Network },
  { id: "tasks", label: "Encargos", icon: ClipboardList },
  { id: "reviews", label: "Revisiones", icon: CheckCheck },
  { id: "clientes", label: "Clientes", icon: UsersRound },
  { id: "captacion-reservas", label: "Captación y reservas", icon: CalendarDays },
] as const;

const eventLabels: Record<string, string> = {
  create_task: "Encargo creado", update_task: "Encargo actualizado", set_lead: "Responsable actualizado",
  add_note: "Nota de coordinación", add_version: "Versión añadida", review_version: "Versión revisada",
};
const eventDate = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

export default function OfficeWorkspace({ data, reload }: { data: OfficeSnapshot; reload: () => Promise<void> }) {
  const [initial] = useState(() => readLocation(data.tasks));
  const [entry, setEntry] = useState(initial.entry);
  const [view, setView] = useState<View>(initial.view);
  const [clientId, setClientId] = useState(initial.clientId);
  const [selectedId, selectId] = useState<string>(isClientArea(initial.view) ? initial.view : "marketing");
  const [scope, setScope] = useState<string>();
  const details = useRef<HTMLElement>(null);
  const selected = officeDepartments.find(area => area.id === selectedId) || officeDepartments[0];
  const department = data.departments.find(area => area.id === selected.id);
  const areaTasks = data.tasks.filter(task => task.department_id === selected.id);
  const taskIds = new Set(areaTasks.map(task => task.id));
  const deliverables = Array.from(latestVersions(data.versions).values());
  const areaDeliverables = deliverables.filter(version => taskIds.has(version.task_id));
  const areaReviews = areaDeliverables.filter(version => version.status === "pendiente");
  const pendingReviews = deliverables.filter(version => version.status === "pendiente").length;
  const events = data.events.filter(event => event.department_id === selected.id || event.previous_department_id === selected.id).slice(0, 5);
  const openTasks = data.tasks.filter(task => task.status !== "completado" && task.status !== "cancelado").length;
  const board = view === "map" || view === "org";
  useEffect(() => {
    function restore() {
      const location = readLocation(data.tasks);
      setView(location.view); setEntry(location.entry); setClientId(location.clientId);
      setScope(undefined);
      if (isClientArea(location.view)) selectId(location.view);
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [data.tasks]);
  function openClientArea(area: ClientArea, id?: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    url.searchParams.set("departamento", area);
    if (id) url.searchParams.set("cliente", id);
    else url.searchParams.delete("cliente");
    if (url.href !== window.location.href) window.history.pushState({ ...window.history.state, officeView: area }, "", url);
    setEntry({}); setScope(undefined); setClientId(id || null); selectId(area); setView(area);
  }
  function openView(next: WorkspaceView, departmentId?: string, target: typeof entry = {}) {
    setEntry(target);
    const url = new URL(window.location.href);
    url.searchParams.delete("departamento"); url.searchParams.delete("cliente");
    if (target.task) url.searchParams.set("task", target.task);
    else url.searchParams.delete("task");
    if (isClientArea(view)) window.history.pushState({ ...window.history.state, officeView: next }, "", url);
    else window.history.replaceState({ ...window.history.state, officeView: next }, "", url);
    setClientId(null);
    setScope(departmentId);
    setView(next);
  }
  function inspect(id: string) {
    selectId(id);
    if (window.matchMedia("(max-width: 950px)").matches) {
      requestAnimationFrame(() => { details.current?.focus({ preventScroll: true }); details.current?.scrollIntoView({ block: "start" }); });
    }
  }
  return <main className={s.workspace}>
    <div className={s.headingRow}>
      <div><div className={s.breadcrumb}><span>Administración</span><ChevronRight size={13} aria-hidden="true"/> Oficina</div>
        <h1>Oficina <em>Celestial</em></h1></div>
      <div className={s.director}><div className={s.directorMark}><Orbit size={26} strokeWidth={1.35} aria-hidden="true"/></div>
        <div><span>Dirección operativa</span><strong>Atlas</strong></div>
        {board && <button type="button" className={s.atlasCta} onClick={() => openView("tasks", "marketing", { compose: true })}>Encargar a Atlas</button>}</div>
    </div>
    <div className={s.stats} aria-label="Resumen actual de Oficina">
      <div><Boxes/><span>Departamentos</span><strong>{data.departments.length}</strong></div>
      <div><ListChecks/><span>Encargos abiertos</span><strong>{openTasks}</strong></div>
      <div><FileStack/><span>Entregables</span><strong>{deliverables.length}</strong></div>
      <div><Clock3/><span>Por revisar</span><strong>{pendingReviews}</strong></div>
    </div>
    <nav className={s.nav} aria-label="Vistas de Oficina">
      {navigation.map(({ id, label, icon: Icon }) => isClientArea(id) ?
        <OfficeClientLink key={id} area={id} clientId={clientId} open={openClientArea} current={view === id}>
          <Icon aria-hidden="true" size={17}/>{label}</OfficeClientLink> : <button type="button" key={id} onClick={() => openView(id)}
        aria-current={view === id ? "page" : undefined}><Icon aria-hidden="true" size={17}/>{label}
        {id === "reviews" && pendingReviews > 0 && <small>{pendingReviews}</small>}</button>)}
    </nav>
    {board ? <div className={s.board}>
      <section className={s.visual} aria-label={view === "org" ? "Organigrama de Oficina" : "Plano de Oficina"}>
        <div className={s.visualHead}><h2>{view === "org" ? "Cadena de mando" : "Plano de la oficina"}</h2>
          <span>{view === "org" ? "Estructura por departamento" : "Selecciona una sala"}</span></div>
        <OfficeMap view={view === "org" ? "org" : "map"} selectedId={selected.id} onSelect={inspect} onOpenOrg={() => openView("org")}/>
      </section>
      <aside ref={details} tabIndex={-1} className={s.inspector} aria-label="Ficha de departamento" style={{ "--area-color": selected.color } as CSSProperties}>
        <div className={s.inspectorTop}><span>Ficha de departamento</span><span className={s.planned}>{isClientArea(selected.id) ? "CRM" : selected.id === "marketing" || selected.id === "creacion-contenido" ? "Borradores" : "Planificado"}</span></div>
        <div className={s.areaTitle}><span className={s.areaMark} aria-hidden="true">{selected.initials}</span><h2>{selected.name}</h2></div>
        <p className={s.purpose}>{department?.purpose || selected.purpose}</p>
        {isClientArea(selected.id) && <OfficeClientLink area={selected.id} open={openClientArea} className={s.openTasks}>
          {selected.id === "clientes" ? "Abrir directorio de clientes" : "Abrir Captación y reservas"}<ArrowUpRight size={16} aria-hidden="true"/></OfficeClientLink>}
        {department && <DepartmentOwner key={department.id} departmentId={department.id} data={data} reload={reload}/>}
        <div className={s.areaStats} aria-label="Indicadores del departamento">
          <button type="button" onClick={() => openView("tasks", selected.id)}><span>Encargos</span><b>{areaTasks.length}</b></button>
          <button type="button" onClick={() => openView("reviews", selected.id)}><span>Por revisar</span><b>{areaReviews.length}</b></button>
        </div>
        <button type="button" className={s.openTasks} onClick={() => openView("tasks", selected.id)}>Ver encargos <ArrowUpRight size={16}/></button>
        <details className={s.detail}><summary><FileStack/>Entregables <ChevronDown/></summary>
          {areaDeliverables.length ? <ul>{areaDeliverables.map(item => <li key={item.id}>{item.title} · v{item.version}</li>)}</ul> : <p>Todavía no hay entregables.</p>}</details>
        <details className={s.detail}><summary><UsersRound/>Equipo y conexiones <ChevronDown/></summary><dl>
          <dt>Dirección</dt><dd>Atlas</dd><dt>Especialista del área</dt><dd>{selected.id === "marketing" ? "Redacción para Marketing" : selected.id === "creacion-contenido" ? "Creación de piezas" : "Planificado"}</dd><dt>Herramientas externas</dt><dd>{isClientArea(selected.id) ? "CRM y agendas de Tarot Celestial" : selected.id === "marketing" || selected.id === "creacion-contenido" ? "Estado en cada ejecución" : "Pendiente de conexión"}</dd></dl></details>
        {selected.id === "marketing" && <OfficeCatalog />}
        <details className={s.detail}><summary><Activity/>Indicadores, costes y avisos <ChevronDown/></summary>
          <p>Los recuentos corresponden a los registros actuales de esta Oficina.</p><dl><dt>Coste de IA</dt><dd>Sin datos</dd><dt>Alertas operativas</dt><dd>Planificado</dd></dl></details>
        <details className={s.detail}><summary><Clock3/>Coordinación e historial <ChevronDown/></summary>
          {events.length ? <ul>{events.map(event => <li key={event.id}>
            <strong>{event.note || eventLabels[event.kind] || "Cambio registrado"}</strong>
            <small>{data.workers.find(worker => worker.id === event.actor_id)?.name || "Personal"} · {eventDate.format(new Date(event.created_at))} (Madrid)</small>
          </li>)}</ul> : <p>Todavía no hay actividad registrada.</p>}</details>
      </aside>
    </div> : isClientArea(view) ? <OfficeClients area={view} selectedId={clientId} open={openClientArea}/> :
      <OfficeWork key={`${view}-${scope || "todos"}-${entry.task || (entry.compose ? "atlas" : "")}`} view={view === "reviews" ? "reviews" : "tasks"} departmentId={scope}
      initialTask={entry.task} preferredVersion={entry.version} composeAtlas={entry.compose} onOpenTask={(task, version) => openView("tasks", undefined, { task, version })} data={data} reload={reload}/>}
  </main>;
}
