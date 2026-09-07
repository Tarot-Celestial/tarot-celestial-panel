"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Activity, CalendarClock, ChevronDown, Clock3, ExternalLink, Filter, Mail, Megaphone, Phone, RefreshCw, Search, Sparkles, Target, UserCheck, Users } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./CaptacionPanel.module.css";

type ColumnKey = "nuevo" | "pend_free" | "pend_cap" | "cliente";
type ViewKey = "pendientes" | "hoy" | "urgentes" | "todos" | "cerrados";
type SortKey = "priority" | "recent" | "oldest" | "next" | "attempts" | "origin";
type ActionKey = "no_contesta" | "pendiente_free" | "hizo_free" | "recontacto" | "captado" | "no_interesado" | "reabrir" | "programar";

type Lead = {
  id: string;
  cliente_id: string | null;
  estado: string | null;
  workflow_state?: string | null;
  intento_actual?: number | null;
  max_intentos?: number | null;
  next_contact_at?: string | null;
  last_contact_at?: string | null;
  contacted_at?: string | null;
  closed_at?: string | null;
  last_result?: string | null;
  campaign_name?: string | null;
  form_name?: string | null;
  origen?: string | null;
  assigned_worker_id?: string | null;
  assigned_worker_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  cliente?: { id?: string | null; nombre?: string | null; apellido?: string | null; telefono?: string | null; email?: string | null; origen?: string | null } | null;
};

type Props = { onOpenClient?: (clienteId: string) => void };
type LiveState = "connecting" | "live" | "degraded";

const sb = supabaseBrowser();
const PAGE_SIZE = 18;
const CLOSED = new Set(["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"]);
const COLUMNS: Array<{ key: ColumnKey; title: string; short: string; subtitle: string; icon: typeof Users }> = [
  { key: "nuevo", title: "Cliente nuevo", short: "Nuevo", subtitle: "Primer contacto", icon: Sparkles },
  { key: "pend_free", title: "Pend FREE", short: "Pend FREE", subtitle: "Consulta gratis pendiente", icon: Clock3 },
  { key: "pend_cap", title: "Pend CAP", short: "Pend CAP", subtitle: "Lista para convertir", icon: Target },
  { key: "cliente", title: "Cliente", short: "Clientes", subtitle: "Compra confirmada", icon: UserCheck },
];

function fullName(lead: Lead) {
  return [lead.cliente?.nombre, lead.cliente?.apellido].filter(Boolean).join(" ").trim() || "Lead sin nombre";
}

function phone(lead: Lead) {
  return String(lead.cliente?.telefono || "").trim();
}

function phaseOf(lead: Lead): ColumnKey | "cerrado" {
  const state = String(lead.workflow_state || lead.estado || "nuevo").toLowerCase();
  if (["cliente", "captado"].includes(state)) return "cliente";
  if (["pend_cap", "hizo_free", "recontacto"].includes(state)) return "pend_cap";
  if (["pend_free", "pendiente_free", "no_contesta", "reintento_2", "reintento_3", "sin_respuesta"].includes(state)) return "pend_free";
  if (CLOSED.has(state) || lead.closed_at) return "cerrado";
  return "nuevo";
}

function timestamp(value?: string | null) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value?: string | null) {
  const time = timestamp(value);
  return time ? new Date(time).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "Sin programar";
}

