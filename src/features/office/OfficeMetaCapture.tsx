"use client";

import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { officeRequest } from "./office-client";
import type { OfficeMetaReport } from "./office-meta-attribution";
import { OfficeCaptureThread } from "./OfficeCaptureThread";
import OfficeCaptureSettings from "./OfficeCaptureSettings";
import s from "./OfficeMonthlyReport.module.css";

const captureChannels: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", meta_form: "Formulario de Meta" };
const kinds: Record<string, string> = { message: "Mensaje", comment: "Comentario", form: "Formulario" };
const states: Record<string, string> = { pending: "Por atender", claimed: "En revisión", dispatching: "Enviando", sent: "Enviado",
  expired: "Ventana cerrada", handoff: "Derivado a Comercial", blocked: "Bloqueado", failed: "Envío fallido", uncertain: "Entrega por comprobar",
  opted_out: "Baja solicitada", purchased: "Compra registrada" };
const conversions: Record<string, string> = { unlinked: "Sin ficha vinculada", awaiting_proof: "Vínculo por confirmar",
  awaiting_purchase: "Pendiente de compra", prior_customer: "Cliente previo", first_purchase: "Primera compra" };
const purchaseSources: Record<string, string> = { stripe_oracle_credits: "Créditos del Oráculo", stripe_oracle_questions: "Preguntas del Oráculo",
  stripe_chat: "Chat", stripe_chat_credits: "Créditos de chat", crm_cliente_pagos: "Pago en el CRM", rendimiento_llamadas: "Compra en llamada",
  cliente_payment_attempts: "Pago del panel" };
const time = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

export default function OfficeMetaCapture({ month, onMonthChange }: { month: string; onMonthChange: (month: string) => void }) {
  const [revision, refresh] = useState(0);
  const today = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", timeZone: "Europe/Madrid" }).format(new Date());
  return <section className={s.report} aria-label="Seguimiento de Meta">
    <header className={s.header}><div><p className={s.area}>Marketing · Captación · Comercial</p><h2>Seguimiento de Meta</h2></div>
      <div className={s.controls}><label><CalendarDays size={15}/><span>Mes de entrada</span><input type="month" value={month} max={today}
        onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) && e.target.value <= today) onMonthChange(e.target.value); }}/></label>
        <button type="button" onClick={() => refresh(n => n + 1)}><RefreshCw size={15}/>Actualizar</button></div>
    </header>
    <CaptureReport key={month + ":" + revision} month={month}/>
    <OfficeCaptureSettings key={revision}/>
  </section>;
}

function CaptureReport({ month }: {month: string}) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const cursor = pages[pages.length - 1];
  const [result, setResult] = useState<{ cursor: string | null; report?: OfficeMetaReport; error?: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ month });
    if (cursor) params.set("cursor", cursor);
    officeRequest<OfficeMetaReport>("/api/admin/office/meta-attribution?" + params, { signal: abort.signal })
      .then(report => { if (!abort.signal.aborted) setResult({ cursor, report }); })
      .catch(e => { if (!abort.signal.aborted) setResult({ cursor, error: e instanceof Error ? e.message : "No se pudo consultar el seguimiento." }); });
    return () => abort.abort();
  }, [month, cursor]);
  if (!result || result.cursor !== cursor) return <p className={s.notice} role="status">Consultando entradas y primeras compras…</p>;
  if (!result.report) return <p className={s.notice} role="alert">{result.error}</p>;
  const { totals, platforms, purchases, states: delivery, items, next_cursor } = result.report;
  return <>
    <section className={s.section}><h3 className={s.subheading}>De la consulta a la primera compra</h3>
      <p className={s.note}>Sigue a quienes entraron en el mes elegido. Una ficha vinculada cuenta como captada cuando el CRM acredita su primera compra después del contacto. La tirada gratuita queda fuera del recuento.</p>
      <div className={s.sales}>{[["Oportunidades", totals.opportunities], ["Clientes vinculados", totals.linked_clients], ["Primeras compras", totals.first_purchases], ["Ya eran clientes", totals.prior_clients]].map(([label, n]) =>
        <div key={label}><span>{label}</span><strong>{n}</strong></div>)}</div>
      {platforms.length > 0 && <div className={s.scroll}><table className={s.table}><caption>Resultados por canal de entrada</caption><thead><tr><th>Canal</th><th>Oportunidades</th><th>Clientes vinculados</th><th>Primeras compras</th></tr></thead>
        <tbody>{platforms.map(row => <tr key={row.platform}><th scope="row">{captureChannels[row.platform] || row.platform}</th><td>{row.opportunities}</td><td>{row.linked_clients}</td><td>{row.first_purchases}</td></tr>)}</tbody></table></div>}
      {purchases.length > 0 && <p className={s.note}>Primera compra registrada por {purchases.map(p => (purchaseSources[p.source] || p.source) + " (" + p.count + ")").join(" · ")}.</p>}
      <p className={s.note}>Los canales incluyen entradas orgánicas. Una conversación por sí sola no acredita que la persona llegara por un anuncio.</p>
    </section>
    <section className={s.section}><h3 className={s.subheading}>Seguimiento de oportunidades</h3>
      {delivery.length > 0 && <p className={s.note}>{delivery.map(x => (states[x.state] || x.state) + " (" + x.count + ")").join(" · ")}</p>}
      {items.length ? <div className={s.scroll}><table className={s.table}><caption>Entradas del mes · hora de Madrid</caption><thead><tr><th>Entrada</th><th>Canal</th><th>Seguimiento</th><th>Compra</th></tr></thead>
        <tbody>{items.map(row => <tr key={row.id}><td>{time.format(new Date(row.source_at))}</td><td>{row.display_name && <strong className={s.captureName}>{row.display_name}</strong>}{captureChannels[row.channel] || row.channel} · {kinds[row.kind] || row.kind}
          {row.lead_id && <div><a href={"/admin?tab=captacion&lead=" + encodeURIComponent(row.lead_id)}>Abrir contacto</a></div>}</td>
          <td>{states[row.status] || row.status}{row.provider_error && <small className={s.basis}>{row.provider_error}</small>}
            {row.thread_id && (row.channel === "instagram" || row.channel === "facebook") && <OfficeCaptureThread channel={row.channel} id={row.thread_id}/>}</td>
          <td>{conversions[row.conversion] || row.conversion}{row.first_purchase_at && <small className={s.basis}>{time.format(new Date(row.first_purchase_at))}
            {row.first_purchase_source && " · " + (purchaseSources[row.first_purchase_source] || row.first_purchase_source)}
            {row.first_purchase_status?.includes("refund") || row.first_purchase_status === "reversed" ? " · Con devolución" : ""}</small>}</td></tr>)}</tbody></table></div>
        : <p className={s.note}>No hay entradas registradas en este mes.</p>}
      {(pages.length > 1 || next_cursor) && <nav className={s.controls} aria-label="Páginas de oportunidades"><button type="button" disabled={pages.length === 1} onClick={() => setPages(p => p.slice(0, -1))}>Anterior</button>
        <span className={s.note}>Página {pages.length}</span><button type="button" disabled={!next_cursor} onClick={() => next_cursor && setPages(p => [...p, next_cursor])}>Siguiente</button></nav>}
    </section>
  </>;
}
