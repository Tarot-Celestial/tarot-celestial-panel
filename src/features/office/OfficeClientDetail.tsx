"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Receipt, UsersRound } from "lucide-react";
import { officeRequest } from "./office-client";
import type { OfficeClientDetail as ClientSheet } from "./office-clients";
import OfficeClientLink, { type ClientArea, type OpenClientArea } from "./OfficeClientLink";
import s from "./OfficeClients.module.css";

const madrid = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });
const day = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", dateStyle: "medium" });
function dateLabel(value: string | null) {
  if (!value) return "Sin fecha registrada";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "Sin fecha registrada";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? day.format(instant) : madrid.format(instant);
}
const sources: Record<string, string> = {
  crm_cliente_pagos: "Pagos del CRM", rendimiento_llamadas: "Compra registrada en llamada",
  cliente_payment_attempts: "Pago del panel de clientes", stripe_oracle_credits: "Stripe · créditos del Oráculo",
  stripe_oracle_questions: "Stripe · preguntas del Oráculo",
};
const statuses: Record<string, string> = {
  pending: "Pendiente", confirmed: "Confirmada", completed: "Completada", cancelled: "Cancelada",
  canceled: "Cancelada", refunded: "Reembolsada", partially_refunded: "Reembolso parcial", paid: "Pagada",
  succeeded: "Completada", captured: "Capturada", reversed: "Revertida", new: "Nuevo", contacted: "Contactado", scheduled: "Programada",
  no_show: "Sin asistencia", closed: "Cerrada", follow_up: "Seguimiento",
};
function statusLabel(value: string | null) {
  if (!value) return "Sin estado registrado";
  const key = value.trim().toLowerCase();
  return statuses[key] || (key.slice(0, 1).toUpperCase() + key.slice(1)).replace(/_/g, " ");
}
function money(amount: number | null, currency: string | null) {
  if (amount == null) return "Sin importe registrado";
  if (!currency?.match(/^[A-Z]{3}$/)) return `${amount.toLocaleString("es-ES")} · Moneda sin registrar`;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, currencyDisplay: "code" }).format(amount);
}

