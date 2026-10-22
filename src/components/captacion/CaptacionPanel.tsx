"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CalendarClock, ChevronDown, Clock3, ExternalLink, Filter, Mail, Megaphone, MessageCircle, Phone, RefreshCw, Search, Sparkles, Target, UserCheck, Users } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./CaptacionPanel.module.css";
import CaptacionWhatsAppComposer from "./CaptacionWhatsAppComposer";

type ColumnKey = "nuevo" | "pend_free" | "pend_cap" | "cliente" | "cerrado";
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
  latest_meta_lead_at?: string | null;
  cliente?: { id?: string | null; nombre?: string | null; apellido?: string | null; telefono?: string | null; email?: string | null; origen?: string | null } | null;
};

type Props = { onOpenClient?: (clienteId: string) => void; onOpenWhatsApp?: () => void };
type LiveState = "connecting" | "live" | "degraded";
type MetaDiagnostics = {
  configuration: Record<string, boolean>;
  last_event: { status: string; source: string; received_at: string; inserted_at?: string | null; visible_at?: string | null } | null;
  event_read_available: boolean;
};

const sb = supabaseBrowser();
const PAGE_SIZE = 18;
const CLOSED = new Set(["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"]);
const COLUMNS: Array<{ key: ColumnKey; title: string; short: string; subtitle: string; icon: typeof Users }> = [
  { key: "nuevo", title: "Cliente nuevo", short: "Nuevo", subtitle: "Primer contacto", icon: Sparkles },
  { key: "pend_free", title: "Pend FREE", short: "Pend FREE", subtitle: "Consulta gratis pendiente", icon: Clock3 },
  { key: "pend_cap", title: "Pend CAP", short: "Pend CAP", subtitle: "Lista para convertir", icon: Target },
  { key: "cliente", title: "Clientes", short: "Clientes", subtitle: "Captaciones completadas", icon: UserCheck },
  { key: "cerrado", title: "Cerrados", short: "Cerrados", subtitle: "Seguimientos cerrados", icon: Filter },
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
  if (CLOSED.has(state) || lead.closed_at) return "cerrado";
  if (["pend_cap", "hizo_free", "recontacto"].includes(state)) return "pend_cap";
  if (["pend_free", "pendiente_free", "no_contesta", "reintento_2", "reintento_3", "sin_respuesta"].includes(state)) return "pend_free";
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

export default function CaptacionPanel({ onOpenClient, onOpenWhatsApp }: Props) {
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
  const [limits, setLimits] = useState<Record<ColumnKey, number>>({ nuevo: PAGE_SIZE, pend_free: PAGE_SIZE, pend_cap: PAGE_SIZE, cliente: PAGE_SIZE, cerrado: PAGE_SIZE });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [newLeadIds, setNewLeadIds] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [metaDiagnostics, setMetaDiagnostics] = useState<MetaDiagnostics | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [messageLeadId, setMessageLeadId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusedLead, setFocusedLead] = useState<Lead | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const focusOpenedRef = useRef<string | null>(null);
  const requestRef = useRef<{ id: number; key: string; controller: AbortController; reading: boolean; firstPage: number } | null>(null);
  const sequenceRef = useRef(0);
  const pendingRefreshRef = useRef(false);
  const itemsRef = useRef(items);
  const nextPageRef = useRef(nextPage);
  const pagesToLoadRef = useRef(4);
  const lastVisibleRef = useRef(0);
  const actionBusyRef = useRef(false);
  const mountedRef = useRef(false);
  const scope = view === "cerrados" ? "cerrados" : view === "todos" ? "todos" : "pendientes";
  const loadKey = `${brand}:${scope}`;
  const currentKeyRef = useRef(loadKey);
  currentKeyRef.current = loadKey;
  itemsRef.current = items;
  nextPageRef.current = nextPage;
  const visibleColumns = view === "todos" ? COLUMNS : COLUMNS.slice(0, 3);
  const availableItems = useMemo(() => focusedLead && !items.some(item => item.id === focusedLead.id) ? [focusedLead, ...items] : items, [focusedLead, items]);

  const prepareWhatsApp = useCallback((lead: Lead) => {
    setMessageLeadId(lead.id);
    document.getElementById?.("captacion-whatsapp")?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

  useEffect(() => {
    const focus = (value: unknown) => {
      if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return;
      focusOpenedRef.current = null;
      setFocusId(value); setFocusedLead(null); setMessageLeadId(null);
      setView("todos"); setQuery(""); setOrigin("all"); setCampaign("all"); setWorker("all");
      try { sessionStorage.removeItem("tc-captacion-focus-lead"); } catch { /* Optional navigation handoff. */ }
    };
    try { focus(sessionStorage.getItem("tc-captacion-focus-lead")); } catch { /* Direct navigation still works. */ }
    const onFocus = (event: Event) => focus((event as CustomEvent)?.detail?.leadId);
    window.addEventListener("tc-captacion-focus-lead", onFocus);
    return () => window.removeEventListener("tc-captacion-focus-lead", onFocus);
  }, []);

  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (controller.signal.aborted) return;
        const token = data.session?.access_token;
        if (!token) throw new Error("Vuelve a iniciar sesión para abrir este contacto.");
        const response = await fetch(`/api/captacion/list?scope=todos&brand=${brand}&lead_id=${encodeURIComponent(focusId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const json = await response.json();
        if (controller.signal.aborted) return;
        const lead = response.ok && json.ok ? json.items?.find((item: Lead) => item.id === focusId) : null;
        if (!lead) throw new Error("Este contacto ya no está disponible en tu cartera. Actualiza Captación.");
        setFocusedLead(lead);
        const focusKey = `${brand}:${focusId}`;
        if (focusOpenedRef.current !== focusKey) {
          focusOpenedRef.current = focusKey;
          setMessageLeadId(lead.id); setMobileColumn(phaseOf(lead));
          document.getElementById?.("captacion-whatsapp")?.scrollIntoView({ block: "start", behavior: "auto" });
        }
      } catch (error) {
        if (!cancelled) { setFocusedLead(null); setMessageLeadId(null); setMessage(error instanceof Error ? error.message : "No se pudo abrir el contacto del aviso."); }
      } finally { window.clearTimeout(deadline); }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(deadline); };
  }, [focusId, brand, focusRevision]);

  useEffect(() => {
    setBrand(getActiveBrand());
    const onBrand = (event: Event) => { setBrand(String((event as CustomEvent)?.detail?.brand || "celestial") === "orion" ? "orion" : "celestial"); setFocusId(null); setFocusedLead(null); setMessageLeadId(null); };
    window.addEventListener("tc-brand-changed", onBrand);
    return () => window.removeEventListener("tc-brand-changed", onBrand);
  }, []);

  const load = useCallback(async (force = false, append = false) => {
    if (!mountedRef.current || currentKeyRef.current !== loadKey) return;
    if (requestRef.current?.key === loadKey && !force) {
      pendingRefreshRef.current = true;
      return;
    }
    const firstPage = append ? nextPageRef.current : 0;
    if (firstPage === null) return;
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++sequenceRef.current;
    requestRef.current = { id, key: loadKey, controller, reading: false, firstPage };
    pendingRefreshRef.current = false;
    const isCurrent = () => !controller.signal.aborted && requestRef.current?.id === id && currentKeyRef.current === loadKey;
    const deadline = window.setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort();
      requestRef.current = null;
      pendingRefreshRef.current = false;
      setLoading(false);
      setLoadError("La lectura está tardando demasiado. Pulsa Actualizar para volver a intentarlo.");
    }, 20_000);
    setLoading(true);
    try {
      const { data } = await sb.auth.getSession();
      if (!isCurrent()) return;
      const token = data.session?.access_token;
      if (!token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
      const collected = new Map<string, Lead>((append ? itemsRef.current : []).map(item => [item.id, item]));
      let page: number | null = firstPage;
      let completedPages = 0;
      let latest: any = null;
      const pageBudget = append ? 4 : pagesToLoadRef.current;
      if (requestRef.current?.id === id) requestRef.current.reading = true;
      while (page !== null && completedPages < pageBudget) {
        const response: Response = await fetch(`/api/captacion/list?scope=${scope}&brand=${brand}&page=${page}&t=${Date.now()}`, {
          cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        const json: any = await response.json().catch(() => null);
        if (!isCurrent()) return;
        if (!response.ok || !json?.ok) {
          if (response.status === 401 || response.status === 403) { setItems([]); setMetaDiagnostics(null); setNextPage(null); setLastRefreshed(null); setFocusId(null); setFocusedLead(null); setMessageLeadId(null); }
          throw new Error(json?.error || "No se pudo cargar Captación");
        }
        for (const item of Array.isArray(json.items) ? json.items : []) collected.set(item.id, item);
        latest = json;
        const next: unknown = json.pagination?.next_page;
        if (next !== undefined && next !== null && (typeof next !== "number" || !Number.isSafeInteger(next) || next <= page)) throw new Error("No se pudo continuar la lista de contactos.");
        page = typeof next === "number" ? next : null;
        completedPages += 1;
      }
      if (!isCurrent()) return;
      pagesToLoadRef.current = Math.max(pagesToLoadRef.current, firstPage + completedPages);
      setItems(Array.from(collected.values()));
      setFocusRevision(value => value + 1);
      setNextPage(page);
      setMetaDiagnostics(latest?.meta_diagnostics || null);
      setLastRefreshed(latest?.server_time || new Date().toISOString());
      setLoadError("");
    } catch (error: any) {
      if (isCurrent()) setLoadError(String(error?.message || "Error cargando Captación"));
    } finally {
      window.clearTimeout(deadline);
      if (isCurrent()) {
        requestRef.current = null;
        setLoading(false);
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          window.setTimeout(() => { if (mountedRef.current && currentKeyRef.current === loadKey) void load(false); }, 100);
        }
      }
    }
  }, [brand, loadKey, scope]);

  useEffect(() => {
    mountedRef.current = true;
    setItems([]); setNextPage(null); setMetaDiagnostics(null); setLastRefreshed(null); setLoadError("");
    setOrigin("all"); setCampaign("all"); setWorker("all"); setMobileColumn("nuevo");
    pagesToLoadRef.current = 4;
    void load(true);
    return () => {
      mountedRef.current = false;
      requestRef.current?.controller.abort();
      requestRef.current = null;
      pendingRefreshRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      requestRef.current?.controller.abort();
      requestRef.current = null;
      pendingRefreshRef.current = false;
      setItems([]); setMetaDiagnostics(null); setNextPage(null); setLastRefreshed(null); setLoading(false);
      setFocusId(null); setFocusedLead(null); setMessageLeadId(null);
      setLoadError("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 60_000);
    const refreshVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastVisibleRef.current < 1000) return;
      lastVisibleRef.current = Date.now();
      void load(false);
    };
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    let subscribed = false;
    setLiveState("connecting");
    const channel = sb
      .channel(`captacion-live-${brand}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, (payload: any) => {
        if (!active) return;
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
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setLiveState("live");
          if (subscribed) return;
          subscribed = true;
          // Close the snapshot/subscription gap and recover changes missed while
          // disconnected. A full read still waiting for Auth will be fresh;
          // an already-started or appended page needs a catch-up from page 0.
          if (requestRef.current?.key !== loadKey || requestRef.current.reading || requestRef.current.firstPage > 0) void load(false);
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          subscribed = false;
          setLiveState("degraded");
        }
      });
    return () => { active = false; void sb.removeChannel(channel); };
  }, [brand, load, loadKey]);

  const act = useCallback(async (lead: Lead, action: ActionKey, nextContactAt?: string) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    const actionKey = currentKeyRef.current;
    const snapshot = lead;
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
      window.dispatchEvent(new Event("tc-captacion-changed"));
      if (currentKeyRef.current !== actionKey) return;
      setMessage(json.message || "✓ Lead actualizado");
      window.setTimeout(() => setMessage(""), 3500);
      void load(false);
    } catch (error: any) {
      if (currentKeyRef.current === actionKey) {
        setItems(current => current.map(item => item.id === lead.id ? snapshot : item));
        setMessage(String(error?.message || "Error actualizando lead"));
      }
    } finally {
      actionBusyRef.current = false;
      setBusyId("");
    }
  }, [load]);

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

  useEffect(() => {
    if (loading) return;
    if (origin !== "all" && !options.origins.includes(origin)) setOrigin("all");
    if (campaign !== "all" && !options.campaigns.includes(campaign)) setCampaign("all");
    if (worker !== "all" && !options.workers.some(([id]) => id === worker)) setWorker("all");
  }, [campaign, loading, options, origin, worker]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const rows = availableItems.filter((lead) => {
      if (focusId && lead.id !== focusId) return false;
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
  }, [campaign, deferredQuery, availableItems, focusId, origin, sort, view, worker]);

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
        <div className={styles.heroActions}><span className={`${styles.live} ${styles[liveState]}`} title="Estado de la conexión con los cambios del panel; no confirma la llegada de contactos desde Meta."><i />{liveState === "live" ? "CAMBIOS EN DIRECTO" : liveState === "connecting" ? "CONECTANDO AL PANEL" : "ACTUALIZACIÓN PERIÓDICA"}</span><button type="button" onClick={() => void load(true)} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} />{loading ? "Actualizando" : "Actualizar"}</button></div>
      </div>
      <p className={styles.readStatus} role="status">{loading ? "Cargando contactos…" : lastRefreshed ? `Datos leídos: ${formatDate(lastRefreshed)}.` : "Todavía no se han podido leer los contactos."} Las llegadas desde Meta dependen de la integración de entrada.</p>
      {loadError ? <div className={styles.error} role="alert">{loadError}{lastRefreshed ? " Se conserva la última lectura correcta." : ""}</div> : null}
      {metaDiagnostics ? <details className={styles.metaStatus}>
        <summary>{["access_token", "form_ids", "app_secret", "verify_token"].every(key => metaDiagnostics.configuration[key]) ? "Entrada de Meta: configuración presente · Ver diagnóstico" : "Entrada de Meta: configuración directa incompleta · Ver diagnóstico"}</summary>
        <p>Estos indicadores comprueban configuración y eventos recibidos. No confirman que Meta esté enviando todos sus contactos ni que exista una tarea programada.</p>
        <ul>{([
          ["access_token", "Acceso para consultar leads en Meta"], ["form_ids", "Formularios para recuperación"],
          ["app_secret", "Validación de firma del webhook"], ["verify_token", "Verificación del webhook"],
          ["internal_ingest", "Entrada mediante integración interna"], ["reconciliation_auth", "Autorización para recuperación programada"],
        ] as const).map(([key, label]) => <li key={key}><span>{label}</span><strong>{metaDiagnostics.configuration[key] ? "Configurado" : "Sin configurar"}</strong></li>)}</ul>
        <p>{!metaDiagnostics.event_read_available ? "No se pudo consultar el registro de entradas." : metaDiagnostics.last_event ? `Último evento registrado: ${formatDate(metaDiagnostics.last_event.received_at)} · ${metaDiagnostics.last_event.source === "internal_ingest" ? "Integración interna" : metaDiagnostics.last_event.source === "meta_reconciliation" ? "Recuperación de Meta" : metaDiagnostics.last_event.source === "meta_webhook" ? "Webhook de Meta" : "Otra entrada"} · ${metaDiagnostics.last_event.status === "processed" ? "Procesado" : metaDiagnostics.last_event.status === "failed" ? "Fallido" : "Pendiente de procesar"}.` : "No hay eventos de entrada registrados."}</p>
      </details> : null}

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
        {(["pendientes", "hoy", "urgentes", "todos", "cerrados"] as ViewKey[]).map((key) => <button type="button" key={key} className={view === key ? styles.active : ""} onClick={() => { setView(key); setFocusId(null); setFocusedLead(null); }}>{key === "pendientes" ? "Pendientes" : key === "hoy" ? "Hoy" : key === "urgentes" ? "Urgentes" : key === "todos" ? "Todos" : `Cerrados · ${totals.cerrado}`}</button>)}
      </div>

      <div className={styles.filters}>
        <label className={styles.search}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, teléfono, email o campaña" /></label>
        <Select icon={Filter} value={origin} onChange={setOrigin} label="Todos los orígenes" options={options.origins.map((value) => [value, value])} />
        <Select value={campaign} onChange={setCampaign} label="Todas las campañas" options={options.campaigns.map((value) => [value, value])} />
        {options.workers.length ? <Select value={worker} onChange={setWorker} label="Todas las centrales" options={options.workers} /> : null}
        <Select value={sort} onChange={(value) => setSort(value as SortKey)} label="Prioridad automática" options={[["priority","Más urgente"],["recent","Más reciente"],["oldest","Más antiguo"],["next","Próxima gestión"],["attempts","Más intentos"],["origin","Origen"]]} />
        {query || focusId || origin !== "all" || campaign !== "all" || worker !== "all" ? <button className={styles.clearFilters} type="button" onClick={() => { setQuery(""); setFocusId(null); setFocusedLead(null); setOrigin("all"); setCampaign("all"); setWorker("all"); }}>Limpiar filtros</button> : null}
      </div>
      {message ? <div className={styles.feedback}>{message}</div> : null}
    </header>

    {brand === "celestial" ? <CaptacionWhatsAppComposer contacts={availableItems} selectedLeadId={messageLeadId} onSelectLead={setMessageLeadId} onOpenWhatsApp={onOpenWhatsApp} /> : null}

    {view === "cerrados" ? <div className={styles.closedList}>{filtered.length ? filtered.map((lead) => <LeadCard key={lead.id} lead={lead} fresh={newLeadIds.has(lead.id)} busy={busyId === lead.id} onAction={act} onOpen={openClient} onWhatsApp={brand === "celestial" ? prepareWhatsApp : undefined} />) : <Empty />}</div> : <>
      <div className={styles.mobileTabs}>{visibleColumns.map((column) => <button type="button" key={column.key} className={mobileColumn === column.key ? styles.active : ""} onClick={() => setMobileColumn(column.key)}>{column.short}<b>{byColumn[column.key].length}</b></button>)}</div>
      <div className={`${styles.board} ${view === "todos" ? styles.allBoard : ""}`}>
        {visibleColumns.map((column) => { const Icon = column.icon; const rows = byColumn[column.key]; const shown = rows.slice(0, limits[column.key]); return <article key={column.key} className={`${styles.column} ${styles[column.key]} ${mobileColumn === column.key ? styles.mobileActive : ""}`}>
          <div className={styles.columnHead}><span><Icon /></span><div><h3>{column.title}</h3><p>{column.subtitle}</p></div><b>{rows.length}</b></div>
          <div className={styles.cards}>{shown.length ? shown.map((lead) => <LeadCard key={lead.id} lead={lead} fresh={newLeadIds.has(lead.id)} busy={busyId === lead.id} onAction={act} onOpen={openClient} onWhatsApp={brand === "celestial" ? prepareWhatsApp : undefined} />) : <Empty />}</div>
          {shown.length < rows.length ? <button type="button" className={styles.more} onClick={() => setLimits((current) => ({ ...current, [column.key]: current[column.key] + PAGE_SIZE }))}>Ver {Math.min(PAGE_SIZE, rows.length - shown.length)} más <ChevronDown /></button> : null}
        </article>; })}
      </div>
    </>}
    {nextPage !== null ? <div className={styles.pagination}>
      <p>{items.length} contactos cargados. Quedan más por cargar; los filtros y contadores se aplican a esta carga.</p>
      <button type="button" disabled={loading} onClick={() => void load(false, true)}>{loading ? "Cargando…" : "Cargar más contactos"}</button>
    </div> : null}
  </section>;
}

