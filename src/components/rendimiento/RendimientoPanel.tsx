"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Banknote, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, CreditCard, Filter, Landmark, MoreHorizontal, RefreshCw, RotateCcw, ScanLine, Search, ShieldCheck, Sparkles, Target, Users, WalletCards, XCircle, type LucideIcon } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./RendimientoPanel.module.css";
import rowStyles from "./RendimientoRows.module.css";

const sb = supabaseBrowser();
type Props = { mode?: "admin" | "central" };
type Row = { id?: string; fecha_hora?: string | null; fecha?: string | null; cliente_nombre?: string | null; telefonista_nombre?: string | null; tarotista_nombre?: string | null; tarotista_manual_call?: string | null; llamada_call?: boolean | null; tiempo?: number | null; resumen_codigo?: string | null; codigo_1?: string | null; codigo_2?: string | null; forma_pago?: string | null; importe?: number | null; promo?: boolean | null; captado?: boolean | null };
type Filters = { tarotista: string; telefonista: string; codigo: string; cliente: string; metodo: string; from: string; to: string; captado: string; promo: string; call: string; importe: string };
const EMPTY_FILTERS: Filters = { tarotista: "", telefonista: "", codigo: "", cliente: "", metodo: "", from: "", to: "", captado: "", promo: "", call: "", importe: "all" };

