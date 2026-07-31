"use client";

import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./MyClientsList.module.css";

type ClientTag = { id: string; nombre: string; color?: string | null };
type ClientRow = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  etiquetas?: ClientTag[];
  estado_actual?: string | null;
  telefonista_responsable?: string | null;
  ultima_conversacion?: { created_at?: string | null; cerrado_at?: string | null; origen?: string | null } | null;
};

type SortKey = "recent" | "oldest" | "name";
type MyClientsListProps = { onOpenClient: (clientId: string) => void; onNewClient: () => void };
const PAGE_SIZE = 10;

function fullName(client: ClientRow) {
  return [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Clienta sin nombre";
}
function initialFor(client: ClientRow) { return fullName(client).charAt(0).toLocaleUpperCase("es-ES") || "C"; }
async function getAccessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}
function formatLastConversation(value?: string | null) {
  if (!value) return "Sin datos";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Sin datos";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export default function MyClientsList({ onOpenClient, onNewClient }: MyClientsListProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [brand, setBrand] = useState<"celestial" | "orion">("celestial");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setBrand(getActiveBrand());
    const onBrandChanged = (event: Event) => {
      const next = (event as CustomEvent<{ brand?: string }>).detail?.brand === "orion" ? "orion" : "celestial";
      setBrand(next);
      setPage(1);
    };
    window.addEventListener("tc-brand-changed", onBrandChanged as EventListener);
    return () => window.removeEventListener("tc-brand-changed", onBrandChanged as EventListener);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const requestRefresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const client = supabaseBrowser();
    const channel = client
      .channel("my-clients-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_clientes" }, requestRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_etiquetas" }, requestRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_interacciones" }, requestRefresh)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [requestRefresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadClients() {
      setLoading(true); setError("");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("No se pudo validar la sesión.");
        const params = new URLSearchParams({ marca: brand, page: String(page), page_size: String(PAGE_SIZE), sort });
        if (debouncedQuery) params.set("q", debouncedQuery);
        const response = await fetch(`/api/central/my-clients?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudieron cargar las clientas.");
        if (!cancelled) { setRows(Array.isArray(payload.clientes) ? payload.clientes : []); setTotal(Number(payload.total || 0)); }
      } catch (loadError: any) {
        if (!cancelled) { setRows([]); setTotal(0); setError(loadError?.message || "No se pudieron cargar las clientas."); }
      } finally { if (!cancelled) setLoading(false); }
    }
    void loadClients();
    return () => { cancelled = true; };
  }, [brand, debouncedQuery, page, sort, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const rangeStart = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const knownStatuses = useMemo(() => Array.from(new Set(rows.map((row) => String(row.estado_actual || "").trim()).filter(Boolean))), [rows]);

  return (
    <section className={styles.panel} aria-labelledby="my-clients-list-title">
      <div className={styles.headingRow}><div><div className={styles.kicker}>CARTERA {brand.toUpperCase()}</div><h2 id="my-clients-list-title" className={styles.title}>Mis clientas</h2></div><button type="button" className={styles.newButton} onClick={onNewClient}><UserPlus size={18} aria-hidden="true" />Nueva clienta</button></div>
      <div className={styles.controls}>
        <label className={styles.searchBox}><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o teléfono" aria-label="Buscar clientas" /></label>
        <label className={styles.selectWrap}><SlidersHorizontal size={17} aria-hidden="true" /><select aria-label="Filtrar por estado" defaultValue="all"><option value="all">Todos los estados</option>{knownStatuses.map((status) => <option key={status} value={status}>{status}</option>)}<option value="unclassified">Sin clasificar</option></select></label>
        <label className={styles.selectWrap}><select value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setPage(1); }} aria-label="Ordenar clientas"><option value="recent">Más recientes</option><option value="oldest">Más antiguas</option><option value="name">Nombre</option></select></label>
      </div>
      <div className={styles.tableWrap}>
        <div className={styles.tableHeader} role="row"><span>CLIENTA</span><span>TELEFONISTA RESPONSABLE</span><span>ÚLTIMA CONVERSACIÓN</span><span>ESTADO</span><span aria-hidden="true" /></div>
        <div className={styles.tableBody}>
          {loading && <div className={styles.emptyState}>Cargando clientas…</div>}
          {!loading && error && <div className={styles.emptyState}>{error}</div>}
          {!loading && !error && rows.length === 0 && <div className={styles.emptyState}><UsersRound size={28} aria-hidden="true" />No se encontraron clientas.</div>}
          {!loading && !error && rows.map((client) => (
            <button type="button" className={styles.clientRow} key={client.id} onClick={() => onOpenClient(client.id)} aria-label={`Abrir ficha de ${fullName(client)}`}>
              <span className={styles.clientCell}><span className={styles.avatar} aria-hidden="true">{initialFor(client)}</span><span className={styles.clientCopy}><strong>{fullName(client)}</strong><small>{client.telefono || "Sin teléfono"}</small>{Boolean(client.etiquetas?.length) && <span className={styles.tags}>{client.etiquetas!.slice(0, 3).map((tag) => <span key={tag.id} className={styles.tag}>{tag.nombre}</span>)}{client.etiquetas!.length > 3 && <span className={styles.tag}>+{client.etiquetas!.length - 3}</span>}</span>}</span></span>
              <span className={styles.ownerBadge}>{client.telefonista_responsable || "Celestial"}</span>
              <span className={styles.neutralText}>{formatLastConversation(client.ultima_conversacion?.created_at || client.ultima_conversacion?.cerrado_at)}</span>
              <span className={styles.statusBadge}>{client.estado_actual || "Sin clasificar"}</span>
              <span className={styles.openIcon}><ChevronRight size={20} aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.pagination}><span>Mostrando {rangeStart}-{rangeEnd} de {total} clientas</span><div className={styles.pageControls}><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft size={18} aria-hidden="true" /></button><span>Página {page} de {totalPages}</span><button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages} aria-label="Página siguiente"><ChevronRight size={18} aria-hidden="true" /></button></div></div>
    </section>
  );
}
