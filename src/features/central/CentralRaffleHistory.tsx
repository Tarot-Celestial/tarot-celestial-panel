"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, History, LoaderCircle, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./CentralRaffleHistory.module.css";

type ArchivedRaffle = {
  id: string; title: string; status: string; max_number: number;
  created_at?: string; updated_at?: string; closed_at?: string;
};
type ArchivedEntry = {
  id: string; raffle_number: number; assigned_at: string;
  client?: { nombre?: string; apellido?: string } | null;
};
type ArchivedPrize = {
  id: string; position: number; name: string; candidate_number: number | null;
  confirmed_at: string | null; selected_at: string | null; selection_method: string;
  is_test: boolean; simulation_only: boolean;
};
type ArchivedDetail = { raffle: ArchivedRaffle; entries: ArchivedEntry[]; prizes: ArchivedPrize[] };

function formatDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Fecha no disponible";
  return new Date(value).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });
}

async function readHistory(query: string, signal: AbortSignal) {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Vuelve a iniciar sesión para consultar el historial.");
  const response = await fetch(`/api/central/raffle?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "No se pudo consultar el historial.");
  return result;
}

export default function CentralRaffleHistory({ refreshKey }: { refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ArchivedRaffle[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ArchivedDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (offset = 0) => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await readHistory(`history=1&offset=${offset}`, controller.signal);
      if (controller.signal.aborted || listRequest.current !== controller) return;
      const rows: ArchivedRaffle[] = Array.isArray(result.history) ? result.history : [];
      setHistory((current) => offset ? [...current, ...rows.filter((row) => !current.some((existing) => existing.id === row.id))] : rows);
      setHasMore(Boolean(result.hasMore));
    } catch (problem) {
      if (listRequest.current === controller) setError(problem instanceof Error && problem.name !== "AbortError" ? problem.message : "La consulta ha tardado demasiado. Pulsa Actualizar historial para reintentar.");
    } finally {
      clearTimeout(timeout);
      if (listRequest.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    return () => {
      const controller = listRequest.current;
      listRequest.current = null;
      controller?.abort();
    };
  }, [open, refreshKey, load]);

  useEffect(() => () => {
    const controller = detailRequest.current;
    detailRequest.current = null;
    controller?.abort();
  }, []);

  async function showDetail(id: string) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setQuery("");
    setVisibleCount(40);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await readHistory(`raffle_id=${encodeURIComponent(id)}`, controller.signal);
      if (controller.signal.aborted || detailRequest.current !== controller) return;
      if (!result.readOnly || result.raffle?.id !== id || result.raffle?.status !== "closed") throw new Error("Este sorteo no está disponible como historial cerrado.");
      setDetail({ raffle: result.raffle, entries: Array.isArray(result.entries) ? result.entries : [], prizes: Array.isArray(result.prizes) ? result.prizes : [] });
    } catch (problem) {
      if (detailRequest.current === controller) setDetailError(problem instanceof Error && problem.name !== "AbortError" ? problem.message : "La consulta ha tardado demasiado. Vuelve a abrir este sorteo.");
    } finally {
      clearTimeout(timeout);
      if (detailRequest.current === controller) setDetailLoading(false);
    }
  }

  const entries = (detail?.entries || []).filter((entry) => `${entry.raffle_number} ${entry.client?.nombre || ""} ${entry.client?.apellido || ""}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")));

  return <section className={styles.root} aria-labelledby="raffle-history-title">
    <button type="button" className={styles.toggle} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="raffle-history-content">
      <History size={20} aria-hidden="true" /><span><strong id="raffle-history-title">Historial de sorteos</strong><small>Sorteos anteriores · Solo lectura</small></span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>
    {open ? <div id="raffle-history-content" className={styles.content}>
      <div className={styles.toolbar}><p>Consulta los números y los premios de los sorteos cerrados. Horarios de Madrid.</p><button type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /> Actualizar historial</button></div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading && !history.length ? <p className={styles.empty} role="status"><LoaderCircle size={16} /> Consultando sorteos anteriores…</p> : null}
      {!loading && !error && !history.length ? <p className={styles.empty}>Todavía no hay sorteos cerrados.</p> : null}
      <div className={styles.archiveList}>{history.map((raffle) => <button type="button" key={raffle.id} className={selectedId === raffle.id ? styles.selected : styles.archive} aria-pressed={selectedId === raffle.id} onClick={() => void showDetail(raffle.id)}>
        <strong>{raffle.title}</strong><span>Cerrado · {formatDate(raffle.closed_at || raffle.updated_at)}</span><small>Referencia {raffle.id.slice(0, 8)} · Ver números y premios</small>
      </button>)}</div>
      {hasMore ? <button type="button" className={styles.more} disabled={loading} onClick={() => void load(history.length)}>{loading ? "Cargando…" : "Ver más sorteos anteriores"}</button> : null}
      {detailLoading ? <p className={styles.empty} role="status">Consultando este sorteo…</p> : null}
      {detailError ? <p className={styles.error} role="alert">{detailError}</p> : null}
      {detail ? <article className={styles.detail} aria-labelledby="raffle-archive-title">
        <header><div><span className={styles.badge}>CERRADO · SOLO LECTURA</span><h3 id="raffle-archive-title">{detail.raffle.title}</h3><p>Desde {formatDate(detail.raffle.created_at)} · Cerrado {formatDate(detail.raffle.closed_at || detail.raffle.updated_at)}</p></div></header>
        <div className={styles.columns}>
          <section><h4>Números asignados <span>{detail.entries.length}</span></h4><label className={styles.search}>Buscar número o clienta<input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40); }} placeholder="Número o nombre" /></label>
            <ul className={styles.numbers}>{entries.slice(0, visibleCount).map((entry) => <li key={entry.id}><b>#{entry.raffle_number}</b><span>{[entry.client?.nombre, entry.client?.apellido].filter(Boolean).join(" ").trim() || "Clienta asignada"}<small>{formatDate(entry.assigned_at)}</small></span></li>)}</ul>
            {!entries.length ? <p className={styles.empty}>{query ? "No hay coincidencias." : "No se asignaron números en este sorteo."}</p> : null}
            {entries.length > visibleCount ? <button type="button" className={styles.more} onClick={() => setVisibleCount((value) => value + 40)}>Mostrar siguientes números ({Math.min(visibleCount, entries.length)} de {entries.length})</button> : null}
          </section>
          <section><h4>Premios y ganadores <span>{detail.prizes.length}</span></h4><div className={styles.prizes}>{detail.prizes.map((prize) => <article key={prize.id}>
            <span>Premio {prize.position}</span><strong>{prize.name}</strong><b>{prize.confirmed_at ? `Ganador confirmado: #${prize.candidate_number}` : prize.selected_at ? `Candidato pendiente: #${prize.candidate_number}` : "Sin ganador confirmado"}</b>
            {prize.selected_at ? <small>{prize.selection_method === "manual" ? "Selección manual" : "Selección aleatoria"}{prize.is_test ? " · PRUEBA" : ""}{prize.simulation_only ? " · Solo simulación" : ""}</small> : null}
            {prize.confirmed_at ? <small>{formatDate(prize.confirmed_at)}</small> : null}
          </article>)}</div>{!detail.prizes.length ? <p className={styles.empty}>No se configuraron premios en este sorteo.</p> : null}</section>
        </div>
      </article> : null}
    </div> : null}
  </section>;
}