function fmt(value: unknown) { const date = new Date(String(value || "")); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-ES"); }
function eur(value: unknown) { return (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
function number(value: unknown, digits = 0) { return (Number(value) || 0).toLocaleString("es-ES", { maximumFractionDigits: digits }); }
function codeLabel(row: Row) { return row.resumen_codigo || [row.codigo_1, row.codigo_2].filter(Boolean).join(" · ") || "Sin código"; }

type PaymentTone = "bizum" | "paypal" | "square" | "stripe" | "neutral" | "none";
type PaymentVisual = { tone: PaymentTone; label: string; Icon: LucideIcon; paid: boolean };

function normalizePayment(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("es-ES").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function paymentVisual(value: unknown, amount: unknown): PaymentVisual {
  const method = normalizePayment(value);
  const paid = Number(amount) > 0 && Boolean(method);
  if (!method) return { tone: "none", label: "—", Icon: Banknote, paid: false };
  if (method.includes("bizum")) return { tone: paid ? "bizum" : "none", label: "Bizum", Icon: Landmark, paid };
  if (method.includes("paypal")) return { tone: paid ? "paypal" : "none", label: "PayPal", Icon: WalletCards, paid };
  if (method.includes("square")) return { tone: paid ? "square" : "none", label: "Square", Icon: ScanLine, paid };
  if (method.includes("stripe")) return { tone: paid ? "stripe" : "none", label: "Stripe", Icon: CreditCard, paid };
  const label = method === "tpv" ? "TPV" : method === "efectivo" ? "Efectivo" : method.includes("transfer") ? "Transferencia" : method === "otros" ? "Otros" : String(value || "Otro método").trim();
  return { tone: paid ? "neutral" : "none", label, Icon: Banknote, paid };
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const isAdmin = mode === "admin";
  const [activeBrand, setActiveBrand] = useState<"celestial" | "orion">("celestial");
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<any>({ records: 0, minutes: 0, amount: 0, captured: 0 });
  const [methods, setMethods] = useState<Array<{ value: string; label: string }>>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [liveState, setLiveState] = useState<"connecting" | "synced" | "updating" | "error">("connecting");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const newRowTimer = useRef<number | null>(null);
  const pendingNewRowId = useRef<string | null>(null);
  const requestId = useRef(0);
  const [newRowId, setNewRowId] = useState<string | null>(null);

  async function getToken() { const { data } = await sb.auth.getSession(); return data.session?.access_token || ""; }
  const load = useCallback(async (silent = false) => {
    const currentRequest = ++requestId.current;
    if (!silent) setLoading(true);
    setLiveState(silent ? "updating" : "connecting");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sesión no disponible");
      const params = new URLSearchParams({ mode, brand: activeBrand, page: String(page), page_size: "50" });
      Object.entries(applied).forEach(([key, value]) => { if (value && value !== "all") params.set(key, value); });
      const response = await fetch(`/api/crm/rendimiento/listar?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo actualizar Rendimiento");
      if (currentRequest !== requestId.current) return;
      const nextRows: Row[] = json.data || [];
      setRows(nextRows); setTotals(json.totals || {}); setMethods(json.payment_methods || []);
      const insertedId = pendingNewRowId.current;
      if (insertedId && nextRows.some((row) => String(row.id || "") === insertedId)) {
        pendingNewRowId.current = null;
        setNewRowId(insertedId);
        if (newRowTimer.current !== null) window.clearTimeout(newRowTimer.current);
        newRowTimer.current = window.setTimeout(() => setNewRowId(null), 800);
      }
      setPages(Number(json.pagination?.pages || 1)); setTotalRows(Number(json.pagination?.total || 0));
      setLiveState("synced"); setMessage("");
    } catch (error: any) {
      if (currentRequest !== requestId.current) return;
      setLiveState("error"); setMessage(error?.message || "No se pudo actualizar Rendimiento");
    } finally { if (currentRequest === requestId.current) setLoading(false); }
  }, [activeBrand, applied, mode, page]);

  useEffect(() => {
    setActiveBrand(getActiveBrand());
    const onBrand = (event: any) => { setActiveBrand(String(event?.detail?.brand) === "orion" ? "orion" : "celestial"); setPage(1); };
    window.addEventListener("tc-brand-changed", onBrand as EventListener);
    return () => window.removeEventListener("tc-brand-changed", onBrand as EventListener);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setApplied((current) => current.cliente === filters.cliente ? current : { ...current, cliente: filters.cliente });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [filters.cliente]);
  useEffect(() => {
    const channel = sb.channel(`rendimiento-control-${mode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, (payload) => {
        if (payload.eventType === "INSERT") pendingNewRowId.current = String((payload.new as { id?: unknown })?.id || "") || null;
        setLiveState("updating");
        if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void load(true), 650);
      }).subscribe((status) => { if (status === "SUBSCRIBED") setLiveState("synced"); if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLiveState("error"); });
    return () => { if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current); if (newRowTimer.current !== null) window.clearTimeout(newRowTimer.current); void sb.removeChannel(channel); };
  }, [load, mode]);

  function applyFilters() { setPage(1); setApplied({ ...filters }); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setPage(1); }
  function updateField(id: string, field: keyof Row, value: unknown) { setRows((current) => current.map((row) => String(row.id) === id ? { ...row, [field]: value } : row)); }
  async function saveRow(id: string) {
    const row = rows.find((item) => String(item.id) === id); if (!row) return;
    const token = await getToken(); setSavingId(id);
    try {
      const response = await fetch("/api/crm/rendimiento/update", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id, updates: row }) });
      const json = await response.json().catch(() => null); if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo guardar");
      setEditingId(null); await load(true);
    } catch (error: any) { setMessage(error?.message || "No se pudo guardar"); await load(true); } finally { setSavingId(null); }
  }
  async function deleteRow(id: string) {
    if (!window.confirm("¿Anular este registro y su operación vinculada? Esta acción requiere confirmación.")) return;
    const token = await getToken(); setSavingId(id);
    try {
      const response = await fetch("/api/crm/rendimiento/delete", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const json = await response.json().catch(() => null); if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo anular");
      await load(true);
    } catch (error: any) { setMessage(error?.message || "No se pudo anular"); } finally { setSavingId(null); }
  }

  const selectedMethod = methods.find((method) => method.value === applied.metodo)?.label;
  const LiveIcon = liveState === "error" ? XCircle : liveState === "synced" ? CheckCircle2 : RefreshCw;
  return (
    <section className={styles.controlCenter}>
      <header className={styles.hero}>
        <div><span className={styles.kicker}><Activity size={13} /> Centro de control de producción</span><h2>Rendimiento</h2><p>{isAdmin ? "Visión operativa y económica con datos reales." : "Actividad global de todas las centrales, sincronizada en tiempo real."}</p></div>
        <div className={styles.heroActions}><span className={`${styles.live} ${styles[liveState]}`}><LiveIcon size={14} className={liveState === "updating" || liveState === "connecting" ? styles.spin : ""} /> {liveState === "synced" ? "Sincronizado" : liveState === "error" ? "Error de sincronización" : "Actualizando"}</span><button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""} /> Actualizar</button></div>
      </header>

      {message ? <div className={styles.errorBanner}><span>{message}</span><button onClick={() => void load()}>Reintentar</button></div> : null}
      <div className={`${styles.kpis} ${!isAdmin ? styles.centralKpis : ""}`}>
        <article><Users /><span>Registros</span><strong>{number(totals.records)}</strong><small>Resultados del filtro</small></article>
        {isAdmin ? <article><Clock3 /><span>Tiempo total</span><strong>{number(totals.minutes, 2)} min</strong><small>Producción filtrada</small></article> : null}
        {isAdmin ? <article className={selectedMethod ? styles.contextKpi : ""}><CircleDollarSign /><span>{selectedMethod ? `Ingresos ${selectedMethod}` : "Importe total"}</span><strong>{eur(totals.amount)}</strong><small>{selectedMethod ? `${number(totals.records)} operaciones filtradas` : "Importe real registrado"}</small></article> : null}
        <article><Target /><span>Captados</span><strong>{number(totals.captured)}</strong><small>Captaciones reales filtradas</small></article>
      </div>

      <section className={styles.filters}>
        <div className={styles.filterTop}><div><Filter size={17} /><strong>Filtros profesionales</strong><span>{totalRows.toLocaleString("es-ES")} resultados</span></div><div><button type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Menos filtros" : "Más filtros"}</button><button type="button" onClick={clearFilters}><RotateCcw size={14} /> Limpiar</button><button type="button" className={styles.apply} onClick={applyFilters}><Search size={14} /> Aplicar</button></div></div>
        <div className={styles.filterGrid}>
          <label><span>Cliente</span><input value={filters.cliente} onChange={(e) => setFilters({ ...filters, cliente: e.target.value })} placeholder="Buscar cliente" /></label>
          <label><span>Tarotista</span><input value={filters.tarotista} onChange={(e) => setFilters({ ...filters, tarotista: e.target.value })} placeholder="Nombre" /></label>
          <label><span>Telefonista</span><input value={filters.telefonista} onChange={(e) => setFilters({ ...filters, telefonista: e.target.value })} placeholder="María, Yami, Michael..." /></label>
          <label><span>Método de pago</span><select value={filters.metodo} onChange={(e) => setFilters({ ...filters, metodo: e.target.value })}><option value="">Todos los métodos</option>{methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
          <label><span>Desde</span><input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
          <label><span>Hasta</span><input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        </div>
        {advanced ? <div className={styles.advancedGrid}>
          <label><span>Código</span><input value={filters.codigo} onChange={(e) => setFilters({ ...filters, codigo: e.target.value })} placeholder="Free, rueda, cliente..." /></label>
          <label><span>Captado</span><select value={filters.captado} onChange={(e) => setFilters({ ...filters, captado: e.target.value })}><option value="">Todos</option><option value="true">Sí</option><option value="false">No</option></select></label>
          <label><span>Promo</span><select value={filters.promo} onChange={(e) => setFilters({ ...filters, promo: e.target.value })}><option value="">Todos</option><option value="true">Sí</option><option value="false">No</option></select></label>
          <label><span>Llamada CALL</span><select value={filters.call} onChange={(e) => setFilters({ ...filters, call: e.target.value })}><option value="">Todas</option><option value="true">Sí</option><option value="false">No</option></select></label>
          <label><span>Importe</span><select value={filters.importe} onChange={(e) => setFilters({ ...filters, importe: e.target.value })}><option value="all">Todos</option><option value="positive">Con importe</option><option value="zero">Sin importe</option></select></label>
        </div> : null}
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableHeading}><div><Sparkles size={17} /><strong>Actividad registrada</strong><span>Página {page} de {pages}</span></div><span><ShieldCheck size={14} /> {isAdmin ? "Ámbito administrativo" : "Registro global de centrales"}</span></div>
        <div className={styles.tableScroll}>
          <table><thead><tr><th>Fecha</th><th>Telefonista</th><th>Cliente</th><th>Tarotista</th><th>Tiempo</th><th>CALL</th><th>Código</th><th>Método</th><th>Importe</th><th>Promo</th><th>Captado</th><th aria-label="Acciones" /></tr></thead>
          <tbody>{loading ? Array.from({ length: 7 }).map((_, index) => <tr key={index} className={styles.skeleton}><td colSpan={12}><span /></td></tr>) : rows.map((row) => {
            const id = String(row.id || ""); const editing = editingId === id;
            const payment = paymentVisual(row.forma_pago, row.importe); const PaymentIcon = payment.Icon;
            const rowClass = [rowStyles.row, payment.paid ? rowStyles[payment.tone] : "", row.captado ? rowStyles.isCaptured : "", editing ? rowStyles.isEditing : "", newRowId === id ? rowStyles.isNew : ""].filter(Boolean).join(" ");
            return <tr key={id || `${row.fecha_hora}-${row.cliente_nombre}`} className={rowClass} data-payment={payment.tone}><td>{fmt(row.fecha_hora || row.fecha)}</td><td>{row.telefonista_nombre || "—"}</td><td>{editing ? <input value={row.cliente_nombre || ""} onChange={(e) => updateField(id, "cliente_nombre", e.target.value)} /> : <strong>{row.cliente_nombre || "—"}</strong>}</td><td>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</td><td className={styles.numeric}>{editing ? <input type="number" value={row.tiempo || 0} onChange={(e) => updateField(id, "tiempo", Number(e.target.value))} /> : `${number(row.tiempo, 2)} min`}</td><td><span className={`${styles.badge} ${row.llamada_call ? styles.call : styles.muted}`}>{row.llamada_call ? "CALL" : "No"}</span></td><td>{editing ? <input value={row.resumen_codigo || ""} onChange={(e) => updateField(id, "resumen_codigo", e.target.value)} /> : <span className={`${styles.badge} ${styles.code}`}>{codeLabel(row)}</span>}</td><td><span className={`${styles.badge} ${styles.payment} ${payment.paid ? `${rowStyles.paymentBadge} ${rowStyles[payment.tone]}` : ""}`}><PaymentIcon size={12} aria-hidden="true" /> {payment.label}</span></td><td className={`${styles.numeric} ${payment.paid ? rowStyles.paidAmount : ""}`}>{editing ? <input type="number" value={row.importe ?? ""} onChange={(e) => updateField(id, "importe", Number(e.target.value))} /> : eur(row.importe)}</td><td><span className={`${styles.badge} ${row.promo ? styles.promo : styles.muted}`}>{row.promo ? "Promo" : "No"}</span></td><td><span className={`${styles.badge} ${row.captado ? styles.captured : styles.muted} ${row.captado ? rowStyles.capturedBadge : ""}`}>{row.captado ? <><Check size={12} aria-hidden="true" /> Captado</> : "No"}</span></td><td>{editing ? <div className={styles.rowActions}><button onClick={() => void saveRow(id)} disabled={savingId === id}>Guardar</button><button onClick={() => { setEditingId(null); void load(true); }}>Cancelar</button></div> : <details className={styles.menu}><summary aria-label="Acciones del registro"><MoreHorizontal size={17} /></summary><div><button onClick={() => setEditingId(id)}>Editar</button><button className={styles.danger} onClick={() => void deleteRow(id)}>Eliminar</button></div></details>}</td></tr>;
          })}{!loading && !rows.length ? <tr><td colSpan={12}><div className={styles.empty}><Filter size={26} /><strong>No hay registros para estos filtros.</strong><span>Prueba a ampliar el periodo o limpiar algún filtro.</span></div></td></tr> : null}</tbody></table>
        </div>
        <footer className={styles.pagination}><span>Mostrando {rows.length} de {totalRows.toLocaleString("es-ES")}</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> Anterior</button><button disabled={page >= pages || loading} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Siguiente <ChevronRight size={15} /></button></div></footer>
      </section>
    </section>
  );
}
