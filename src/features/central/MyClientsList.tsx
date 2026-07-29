"use client";

import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./MyClientsList.module.css";

type ClientRow = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SortKey = "recent" | "oldest" | "name";

type MyClientsListProps = {
  onOpenClient: (clientId: string) => void;
  onNewClient: () => void;
};

const PAGE_SIZE = 10;

function fullName(client: ClientRow) {
  const name = [client.nombre, client.apellido].filter(Boolean).join(" ").trim();
  return name || "Clienta sin nombre";
}

function initialFor(client: ClientRow) {
  return fullName(client).charAt(0).toLocaleUpperCase("es-ES") || "C";
}

async function getAccessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}

export default function MyClientsList({ onOpenClient, onNewClient }: MyClientsListProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function loadClients() {
      setLoading(true);
      setError("");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("No se pudo validar la sesión.");

        const params = new URLSearchParams({ marca: "celestial" });
        if (debouncedQuery) params.set("q", debouncedQuery);

        const response = await fetch(`/api/crm/clientes/buscar?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "No se pudieron cargar las clientas.");
        }

        if (!cancelled) {
          setRows(Array.isArray(payload.clientes) ? payload.clientes : []);
          setPage(1);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setRows([]);
          setError(loadError?.message || "No se pudieron cargar las clientas.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadClients();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sort === "name") return fullName(a).localeCompare(fullName(b), "es", { sensitivity: "base" });
      const aDate = new Date(a.created_at || a.updated_at || 0).getTime();
      const bDate = new Date(b.created_at || b.updated_at || 0).getTime();
      return sort === "oldest" ? aDate - bDate : bDate - aDate;
    });
  }, [rows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const visibleRows = sortedRows.slice(startIndex, startIndex + PAGE_SIZE);
  const rangeStart = sortedRows.length ? startIndex + 1 : 0;
  const rangeEnd = Math.min(startIndex + PAGE_SIZE, sortedRows.length);

  return (
    <section className={styles.panel} aria-labelledby="my-clients-list-title">
      <div className={styles.headingRow}>
        <div>
          <div className={styles.kicker}>CARTERA CELESTIAL</div>
          <h2 id="my-clients-list-title" className={styles.title}>Mis clientas</h2>
        </div>
        <button type="button" className={styles.newButton} onClick={onNewClient}>
          <UserPlus size={18} aria-hidden="true" />
          Nueva clienta
        </button>
      </div>

      <div className={styles.controls}>
        <label className={styles.searchBox}>
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar clientas"
          />
        </label>

        <label className={styles.selectWrap}>
          <SlidersHorizontal size={17} aria-hidden="true" />
          <select aria-label="Filtrar por estado" defaultValue="all">
            <option value="all">Todos los estados</option>
            <option value="unclassified">Sin clasificar</option>
          </select>
        </label>

        <label className={styles.selectWrap}>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar clientas">
            <option value="recent">Más recientes</option>
            <option value="oldest">Más antiguas</option>
            <option value="name">Nombre</option>
          </select>
        </label>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.tableHeader} role="row">
          <span>CLIENTA</span>
          <span>TELEFONISTA RESPONSABLE</span>
          <span>ÚLTIMA CONVERSACIÓN</span>
          <span>ESTADO</span>
          <span aria-hidden="true" />
        </div>

        <div className={styles.tableBody}>
          {loading && (
            <div className={styles.emptyState}>Cargando clientas…</div>
          )}

          {!loading && error && (
            <div className={styles.emptyState}>{error}</div>
          )}

          {!loading && !error && visibleRows.length === 0 && (
            <div className={styles.emptyState}>
              <UsersRound size={28} aria-hidden="true" />
              No se encontraron clientas.
            </div>
          )}

          {!loading && !error && visibleRows.map((client) => (
            <button
              type="button"
              className={styles.clientRow}
              key={client.id}
              onClick={() => onOpenClient(client.id)}
              aria-label={`Abrir ficha de ${fullName(client)}`}
            >
              <span className={styles.clientCell}>
                <span className={styles.avatar} aria-hidden="true">{initialFor(client)}</span>
                <span className={styles.clientCopy}>
                  <strong>{fullName(client)}</strong>
                  <small>{client.telefono || "Sin teléfono"}</small>
                </span>
              </span>
              <span className={styles.ownerBadge}>Celestial</span>
              <span className={styles.neutralText}>Sin datos</span>
              <span className={styles.statusBadge}>Sin clasificar</span>
              <span className={styles.openIcon}><ChevronRight size={20} aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.pagination}>
        <span>Mostrando {rangeStart}-{rangeEnd} de {sortedRows.length} clientas</span>
        <div className={styles.pageControls}>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
            aria-label="Página anterior"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span>Página {safePage} de {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={safePage >= totalPages}
            aria-label="Página siguiente"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