function relative(value?: string | null) {
  const time = timestamp(value);
  if (!time) return "Sin fecha";
  const minutes = Math.round((time - Date.now()) / 60000);
  const abs = Math.abs(minutes);
  const amount = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.floor(abs / 60)} h` : `${Math.floor(abs / 1440)} d`;
  if (minutes < 0) return `Vencida ${amount}`;
  if (minutes < 1440) return "Hoy";
  return `En ${amount}`;
}

function urgency(lead: Lead) {
  const due = timestamp(lead.next_contact_at);
  if (!due) return { key: "today", label: "HOY" };
  const delta = due - Date.now();
  if (delta < 0) return { key: "overdue", label: relative(lead.next_contact_at).toUpperCase() };
  if (delta < 24 * 60 * 60 * 1000) return { key: "today", label: "HOY" };
  return { key: "scheduled", label: "PROGRAMADA" };
}

function priorityScore(lead: Lead) {
  let score = phaseOf(lead) === "pend_cap" ? 5000 : phaseOf(lead) === "nuevo" ? 3500 : phaseOf(lead) === "pend_free" ? 2500 : 0;
  const due = timestamp(lead.next_contact_at);
  if (!due) score += 1200;
  else if (due <= Date.now()) score += Math.min(2000, Math.floor((Date.now() - due) / 3600000) * 10 + 900);
  score += Math.min(500, Number(lead.intento_actual || 0) * 100);
  return score;
}

function dateTimeInput(value?: string | null) {
  const time = timestamp(value);
  const date = time ? new Date(time) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function CaptacionPanel({ onOpenClient }: Props) {
  const [brand, setBrand] = useState<"celestial" | "orion">("celestial");
  const [items, setItems] = useState<Lead[]>([]);
  const [view, setView] = useState<ViewKey>("pendientes");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [origin, setOrigin] = useState("all");
  const [campaign, setCampaign] = useState("all");
  const [worker, setWorker] = useState("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [mobileColumn, setMobileColumn] = useState<ColumnKey>("nuevo");
  const [limits, setLimits] = useState<Record<ColumnKey, number>>({ nuevo: PAGE_SIZE, pend_free: PAGE_SIZE, pend_cap: PAGE_SIZE, cliente: PAGE_SIZE });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [newLeadIds, setNewLeadIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setBrand(getActiveBrand());
    const onBrand = (event: Event) => setBrand(String((event as CustomEvent)?.detail?.brand || "celestial") === "orion" ? "orion" : "celestial");
    window.addEventListener("tc-brand-changed", onBrand);
    return () => window.removeEventListener("tc-brand-changed", onBrand);
  }, []);

  const load = useCallback(async (spinner = false) => {
    try {
      if (spinner) setLoading(true);
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
      const scope = view === "cerrados" ? "cerrados" : view === "todos" ? "todos" : "pendientes";
      const response = await fetch(`/api/captacion/list?scope=${scope}&brand=${brand}&t=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar Captación");
      setItems(Array.isArray(json.items) ? json.items : []);
      setMessage("");
    } catch (error: any) {
      setMessage(String(error?.message || "Error cargando Captación"));
      setLiveState("degraded");
    } finally {
      if (spinner) setLoading(false);
    }
  }, [brand, view]);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    setLiveState("connecting");
    const channel = sb
      .channel(`captacion-live-${brand}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, (payload: any) => {
        const id = String(payload?.new?.id || "");
        if (payload?.eventType === "INSERT" && id) {
          setNewLeadIds((current) => new Set(current).add(id));
          window.setTimeout(() => setNewLeadIds((current) => {
            const next = new Set(current); next.delete(id); return next;
          }), 8000);
        }
        void load(false);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveState("live");
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setLiveState("degraded");
      });
    return () => { void sb.removeChannel(channel); };
  }, [brand, load]);

  const act = useCallback(async (lead: Lead, action: ActionKey, nextContactAt?: string) => {
    const snapshot = items;
    const now = new Date().toISOString();
    setBusyId(lead.id);
    setMessage("");
    setItems((current) => current.map((item) => {
      if (item.id !== lead.id) return item;
      if (action === "programar") return { ...item, next_contact_at: nextContactAt || item.next_contact_at, updated_at: now };
      const nextState = action === "hizo_free" || action === "recontacto" ? "pend_cap" : action === "pendiente_free" || action === "no_contesta" ? "pend_free" : action === "captado" ? "captado" : action === "no_interesado" ? "no_interesado" : "nuevo";
      return { ...item, estado: nextState, workflow_state: nextState, updated_at: now, last_contact_at: now, closed_at: ["captado", "no_interesado"].includes(nextState) ? now : null };
    }));
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/captacion/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ lead_id: lead.id, action, next_contact_at: nextContactAt }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo actualizar el lead");
      setMessage(json.message || "✓ Lead actualizado");
      window.setTimeout(() => setMessage(""), 3500);
      void load(false);
    } catch (error: any) {
      setItems(snapshot);
      setMessage(String(error?.message || "Error actualizando lead"));
    } finally {
      setBusyId("");
    }
  }, [items, load]);

  const openClient = useCallback((lead: Lead) => {
    const id = String(lead.cliente_id || lead.cliente?.id || "");
    if (!id) return;
    if (onOpenClient) onOpenClient(id);
    else window.dispatchEvent(new CustomEvent("captacion-open-cliente", { detail: { id } }));
  }, [onOpenClient]);

  const options = useMemo(() => ({
    origins: Array.from(new Set(items.map((item) => item.origen || item.cliente?.origen).filter(Boolean) as string[])).sort(),
    campaigns: Array.from(new Set(items.map((item) => item.campaign_name).filter(Boolean) as string[])).sort(),
    workers: Array.from(new Map(items.filter((item) => item.assigned_worker_id).map((item) => [String(item.assigned_worker_id), String(item.assigned_worker_name || "Central")])).entries()),
  }), [items]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const rows = items.filter((lead) => {
      const due = timestamp(lead.next_contact_at);
      if (view === "hoy" && due > todayEnd.getTime()) return false;
      if (view === "urgentes" && due && due > Date.now()) return false;
      if (origin !== "all" && (lead.origen || lead.cliente?.origen) !== origin) return false;
      if (campaign !== "all" && lead.campaign_name !== campaign) return false;
      if (worker !== "all" && String(lead.assigned_worker_id || "") !== worker) return false;
      if (!q) return true;
      return [fullName(lead), phone(lead), lead.cliente?.email, lead.campaign_name, lead.form_name, lead.origen].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
    return [...rows].sort((a, b) => {
      if (sort === "recent") return timestamp(b.created_at) - timestamp(a.created_at);
      if (sort === "oldest") return timestamp(a.created_at) - timestamp(b.created_at);
      if (sort === "next") return (timestamp(a.next_contact_at) || Number.MAX_SAFE_INTEGER) - (timestamp(b.next_contact_at) || Number.MAX_SAFE_INTEGER);
      if (sort === "attempts") return Number(b.intento_actual || 0) - Number(a.intento_actual || 0);
      if (sort === "origin") return String(a.origen || "").localeCompare(String(b.origen || ""));
      return priorityScore(b) - priorityScore(a);
    });
  }, [campaign, deferredQuery, items, origin, sort, view, worker]);

  const byColumn = useMemo(() => {
    const map: Record<ColumnKey | "cerrado", Lead[]> = { nuevo: [], pend_free: [], pend_cap: [], cliente: [], cerrado: [] };
    for (const lead of filtered) map[phaseOf(lead)].push(lead);
    return map;
  }, [filtered]);

  const totals = useMemo(() => {
    const count = { nuevo: 0, pend_free: 0, pend_cap: 0, cliente: 0, cerrado: 0, due: 0 };
    for (const lead of items) {
      count[phaseOf(lead)] += 1;
      if (!lead.closed_at && (!timestamp(lead.next_contact_at) || timestamp(lead.next_contact_at) <= Date.now())) count.due += 1;
    }
    return count;
  }, [items]);

  return <section className={styles.shell}>
    <header className={styles.command}>
      <div className={styles.heroRow}>
        <div className={styles.titleBlock}><span className={styles.heroIcon}><Megaphone /></span><div><span className={styles.eyebrow}>CENTRO DE CONVERSIÓN</span><h2>Captación</h2><p>Entiende, prioriza y convierte cada oportunidad.</p></div></div>
        <div className={styles.heroActions}><span className={`${styles.live} ${styles[liveState]}`}><i />{liveState === "live" ? "EN VIVO" : liveState === "connecting" ? "CONECTANDO" : "SINCRONIZACIÓN DEGRADADA"}</span><button type="button" onClick={() => void load(true)} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} />{loading ? "Actualizando" : "Actualizar"}</button></div>
      </div>

      <div className={styles.hud}>
        <Hud icon={Activity} label="En vista" value={filtered.length} />
        <Hud icon={Phone} label="Llamar hoy" value={totals.due} tone="amber" />
        <Hud icon={Sparkles} label="Nuevos" value={totals.nuevo} tone="cyan" />
        <Hud icon={Clock3} label="Pend FREE" value={totals.pend_free} tone="gold" />
        <Hud icon={Target} label="Pend CAP" value={totals.pend_cap} tone="hot" featured />
        <Hud icon={UserCheck} label="Clientes" value={totals.cliente} tone="green" />
      </div>

      <div className={styles.funnel} aria-label="Embudo actual"><span>NUEVOS <b>{totals.nuevo}</b></span><i /><span>FREE <b>{totals.pend_free}</b></span><i /><span>PEND CAP <b>{totals.pend_cap}</b></span><i /><span>CLIENTES <b>{totals.cliente}</b></span></div>

      <div className={styles.viewTabs}>
        {(["pendientes", "hoy", "urgentes", "todos", "cerrados"] as ViewKey[]).map((key) => <button type="button" key={key} className={view === key ? styles.active : ""} onClick={() => setView(key)}>{key === "pendientes" ? "Pendientes" : key === "hoy" ? "Hoy" : key === "urgentes" ? "Urgentes" : key === "todos" ? "Todos" : `Cerrados · ${totals.cerrado}`}</button>)}
      </div>

      <div className={styles.filters}>
        <label className={styles.search}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, teléfono, email o campaña" /></label>
        <Select icon={Filter} value={origin} onChange={setOrigin} label="Todos los orígenes" options={options.origins.map((value) => [value, value])} />
        <Select value={campaign} onChange={setCampaign} label="Todas las campañas" options={options.campaigns.map((value) => [value, value])} />
        {options.workers.length ? <Select value={worker} onChange={setWorker} label="Todas las centrales" options={options.workers} /> : null}
        <Select value={sort} onChange={(value) => setSort(value as SortKey)} label="Prioridad automática" options={[["priority","Más urgente"],["recent","Más reciente"],["oldest","Más antiguo"],["next","Próxima gestión"],["attempts","Más intentos"],["origin","Origen"]]} />
      </div>
      {message ? <div className={styles.feedback}>{message}</div> : null}
    </header>

    {view === "cerrados" ? <div className={styles.closedList}>{filtered.length ? filtered.map((lead) => <LeadCard key={lead.id} lead={lead} fresh={newLeadIds.has(lead.id)} busy={busyId === lead.id} onAction={act} onOpen={openClient} />) : <Empty />}</div> : <>
      <div className={styles.mobileTabs}>{COLUMNS.map((column) => <button type="button" key={column.key} className={mobileColumn === column.key ? styles.active : ""} onClick={() => setMobileColumn(column.key)}>{column.short}<b>{byColumn[column.key].length}</b></button>)}</div>
      <div className={styles.board}>
        {COLUMNS.map((column) => { const Icon = column.icon; const rows = byColumn[column.key]; const shown = rows.slice(0, limits[column.key]); return <article key={column.key} className={`${styles.column} ${styles[column.key]} ${mobileColumn === column.key ? styles.mobileActive : ""}`}>
          <div className={styles.columnHead}><span><Icon /></span><div><h3>{column.title}</h3><p>{column.subtitle}</p></div><b>{rows.length}</b></div>
          <div className={styles.cards}>{shown.length ? shown.map((lead) => <LeadCard key={lead.id} lead={lead} fresh={newLeadIds.has(lead.id)} busy={busyId === lead.id} onAction={act} onOpen={openClient} />) : <Empty />}</div>
          {shown.length < rows.length ? <button type="button" className={styles.more} onClick={() => setLimits((current) => ({ ...current, [column.key]: current[column.key] + PAGE_SIZE }))}>Ver {Math.min(PAGE_SIZE, rows.length - shown.length)} más <ChevronDown /></button> : null}
        </article>; })}
      </div>
    </>}
  </section>;
}

function Hud({ icon: Icon, label, value, tone = "neutral", featured = false }: { icon: typeof Activity; label: string; value: number; tone?: string; featured?: boolean }) {
  return <article className={`${styles.hudCard} ${styles[tone]} ${featured ? styles.featured : ""}`}><span><Icon /></span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function Select({ icon: Icon, value, onChange, label, options }: { icon?: typeof Filter; value: string; onChange: (value: string) => void; label: string; options: Array<[string,string]> }) {
  return <label className={styles.select}>{Icon ? <Icon /> : null}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">{label}</option>{options.map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select><ChevronDown /></label>;
}

function LeadCard({ lead, fresh, busy, onAction, onOpen }: { lead: Lead; fresh: boolean; busy: boolean; onAction: (lead: Lead, action: ActionKey, next?: string) => void; onOpen: (lead: Lead) => void }) {
  const phase = phaseOf(lead);
  const due = urgency(lead);
  const [schedule, setSchedule] = useState(() => dateTimeInput(lead.next_contact_at));
  return <div className={`${styles.card} ${fresh ? styles.fresh : ""}`}>
    {fresh ? <span className={styles.newFlag}>✨ NUEVO LEAD</span> : null}
    <div className={styles.cardTop}><div><h4>{fullName(lead)}</h4><a href={phone(lead) ? `tel:${phone(lead)}` : undefined}><Phone />{phone(lead) || "Sin teléfono"}</a>{lead.cliente?.email ? <span><Mail />{lead.cliente.email}</span> : null}</div><span className={`${styles.due} ${styles[due.key]}`}>{due.label}</span></div>
    <div className={styles.meta}><span className={styles.phase}>{phase === "nuevo" ? "Cliente nuevo" : phase === "pend_free" ? "Pendiente FREE" : phase === "pend_cap" ? "Pendiente captación" : phase === "cliente" ? "Cliente" : "Cerrado"}</span><span>{lead.origen || lead.cliente?.origen || "Origen sin registrar"}</span>{lead.campaign_name ? <span>{lead.campaign_name}</span> : null}</div>
    <dl><div><dt>Próxima gestión</dt><dd>{formatDate(lead.next_contact_at)}</dd></div><div><dt>Última gestión</dt><dd>{lead.last_contact_at ? relative(lead.last_contact_at).replace("Vencida", "Hace") : "Sin gestión"}</dd></div><div><dt>Intentos</dt><dd>{Math.max(1, Number(lead.intento_actual || 1))}/{Math.max(3, Number(lead.max_intentos || 3))}</dd></div>{lead.assigned_worker_name ? <div><dt>Central</dt><dd>{lead.assigned_worker_name}</dd></div> : null}</dl>
    <div className={styles.primaryActions}><a className={!phone(lead) ? styles.disabled : ""} href={phone(lead) ? `tel:${phone(lead)}` : undefined}><Phone />Llamar</a><button type="button" onClick={() => onOpen(lead)}><ExternalLink />Abrir CRM</button></div>
    <details className={styles.quick}><summary>Acciones rápidas <ChevronDown /></summary><div>
      {phase !== "cerrado" && phase !== "cliente" ? <><button disabled={busy} onClick={() => onAction(lead,"no_contesta")}>No responde</button><button disabled={busy} onClick={() => onAction(lead,"pendiente_free")}>Pend FREE</button><button disabled={busy} onClick={() => onAction(lead, phase === "pend_cap" ? "recontacto" : "hizo_free")}>{phase === "pend_cap" ? "Recontactar promo" : "FREE realizada"}</button><button disabled={busy} onClick={() => onAction(lead,"captado")}>Cliente</button><button disabled={busy} className={styles.danger} onClick={() => onAction(lead,"no_interesado")}>No interesa</button></> : <button disabled={busy} onClick={() => onAction(lead,"reabrir")}>Reabrir</button>}
      <label><CalendarClock /><input type="datetime-local" value={schedule} onChange={(event) => setSchedule(event.target.value)} /><button disabled={busy || !schedule} onClick={() => onAction(lead,"programar",new Date(schedule).toISOString())}>Programar</button></label>
    </div></details>
  </div>;
}

function Empty() { return <div className={styles.empty}>Sin leads en esta fase</div>; }
