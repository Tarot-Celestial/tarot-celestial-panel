"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, ArrowUpRight, Boxes, CalendarDays, ChartColumn, CheckCheck, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList, Clock3, FileStack, Inbox, Layers3, ListChecks, MessagesSquare, Network, Orbit, Settings2, UsersRound } from "lucide-react";
import { officeDepartments } from "./catalog";
import OfficeMap from "./OfficeMap";
import OfficeLiveMap from "./OfficeLiveMap";
import OfficeMetaCapture from "./OfficeMetaCapture";
import OfficeCommercialInbox from "./OfficeCommercialInbox";
import OfficeCampaignPilot from "./OfficeCampaignPilot";
import OfficeAutonomy from "./OfficeAutonomy";
import OfficeReportView from "./OfficeReportView";
import type { OfficeReportArea } from "./OfficeMonthlyReport";
import OfficeCatalog from "./OfficeCatalog";
import OfficeClients from "./OfficeClients";
import OfficeClientLink, { type ClientArea } from "./OfficeClientLink";
import OfficeWork, { DepartmentOwner } from "./OfficeWork";
import type { OfficeSnapshot } from "./model";
import { latestVersions } from "./office-versions";
import s from "./OfficeWorkspace.module.css";

type WorkspaceView = "map" | "org" | "tasks" | "reviews";
type MonthlyView = OfficeReportArea | "captacion-meta" | "campanas";
type OperationalView = "comercial" | "autonomia";
type View = WorkspaceView | ClientArea | MonthlyView | OperationalView;
type Entry = { task?: string; version?: string; compose?: boolean };
function isClientArea(value: string | null): value is ClientArea { return value === "clientes" || value === "captacion-reservas"; }
function isReportArea(value: string | null): value is OfficeReportArea {
  return value === "finanzas" || value === "inteligencia" || value === "estrategia";
}
function isMonthlyView(value: string | null): value is MonthlyView { return isReportArea(value) || value === "captacion-meta" || value === "campanas"; }
function isOperationalView(value: string | null): value is OperationalView { return value === "comercial" || value === "autonomia"; }
function uuidParam(value: string | null) { return value && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value) ? value.toLowerCase() : null; }
function validMonth(value: string | null): value is string { return !!value && /^\d{4}-(?:0[1-9]|1[012])$/.test(value); }
function readLocation(tasks: OfficeSnapshot["tasks"]): { view: View; clientId: string | null; entry: Entry; month?: string; caseId?: string | null } {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const area = params.get("departamento"), id = params.get("cliente"), task = params.get("task");
  if (isMonthlyView(area)) {
    const month = params.get("mes");
    return { view: area, month: validMonth(month) ? month : undefined, clientId: null, entry: {} };
  }
  if (isOperationalView(area)) return { view: area, clientId: null, entry: {}, caseId: area === "comercial" ? uuidParam(params.get("caso")) : null };
  if (isClientArea(area)) return { view: area, clientId: uuidParam(id), entry: {} };
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
  { id: "captacion-meta", label: "Seguimiento de Meta", icon: MessagesSquare },
  { id: "comercial", label: "Bandeja de Comercial", icon: Inbox },
  { id: "campanas", label: "Campañas", icon: ChartColumn },
  { id: "finanzas", label: "Finanzas", icon: CircleDollarSign },
  { id: "autonomia", label: "Autonomía", icon: Settings2 },
] as const;

const eventLabels: Record<string, string> = {
  create_task: "Encargo creado", update_task: "Encargo actualizado", set_lead: "Responsable actualizado",
  add_note: "Nota de coordinación", add_version: "Versión añadida", review_version: "Versión revisada",
};
const eventDate = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const specialities: Partial<Record<string, string>> = {
  clientes: "Revisión de fichas y reservas", "captacion-reservas": "Seguimiento de primeras compras",
  inteligencia: "Análisis de procedencias", finanzas: "Informe mensual por moneda", estrategia: "Lectura de resultados",
  marketing: "Redacción para Marketing", "creacion-contenido": "Creación de piezas",
  comercial: "Atención de consultas derivadas",
};