function Hud({ icon: Icon, label, value, tone = "neutral", featured = false }: { icon: typeof Activity; label: string; value: number; tone?: string; featured?: boolean }) {
  return <article className={`${styles.hudCard} ${styles[tone]} ${featured ? styles.featured : ""}`}><span><Icon /></span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function Select({ icon: Icon, value, onChange, label, options }: { icon?: typeof Filter; value: string; onChange: (value: string) => void; label: string; options: Array<[string,string]> }) {
  return <label className={styles.select}>{Icon ? <Icon /> : null}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="all">{label}</option>{options.map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select><ChevronDown /></label>;
}

function LeadCard({ lead, fresh, busy, onAction, onOpen, onWhatsApp }: { lead: Lead; fresh: boolean; busy: boolean; onAction: (lead: Lead, action: ActionKey, next?: string) => void; onOpen: (lead: Lead) => void; onWhatsApp?: (lead: Lead) => void }) {
  const phase = phaseOf(lead);
  const due = urgency(lead);
  const metaLeadAt = timestamp(lead.latest_meta_lead_at);
  const age = Date.now() - metaLeadAt;
  const handledAt = Math.max(timestamp(lead.last_contact_at), timestamp(lead.contacted_at), timestamp(lead.closed_at));
  const recent = metaLeadAt > 0 && age >= 0 && age < 24 * 60 * 60 * 1000 && handledAt < metaLeadAt;
  const [schedule, setSchedule] = useState(() => dateTimeInput(lead.next_contact_at));
  return <div className={`${styles.card} ${recent ? styles.recent : ""} ${fresh ? styles.fresh : ""}`}>
    {recent ? <div className={styles.newArrival} title={`Nuevo formulario recibido el ${formatDate(lead.latest_meta_lead_at)}. Destacado durante 24 horas o hasta su próxima gestión.`}><span className={styles.newFlag}><Sparkles aria-hidden="true" />NEW</span><span>Formulario reciente</span></div> : null}
    <div className={styles.cardTop}><div><h4>{fullName(lead)}</h4><a href={phone(lead) ? `tel:${phone(lead)}` : undefined}><Phone />{phone(lead) || "Sin teléfono"}</a>{lead.cliente?.email ? <span><Mail />{lead.cliente.email}</span> : null}</div><span className={`${styles.due} ${styles[due.key]}`}>{due.label}</span></div>
    <div className={styles.meta}><span className={styles.phase}>{phase === "nuevo" ? "Cliente nuevo" : phase === "pend_free" ? "Pendiente FREE" : phase === "pend_cap" ? "Pendiente captación" : phase === "cliente" ? "Cliente" : "Cerrado"}</span><span>{lead.origen || lead.cliente?.origen || "Origen sin registrar"}</span>{lead.campaign_name ? <span>{lead.campaign_name}</span> : null}</div>
    <dl><div><dt>Próxima gestión</dt><dd>{formatDate(lead.next_contact_at)}</dd></div><div><dt>Última gestión</dt><dd>{lead.last_contact_at ? relative(lead.last_contact_at).replace("Vencida", "Hace") : "Sin gestión"}</dd></div><div><dt>Intentos</dt><dd>{Math.max(1, Number(lead.intento_actual || 1))}/{Math.max(3, Number(lead.max_intentos || 3))}</dd></div>{lead.assigned_worker_name ? <div><dt>Central</dt><dd>{lead.assigned_worker_name}</dd></div> : null}</dl>
    <div className={styles.primaryActions}><a className={!phone(lead) ? styles.disabled : ""} href={phone(lead) ? `tel:${phone(lead)}` : undefined}><Phone />Llamar</a><button type="button" onClick={() => onOpen(lead)}><ExternalLink />Abrir CRM</button></div>
    <details className={styles.quick}><summary>Acciones rápidas <ChevronDown /></summary><div>
      {phase !== "cerrado" && phase !== "cliente" ? <><button disabled={busy} onClick={() => onAction(lead,"no_contesta")}>No responde</button><button disabled={busy} onClick={() => onAction(lead,"pendiente_free")}>Pend FREE</button><button disabled={busy} onClick={() => onAction(lead, phase === "pend_cap" ? "recontacto" : "hizo_free")}>{phase === "pend_cap" ? "Recontactar promo" : "FREE realizada"}</button><button disabled={busy} onClick={() => onAction(lead,"captado")}>Cliente</button><button disabled={busy} className={styles.danger} onClick={() => onAction(lead,"no_interesado")}>No interesa</button></> : <button disabled={busy} onClick={() => onAction(lead,"reabrir")}>Reabrir</button>}
      {onWhatsApp ? <button type="button" className={styles.whatsappAction} onClick={() => onWhatsApp(lead)} title="Revisar el mensaje y enviar con la imagen"><MessageCircle size={13} />Enviar WhatsApp</button> : null}
      <label><CalendarClock /><input type="datetime-local" value={schedule} onChange={(event) => setSchedule(event.target.value)} /><button disabled={busy || !schedule} onClick={() => onAction(lead,"programar",new Date(schedule).toISOString())}>Programar</button></label>
    </div></details>
  </div>;
}

function Empty() { return <div className={styles.empty}>Sin leads en esta fase</div>; }