export default function OfficeClientDetail({ id, area, open }: { id: string; area: ClientArea; open: OpenClientArea }) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [sheet, setSheet] = useState<{ path: string; data: ClientSheet } | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const cursor = pages[pages.length - 1];
  const params = new URLSearchParams({ id, limit: "25" });
  if (cursor) params.set("cursor", cursor);
  const path = "/api/admin/office/clients?" + params;
  useEffect(() => {
    const abort = new AbortController();
    officeRequest<ClientSheet>(path, { signal: abort.signal }).then(data => {
      if (abort.signal.aborted) return;
      if (data.client.id !== id) throw new Error("La ficha recibida no corresponde al cliente seleccionado.");
      setFailure(null); setSheet({ path, data });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setFailure({ path, message: error instanceof Error ? error.message : "No se pudo consultar la ficha." });
    });
    return () => abort.abort();
  }, [id, path, retry]);
  const error = failure?.path === path ? failure.message : null;
  const page = sheet?.path === path ? sheet.data : null;
  const nextCursor = page?.next_reservations_cursor;
  const { client, first_purchase: purchase, capture } = sheet?.data || {};
  const retryControl = error && <div role="alert" className={s.error}><p>{error}</p><button type="button" onClick={() => {
    setFailure(null); setRetry(n => n + 1);
  }}>Reintentar ficha</button></div>;
  if (!client) return retryControl || <p className={s.feedback} role="status">Cargando ficha del cliente…</p>;
  return <article aria-label="Ficha del CRM">
    <header className={s.clientHeading}><div><h3>{client.display_name || "Ficha sin nombre"}</h3>
      <p>{client.country ? client.country + " · " : ""}Ficha {client.id.slice(0, 8)}</p></div>
      <a href={"/admin?tab=crm&open_cliente_id=" + encodeURIComponent(client.id)}>Abrir ficha en el CRM <ArrowUpRight size={15} aria-hidden="true"/></a>
    </header>
    <div className={s.meta}><span>Alta en el CRM <strong>{dateLabel(client.created_at)}</strong></span>
      {client.origin && <span>Origen de la ficha <strong>{client.origin}</strong></span>}
      <span>Cuenta del panel <strong>{client.account_linked ? "Vinculada" : "Sin vincular"}</strong></span></div>
    <section className={s.block}><h4><Receipt size={17} aria-hidden="true"/> Primera compra global</h4>
      {purchase ? <>
        <p className={s.stage}><strong>Captado</strong> · {dateLabel(purchase.at)} (Madrid)</p>
        <dl className={s.facts}><dt>Importe</dt><dd>{money(purchase.amount, purchase.currency)}</dd>
          <dt>Registro de compra</dt><dd>{sources[purchase.source] || purchase.source}</dd>
          {purchase.status && <><dt>Estado del pago</dt><dd>{statusLabel(purchase.status)}</dd></>}</dl>
      </> : <p>Pendiente de primera compra. El CRM todavía no registra una compra confirmada para esta ficha.</p>}
    </section>
    <section className={s.block}><h4><UsersRound size={17} aria-hidden="true"/> Gestión de captación</h4>
      {capture ? <><dl className={s.facts}><dt>Estado del contacto</dt><dd>{statusLabel(capture.status)}</dd>
        {capture.origin && <><dt>Origen del contacto</dt><dd>{capture.origin}</dd></>}
        <dt>Alta del contacto</dt><dd>{dateLabel(capture.created_at)}</dd>
        {capture.next_contact_at && <><dt>Próximo contacto</dt><dd>{dateLabel(capture.next_contact_at)} (Madrid)</dd></>}</dl>
        {area === "captacion-reservas" && capture.lead_id && <a className={s.contextLink}
          href={"/admin?tab=captacion&lead=" + encodeURIComponent(capture.lead_id)}>Gestionar captación en Central <ArrowUpRight size={15} aria-hidden="true"/></a>}
      </> : <p>Sin gestión de captación vinculada a esta ficha.</p>}
      {area === "clientes" && <OfficeClientLink area="captacion-reservas" clientId={id} open={open} className={s.contextLink}>
        Abrir en Captación y reservas <ArrowRight size={15} aria-hidden="true"/></OfficeClientLink>}
      {area === "captacion-reservas" && <OfficeClientLink area="clientes" clientId={id} open={open} className={s.contextLink}>
        Ver en Clientes <ArrowRight size={15} aria-hidden="true"/></OfficeClientLink>}
    </section>
    <section className={s.block}><h4><CalendarDays size={17} aria-hidden="true"/> Reservas del cliente</h4>
      {error ? retryControl : !page ? <p role="status">Cargando reservas…</p> : page.reservations.length ? <>
        <p className={s.timeZone}>Horario de Madrid</p>
        <ul className={s.bookings}>{page.reservations.map(row => <li key={row.source + ":" + row.id}>
          <div><strong>{dateLabel(row.at)}</strong><span>{row.tarotist_name || "Sin tarotista asignada"}</span>
            {row.source === "first_tarotist_reservations" && <small>Reserva de primera tarotista</small>}</div>
          <div><span className={s.bookingStatus}>{statusLabel(row.status)}</span>
            {row.source === "reservas" && <a href={"/admin?tab=reservas&reserva=" + encodeURIComponent(row.id)}
              aria-label={`Abrir reserva del ${dateLabel(row.at)}`}>Abrir reserva <ArrowUpRight size={13} aria-hidden="true"/></a>}</div>
        </li>)}</ul></> : <p>Sin reservas registradas para este cliente.</p>}
      {(pages.length > 1 || nextCursor) && <nav className={s.pagination} aria-label="Páginas de reservas">
        <button type="button" disabled={pages.length <= 1} onClick={() => setPages(p => p.slice(0, -1))}><ArrowLeft size={14} aria-hidden="true"/> Anteriores</button>
        <span>Página {pages.length}</span><button type="button" disabled={!nextCursor}
          onClick={() => { if (nextCursor) setPages(p => [...p, nextCursor]); }}>
          Siguientes <ArrowRight size={14} aria-hidden="true"/></button></nav>}
      <p className={s.agendaNote}>Las reservas de primera tarotista pendientes de vincular se consultan en <a href="/admin?tab=central-primera-tarotista">su agenda</a>.</p>
    </section>
  </article>;
}
