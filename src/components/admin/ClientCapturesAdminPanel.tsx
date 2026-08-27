"use client";

import { Activity, Building2, ChevronDown, ChevronLeft, ChevronRight, HeartHandshake, History, Plus, RefreshCw, Search, ShieldCheck, UserCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { ClientFidelityResult } from "@/lib/server/client-fidelity";
import styles from "./ClientCapturesAdminPanel.module.css";

type Worker = { id: string; display_name: string; team?: string | null };
type CaptureItem = any;
type FidelityDetail = { fidelity: ClientFidelityResult | null; state: string; business: string };

async function token() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || "";
}
function formatDate(value?: string | null) {
  if (!value) return "Sin datos";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(date) : "Sin datos";
}
function levelClass(level?: string) {
  return level === "very_high" ? styles.fidelityVeryHigh : level === "high" ? styles.fidelityHigh : level === "medium" ? styles.fidelityMedium : level === "low" ? styles.fidelityLow : styles.fidelityVeryLow;
}

export default function ClientCapturesAdminPanel() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [portfolio, setPortfolio] = useState("all");
  const [business, setBusiness] = useState<"celestial" | "orion">("celestial");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState({ corporate: 0, assigned: 0, xp: 0 });
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [fidelityByClient, setFidelityByClient] = useState<Record<string, FidelityDetail>>({});
  const [fidelityBusy, setFidelityBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setBusiness(getActiveBrand());
    const onBrandChanged = (event: Event) => {
      setBusiness((event as CustomEvent<{ brand?: string }>).detail?.brand === "orion" ? "orion" : "celestial");
      setPage(1); setExpandedClientId(null);
    };
    window.addEventListener("tc-brand-changed", onBrandChanged as EventListener);
    return () => window.removeEventListener("tc-brand-changed", onBrandChanged as EventListener);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ business, portfolio, page: String(page), page_size: "25" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      const response = await fetch(`/api/admin/client-captures?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudieron cargar las captaciones");
      setItems(payload.items || []); setWorkers(payload.workers || []); setTotal(Number(payload.total || 0));
      setTotalPages(Math.max(1, Number(payload.total_pages || 1))); setStats(payload.stats || { corporate: 0, assigned: 0, xp: 0 });
    } catch (loadError: any) {
      setError(loadError?.message || "Error de carga");
    } finally { if (!silent) setBusy(false); }
  }, [business, debouncedQuery, page, portfolio]);

  const loadFidelity = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setFidelityBusy(clientId);
    try {
      const response = await fetch(`/api/admin/client-captures?client_id=${encodeURIComponent(clientId)}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudo calcular la fidelización");
      setFidelityByClient((current) => ({ ...current, [clientId]: { fidelity: payload.fidelity || null, state: payload.state || "Sin clasificar", business: payload.business || business } }));
    } catch (fidelityError: any) {
      setError(fidelityError?.message || "No se pudo calcular la fidelización");
    } finally { setFidelityBusy((current) => current === clientId ? null : current); }
  }, [business]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const refreshList = () => { void load(true); };
    const refreshExpanded = (payload: any) => {
      const row = payload?.new || payload?.old || {};
      const clientId = String(row.cliente_id || row.client_id || row.id || "");
      if (clientId && clientId === expandedClientId) void loadFidelity(clientId);
    };
    const channel = sb.channel("admin-client-captures")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_capture_assignments" }, refreshList)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_capture_audit" }, refreshList)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_clientes" }, (payload) => { refreshList(); refreshExpanded(payload); })
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_pagos" }, refreshExpanded)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, refreshExpanded)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_interacciones" }, refreshExpanded)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_followups" }, refreshExpanded)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_rank_overrides" }, refreshExpanded)
      .subscribe();
    const fallback = window.setInterval(() => { void load(true); }, 60_000);
    return () => { window.clearInterval(fallback); void sb.removeChannel(channel); };
  }, [expandedClientId, load, loadFidelity]);

  async function reassign(item: CaptureItem, nextId: string) {
    const next = workers.find((worker) => worker.id === nextId);
    const before = item.responsible?.display_name || "Celestial", after = next?.display_name || "Celestial";
    if (String(item.responsible_worker_id || "") === String(nextId || "")) return;
    if (!window.confirm(`Mover clienta:\n${before} → ${after}\n\nEste cambio no concede XP ni reinicia la fidelización.`)) return;
    const reason = window.prompt("Motivo opcional de la reasignación:") || "";
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/client-captures", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ client_id: item.client_id, responsible_worker_id: nextId || null, reason }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudo reasignar");
      setNotice(`✓ Asignada a ${after} · Sincronizada`); await load();
    } catch (reassignError: any) { setError(reassignError?.message || "Error de reasignación"); }
    finally { setBusy(false); }
  }

  function toggleDetails(clientId: string, open: boolean) {
    setExpandedClientId(open ? clientId : null);
    if (open && !fidelityByClient[clientId]) void loadFidelity(clientId);
  }

  return <section className={styles.panel}>
    <header><div><span className={styles.kicker}>CENTRO DE ATRIBUCIÓN DE CARTERAS</span><h1><UserCheck /> Sistema de clientas captadas</h1><p>Captadora histórica, responsable actual e índice real permanecen sincronizados.</p></div><button onClick={() => void load()} disabled={busy}><RefreshCw className={busy ? styles.spin : ""} />Actualizar</button></header>
    <div className={styles.stats}><article><b>{stats.corporate}</b><span>Cartera Celestial</span></article><article><b>{stats.assigned}</b><span>Asignadas</span></article><article><b>{stats.xp}</b><span>Con XP real</span></article></div>
    <div className={styles.filters}>
      <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, teléfono o email" /></label>
      <select value={portfolio} onChange={(event) => { setPortfolio(event.target.value); setPage(1); setExpandedClientId(null); }} aria-label="Filtrar por cartera actual">
        <option value="all">Todas las carteras</option><option value="corporate">Celestial · Cartera corporativa</option>
        {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name}{worker.team ? ` · ${worker.team}` : ""}</option>)}
      </select>
    </div>
    <a className={styles.addWorker} href="/admin?tab=trabajadores"><Plus /> Añadir responsable desde Trabajadores</a>
    {notice && <div className={styles.empty}>{notice}</div>}{error && <div className={styles.error}>{error}</div>}
    <div className={styles.list}>{items.map((item) => {
      const clientId = String(item.client_id); const detail = fidelityByClient[clientId]; const fidelity = detail?.fidelity;
      return <article key={clientId} className={styles.card}>
        <div className={styles.identity}><strong>{[item.client?.nombre, item.client?.apellido].filter(Boolean).join(" ") || "Clienta"}</strong><span>{item.client?.telefono || item.client?.telefono_normalizado || "Sin teléfono"}</span><small>{item.business || item.client?.origen || "celestial"}</small></div>
        <div><span>Captada por · histórico</span><strong>{item.captured_by?.display_name || "Sin captadora confirmada"}</strong><small>{item.captured_at ? new Date(item.captured_at).toLocaleString("es-ES") : "Pendiente de captación real"}</small></div>
        <div className={!item.responsible_worker_id ? styles.corporate : ""}><span>Responsable central</span><select value={item.responsible_worker_id || ""} onChange={(event) => void reassign(item, event.target.value)} disabled={busy}><option value="">✦ Celestial · Cartera corporativa</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name} · {worker.team || "Sin equipo"}</option>)}</select><small>{!item.responsible_worker_id && <Building2 />}{item.responsible_worker_id ? `${item.responsible?.team || "Central"} · Activa` : "Fuera de carteras individuales"}</small><small>{item.xp_event?.status === "applied" ? `+${item.xp_event.xp_amount} XP real` : "Sin evento XP aplicado"}</small></div>
        <details className={styles.clientDetails} open={expandedClientId === clientId} onToggle={(event) => toggleDetails(clientId, event.currentTarget.open)}>
          <summary><span><HeartHandshake /> Ver detalles e índice de fidelización</span><ChevronDown /></summary>
          <div className={styles.detailsBody}>
            {fidelityBusy === clientId && <div className={styles.fidelityLoading}><RefreshCw className={styles.spin} /> Calculando con actividad real…</div>}
            {fidelity && <>
              <section className={`${styles.fidelityHero} ${levelClass(fidelity.level)}`}>
                <div><span>ÍNDICE DE FIDELIZACIÓN</span><strong>{fidelity.score}<small>%</small></strong><em>{fidelity.maturityLabel} · {fidelity.label}</em></div>
                <div className={styles.fidelityGauge}><i style={{ width: `${fidelity.score}%` }} /></div><p>{fidelity.description}</p>{fidelity.needsAttention && <b className={styles.attentionBadge}>Necesita atención</b>}
              </section>
              <section className={styles.detailFacts}>
                <div><span>Última compra</span><strong>{formatDate(fidelity.lastPurchaseAt)}</strong></div><div><span>Recompras</span><strong>{fidelity.repurchaseCount}</strong></div><div><span>Último seguimiento</span><strong>{formatDate(fidelity.lastFollowUpAt)}</strong></div><div><span>Rango</span><strong>{fidelity.rank ? fidelity.rank.toUpperCase() : "Sin rango"}</strong></div><div><span>Estado</span><strong>{detail.state}</strong></div>
              </section>
              <section className={styles.breakdown}><h3><Activity /> Desglose real</h3><div><span>Recompra / recurrencia</span><b>{fidelity.breakdown.recurrence}/{fidelity.maximums.recurrence}</b></div><div><span>Recencia de compra</span><b>{fidelity.breakdown.recency}/{fidelity.maximums.recency}</b></div><div><span>Frecuencia de actividad</span><b>{fidelity.breakdown.activity}/{fidelity.maximums.activity}</b></div><div><span>Seguimiento válido</span><b>{fidelity.breakdown.followUp}/{fidelity.maximums.followUp}</b></div><div><span>Rango y continuidad</span><b>{fidelity.breakdown.continuity}/{fidelity.maximums.continuity}</b></div></section>
              <section className={styles.reasons}><h3>¿Por qué tiene este índice?</h3>{fidelity.reasons.map((reason) => <p key={reason}>{reason}</p>)}</section>
            </>}
            <section className={styles.history}><h3><History /> Historial de responsables ({item.audit?.length || 0})</h3>{(item.audit || []).length ? (item.audit || []).map((entry: any) => <p key={entry.id}><ShieldCheck />{entry.previous_name} → {entry.new_name}<span>{entry.reason || entry.action}</span><time>{new Date(entry.created_at).toLocaleString("es-ES")}</time></p>) : <small>No hay cambios de responsable registrados.</small>}</section>
          </div>
        </details>
      </article>;
    })}</div>
    {!busy && !items.length && <div className={styles.empty}>No hay clientas para estos filtros.</div>}
    <footer className={styles.pagination}><span>Mostrando {items.length ? (page - 1) * 25 + 1 : 0}-{Math.min(page * 25, total)} de {total}</span><div><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft />Anterior</button><b>Página {page} de {totalPages}</b><button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Siguiente<ChevronRight /></button></div></footer>
  </section>;
}
