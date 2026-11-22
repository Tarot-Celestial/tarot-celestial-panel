"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Search, UserRound, X } from "lucide-react";
import { officeRequest } from "./office-client";
import OfficeClientDetail from "./OfficeClientDetail";
import OfficeCaptureTotals from "./OfficeCaptureTotals";
import OfficeClientLink, { type ClientArea, type OpenClientArea } from "./OfficeClientLink";
import type { OfficeClientList } from "./office-clients";
import s from "./OfficeClients.module.css";

type Stage = "all" | "captured" | "pending";
const stages = [{ id: "all", label: "Todos" }, { id: "captured", label: "Captados" }, { id: "pending", label: "Pendientes" }] as const;
const firstPage = [null] as (string | null)[];

export default function OfficeClients({ area, selectedId, open }: { area: ClientArea; selectedId: string | null; open: OpenClientArea }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("all");
  const [pages, setPages] = useState(firstPage);
  const [result, setResult] = useState<{ path: string; data?: OfficeClientList; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const detail = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusDetail = useRef(false);
  const cursor = pages[pages.length - 1];
  const params = new URLSearchParams({ limit: "25", stage });
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const path = "/api/admin/office/clients?" + params;
  const visible = result?.path === path ? result : null;
  const rows = visible?.data?.items;
  const nextCursor = visible?.data?.next_cursor;

  useEffect(() => {
    const abort = new AbortController();
    officeRequest<OfficeClientList>(path, { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setResult({ path, data });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setResult({ path, error: error instanceof Error ? error.message : "No se pudo cargar el directorio." });
    });
    return () => abort.abort();
  }, [path, retry]);

  useEffect(() => {
    if (!focusDetail.current) return;
    focusDetail.current = false;
    if (!selectedId) { searchInput.current?.focus(); return; }
    detail.current?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 760px)").matches) detail.current?.scrollIntoView({ block: "start" });
  }, [selectedId, area]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPages(firstPage); setQuery(input.trim());
  }
  function changeStage(value: Stage) {
    setPages(firstPage); setStage(value);
  }
  function openRow(destination: ClientArea, id?: string | null) {
    focusDetail.current = true;
    open(destination, id);
  }
  return <section className={s.panel} aria-label={area === "clientes" ? "Departamento de Clientes" : "Departamento de Captación y reservas"}>
    <header className={s.panelHeading}>
      <div><h2>{area === "clientes" ? "Clientes" : "Captación y reservas"}</h2>
        <p>{area === "clientes" ? "Directorio de fichas del CRM." : "La primera compra confirmada marca la captación del cliente en todo el CRM."}</p></div>
    </header>
    {area === "captacion-reservas" && <OfficeCaptureTotals/>}
    <div className={s.columns} data-selected={Boolean(selectedId)}>
      <section className={s.directory} aria-label="Directorio de clientes">
        <form className={s.search} role="search" onSubmit={search}>
          <label htmlFor="office-client-search">Buscar en el CRM</label>
          <div><input ref={searchInput} id="office-client-search" type="search" placeholder="Nombre del cliente" maxLength={120}
            value={input} onChange={event => setInput(event.target.value)} />
            <button type="submit" aria-label="Buscar clientes"><Search size={18} aria-hidden="true" /></button></div>
          {query && <button type="button" className={s.clear} onClick={() => { setInput(""); setQuery(""); setPages(firstPage); }}>
            <X size={13} aria-hidden="true"/> Quitar búsqueda «{query}»</button>}
        </form>
        <div className={s.filters} role="group" aria-label="Filtrar por primera compra">{stages.map(item =>
          <button key={item.id} type="button" aria-pressed={stage === item.id} onClick={() => changeStage(item.id)}>{item.label}</button>)}</div>
        <div aria-live="polite" className={s.feedback}>
          {!visible && "Cargando clientes…"}
          {rows && (rows.length ? `Página ${pages.length} · ${rows.length} ${rows.length === 1 ? "ficha" : "fichas"}` : "No hay clientes que coincidan con esta consulta.")}
        </div>
        {visible?.error && <div className={s.error} role="alert"><p>{visible.error}</p><button type="button" onClick={() => { setResult(null); setRetry(n => n + 1); }}>Reintentar directorio</button></div>}
        {rows && rows.length > 0 && <ul className={s.people}>{rows.map(row => <li key={row.id}>
          <OfficeClientLink area={area} clientId={row.id} open={openRow} current={selectedId === row.id}>
            <span className={s.personIcon}><UserRound size={16} aria-hidden="true"/></span>
            <span className={s.personText}><strong>{row.display_name || "Ficha sin nombre"}</strong>
              <small>{row.country ? row.country + " · " : ""}{row.capture_stage === "captured" ? "Captado" : "Pendiente de primera compra"}</small>
              <small className={s.identity}>Ficha {row.id.slice(0, 8)}</small></span>
            <ChevronRight size={15} aria-hidden="true"/>
          </OfficeClientLink></li>)}</ul>}
        <nav className={s.pagination} aria-label="Páginas del directorio">
          <button type="button" disabled={pages.length <= 1} onClick={() => setPages(p => p.slice(0, -1))}><ArrowLeft size={14} aria-hidden="true"/> Anterior</button>
          <button type="button" disabled={!nextCursor} onClick={() => {
            if (nextCursor) setPages(p => [...p, nextCursor]);
          }}>Siguiente <ArrowRight size={14} aria-hidden="true"/></button>
        </nav>
      </section>
      <div ref={detail} tabIndex={-1} className={s.detailPane} aria-label="Ficha seleccionada">
        {selectedId && <OfficeClientLink area={area} open={openRow} className={s.backList}><ArrowLeft size={15} aria-hidden="true"/> Volver al directorio</OfficeClientLink>}
        {selectedId ? <OfficeClientDetail key={selectedId} id={selectedId} area={area} open={openRow}/> :
          <div className={s.empty}><UserRound size={28} aria-hidden="true"/><h3>Selecciona un cliente</h3>
            <p>Su ficha reúne la primera compra, la gestión de captación y las reservas registradas.</p></div>}
      </div>
    </div>
  </section>;
}