export default function OfficeWorkspace({ data, reload }: { data: OfficeSnapshot; reload: () => Promise<void> }) {
  const [initial] = useState(() => readLocation(data.tasks));
  const [entry, setEntry] = useState(initial.entry);
  const [view, setView] = useState<View>(initial.view);
  const [clientId, setClientId] = useState(initial.clientId);
  const [caseId, setCaseId] = useState(initial.caseId ?? null);
  const currentMonth = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", timeZone: "Europe/Madrid" }).format(new Date());
  const [month, setMonth] = useState(initial.month ?? currentMonth);
  const [selectedId, selectId] = useState<string>(isClientArea(initial.view) || isReportArea(initial.view) || initial.view === "comercial" ? initial.view : "marketing");
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
      setCaseId(location.caseId ?? null);
      setScope(undefined);
      if (isMonthlyView(location.view)) setMonth(location.month ?? currentMonth);
      if (isClientArea(location.view) || isReportArea(location.view) || location.view === "comercial") selectId(location.view);
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [data.tasks, currentMonth]);
  function openReport(area: MonthlyView, nextMonth: string) {
    if (!validMonth(nextMonth)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("cliente"); url.searchParams.delete("task");
    url.searchParams.delete("caso");
    if (area !== "campanas" || view !== area || month !== nextMonth) url.searchParams.delete("campana");
    url.searchParams.set("departamento", area); url.searchParams.set("mes", nextMonth);
    if (url.href !== window.location.href) window.history.pushState({ ...window.history.state, officeView: area }, "", url);
    setEntry({}); setScope(undefined); setClientId(null); setCaseId(null); selectId(isReportArea(area) ? area : "marketing"); setMonth(nextMonth); setView(area);
  }
  function openOperational(area: OperationalView, opportunityId?: string) {
    const url = new URL(window.location.href);
    for (const key of ["cliente", "task", "mes", "campana", "caso"]) url.searchParams.delete(key);
    url.searchParams.set("departamento", area);
    const id = area === "comercial" ? uuidParam(opportunityId ?? null) : null;
    if (id) url.searchParams.set("caso", id);
    if (url.href !== window.location.href) window.history.pushState({ ...window.history.state, officeView: area }, "", url);
    setEntry({}); setScope(undefined); setClientId(null); setCaseId(id); setView(area);
    if (area === "comercial") selectId(area);
  }
  function openClientArea(area: ClientArea, id?: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("task"); url.searchParams.delete("mes");
    url.searchParams.delete("caso"); url.searchParams.delete("campana");
    url.searchParams.set("departamento", area);
    if (id) url.searchParams.set("cliente", id);
    else url.searchParams.delete("cliente");
    if (url.href !== window.location.href) window.history.pushState({ ...window.history.state, officeView: area }, "", url);
    setEntry({}); setScope(undefined); setClientId(id || null); selectId(area); setView(area);
  }
  function openView(next: WorkspaceView, departmentId?: string, target: typeof entry = {}) {
    setEntry(target);
    const url = new URL(window.location.href);
    url.searchParams.delete("departamento"); url.searchParams.delete("cliente"); url.searchParams.delete("mes");
    url.searchParams.delete("caso"); url.searchParams.delete("campana");
    if (target.task) url.searchParams.set("task", target.task);
    else url.searchParams.delete("task");
    if (isClientArea(view) || isMonthlyView(view) || isOperationalView(view)) window.history.pushState({ ...window.history.state, officeView: next }, "", url);
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
  function openHandoff(id: string) {
    if (id.startsWith("comercial:")) openOperational("comercial", id.slice(10));
    else if (id.startsWith("meta:")) openReport("captacion-meta", id.slice(5));
    else if (id.startsWith("cohorte:")) openReport("finanzas", id.slice(8));
    else if (id.startsWith("cliente:")) openClientArea("captacion-reservas", id.slice(8));
    else if (data.tasks.some(task => task.id === id)) openView("tasks", undefined, { task: id });
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
          <Icon aria-hidden="true" size={17}/>{label}</OfficeClientLink> : isMonthlyView(id) || isOperationalView(id) ?
          <a key={id} href={`/admin/oficina?departamento=${id}${isMonthlyView(id) ? "&mes=" + month : ""}`} aria-current={view === id ? "page" : undefined}
            onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); if (isMonthlyView(id)) openReport(id, month); else openOperational(id); } }}>
            <Icon aria-hidden="true" size={17}/>{label}</a> : <button type="button" key={id} onClick={() => openView(id)}
        aria-current={view === id ? "page" : undefined}><Icon aria-hidden="true" size={17}/>{label}
        {id === "reviews" && pendingReviews > 0 && <small>{pendingReviews}</small>}</button>)}
    </nav>
    {board ? <div className={s.board}>
      <section className={s.visual} aria-label={view === "org" ? "Organigrama de Oficina" : "Plano de Oficina"}>
        <div className={s.visualHead}><h2>{view === "org" ? "Cadena de mando" : "Plano de la oficina"}</h2>
          <span>{view === "org" ? "Estructura por departamento" : "Selecciona una sala"}</span></div>
        {view === "map" ? <OfficeLiveMap data={data} view="map" selectedId={selected.id} onSelect={inspect} onOpenTask={openHandoff} onOpenOrg={() => openView("org")}/> :
          <OfficeMap view="org" selectedId={selected.id} onSelect={inspect}/>}
      </section>
      <aside ref={details} tabIndex={-1} className={s.inspector} aria-label="Ficha de departamento" style={{ "--area-color": selected.color } as CSSProperties}>
        <div className={s.inspectorTop}><span>Ficha de departamento</span><span className={s.planned}>{isReportArea(selected.id) ? "Informes" : isClientArea(selected.id) ? "CRM" : selected.id === "comercial" ? "Atención" : selected.id === "marketing" || selected.id === "creacion-contenido" ? "Borradores" : "Planificado"}</span></div>
        <div className={s.areaTitle}><span className={s.areaMark} aria-hidden="true">{selected.initials}</span><h2>{selected.name}</h2></div>
        <p className={s.purpose}>{department?.purpose || selected.purpose}</p>
        {selected.id === "comercial" && <button type="button" className={s.openTasks} onClick={() => openOperational("comercial")}>Abrir bandeja de Comercial <ArrowUpRight size={16}/></button>}
        {["marketing","finanzas","estrategia"].includes(selected.id) && <button type="button" className={s.openTasks} onClick={() => openReport("campanas", month)}>Ver resultados por campaña <ArrowUpRight size={16}/></button>}
        {isReportArea(selected.id) && <button type="button" className={s.openTasks} onClick={() => {
          if (isReportArea(selected.id)) openReport(selected.id, month);
        }}>Abrir informe mensual <ArrowUpRight size={16}/></button>}
        {isClientArea(selected.id) && <OfficeClientLink area={selected.id} open={openClientArea} className={s.openTasks}>
          {selected.id === "clientes" ? "Abrir directorio de clientes" : "Abrir Captación y reservas"}<ArrowUpRight size={16} aria-hidden="true"/></OfficeClientLink>}
        {["marketing","captacion-reservas","comercial"].includes(selected.id) && <button type="button" className={s.openTasks}
          onClick={() => openReport("captacion-meta", month)}>Ver seguimiento de Meta <ArrowUpRight size={16}/></button>}
        {department && <DepartmentOwner key={department.id} departmentId={department.id} data={data} reload={reload}/>}
        <div className={s.areaStats} aria-label="Indicadores del departamento">
          <button type="button" onClick={() => openView("tasks", selected.id)}><span>Encargos</span><b>{areaTasks.length}</b></button>
          <button type="button" onClick={() => openView("reviews", selected.id)}><span>Por revisar</span><b>{areaReviews.length}</b></button>
        </div>
        <button type="button" className={s.openTasks} onClick={() => openView("tasks", selected.id)}>Ver encargos <ArrowUpRight size={16}/></button>
        <details className={s.detail}><summary><FileStack/>Entregables <ChevronDown/></summary>
          {areaDeliverables.length ? <ul>{areaDeliverables.map(item => <li key={item.id}>{item.title} · v{item.version}</li>)}</ul> : <p>Todavía no hay entregables.</p>}</details>
        <details className={s.detail}><summary><UsersRound/>Equipo y conexiones <ChevronDown/></summary><dl>
          <dt>Dirección</dt><dd>Atlas</dd><dt>Especialidad</dt><dd>{specialities[selected.id] || "Planificado"}</dd>
          <dt>Fuentes conectadas</dt><dd>{selected.id === "finanzas" ? "CRM y lectura autorizada de Contabilidad" :
            isReportArea(selected.id) ? "Informe mensual de primeras compras del CRM" :
            isClientArea(selected.id) ? "CRM y agendas de Tarot Celestial" :
            selected.id === "comercial" ? "Conversaciones derivadas y responsables de Central" :
            selected.id === "marketing" || selected.id === "creacion-contenido" ? "Estado en cada ejecución" : "Pendiente de conexión"}</dd></dl></details>
        {selected.id === "marketing" && <OfficeCatalog />}
        <details className={s.detail}><summary><Activity/>Indicadores, costes y avisos <ChevronDown/></summary>
          <p>Los recuentos corresponden a los registros actuales de esta Oficina.</p><dl><dt>Coste de IA</dt><dd>Sin datos</dd><dt>Alertas operativas</dt><dd>Planificado</dd></dl></details>
        <details className={s.detail}><summary><Clock3/>Coordinación e historial <ChevronDown/></summary>
          {events.length ? <ul>{events.map(event => <li key={event.id}>
            <strong>{event.note || eventLabels[event.kind] || "Cambio registrado"}</strong>
            <small>{data.workers.find(worker => worker.id === event.actor_id)?.name || "Personal"} · {eventDate.format(new Date(event.created_at))} (Madrid)</small>
          </li>)}</ul> : <p>Todavía no hay actividad registrada.</p>}</details>
      </aside>
    </div> : view === "captacion-meta" ? <OfficeMetaCapture month={month} onMonthChange={value => openReport("captacion-meta", value)}/> :
      view === "comercial" ? <OfficeCommercialInbox opportunityId={caseId ?? undefined}/> :
      view === "campanas" ? <OfficeCampaignPilot month={month} onMonthChange={value => openReport("campanas", value)}/> :
      view === "autonomia" ? <OfficeAutonomy/> :
      isReportArea(view) ? <OfficeReportView area={view} month={month} onMonthChange={value => openReport(view, value)}/> :
      isClientArea(view) ? <OfficeClients area={view} selectedId={clientId} open={openClientArea}/> :
      <OfficeWork key={`${view}-${scope || "todos"}-${entry.task || (entry.compose ? "atlas" : "")}`} view={view === "reviews" ? "reviews" : "tasks"} departmentId={scope}
      initialTask={entry.task} preferredVersion={entry.version} composeAtlas={entry.compose} onOpenTask={(task, version) => openView("tasks", undefined, { task, version })} data={data} reload={reload}/>}
  </main>;
}
