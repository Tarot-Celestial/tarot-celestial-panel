"use client";

import { useEffect, useState, type FormEvent } from "react";
import { officeRequest } from "./office-client";
import type { PilotBuyer, PilotReport } from "./office-campaign-pilot";
import OfficeCampaignConversion from "./OfficeCampaignConversion";
import styles from "./OfficeMonthlyReport.module.css";
const api = "/api/admin/office/campaign-pilot";
const labels: Record<string, string> = {
  crm_cliente_pagos: "Pago en CRM",
  rendimiento_llamadas: "Compra registrada en llamada",
  cliente_payment_attempts: "Pago del panel",
  stripe_oracle_credits: "Créditos del Oráculo",
  stripe_oracle_questions: "Preguntas del Oráculo",
  stripe_chat: "Pago del chat",
  stripe_chat_credits: "Créditos del chat",
  meta_form: "Formulario de Meta",
  facebook: "Formulario de Facebook",
  instagram: "Formulario de Instagram",
  recorded: "Registrado",
  completed: "Completado",
  refunded: "Reembolsado",
  partially_refunded: "Reembolso parcial",
  reversed: "Revertido",
  oracle: "Oráculo",
  ask_country: "Solicitud de país",
  clarify_request: "Aclaración de la consulta",
  phone: "Línea telefónica",
  line: "Línea telefónica",
  public_invite: "Invitación pública",
  whatsapp: "WhatsApp",
  whatsapp_template: "Plantilla de WhatsApp",
  claim: "Tomó el caso",
  release: "Dejó el caso disponible",
  resolve: "Resolvió el caso",
  return: "Devolvió el caso a Captación"
};
const spendReasons: Record<string, string> = {
  not_connected: "La Oficina aún no tiene una conexión de lectura de anuncios.",
  no_access: "Meta no concedió acceso a los datos de gasto de esta campaña.",
  not_campaign: "El formulario llegó sin identificador de campaña de Meta.",
  conflicting_account: "La cuenta del CSV y la conexión actual no coinciden.",
  unverified_period: "Los datos de Meta no coinciden con el período o la cuenta solicitados.",
  unverified_account: "Meta no confirmó los datos de la cuenta publicitaria.",
  no_period_total: "Meta no devolvió un total comprobable para este período.",
  provider_unavailable: "No se pudo consultar el gasto en Meta.",
  not_started: "El mes aún no ha comenzado en la zona horaria de la cuenta."
};
function money(value: number | null, currency: string | null) {
  if (value === null) return "Sin importe";
  if (!currency) return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 6
  }).format(value) + " (divisa sin registrar)";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    currencyDisplay: "code"
  }).format(value);
}
function instant(value: string, zone: string) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: zone
  }).format(new Date(value));
}
function day(value: string) {
  return value.split("-").reverse().join("/");
}
function updateCampaignUrl(campaign: string, method: "pushState" | "replaceState") {
  const url = new URL(window.location.href);
  if (campaign) url.searchParams.set("campana", campaign);else url.searchParams.delete("campana");
  if (url.href !== window.location.href) window.history[method](window.history.state, "", url);
}
function Buyer({
  buyer,
  zone
}: {
  buyer: PilotBuyer;
  zone: string;
}) {
  return <details className={styles.details}>
    <summary>{instant(buyer.purchase_at, zone)} · {money(buyer.amount, buyer.currency)} <span>{labels[buyer.source] ?? buyer.source}</span></summary>
    <div className={styles.section}>
      <p className={styles.note}>Entrada el {instant(buyer.contact_at, zone)} · {labels[buyer.channel] ?? buyer.channel}</p>
      {buyer.handling?.length ? <ol>{buyer.handling.map((item, index) => <li key={index}>
        {instant(item.at, zone)} · {item.kind === "automated" ? "Captación automática" : item.kind === "commercial" ? "Gestión de Comercial" : "Envío de WhatsApp"} · {labels[item.route] ?? item.route}
        {item.operator && <> · {item.operator}</>}
      </li>)}</ol> : <p className={styles.note}>No consta una gestión de Captación o Comercial anterior a esta primera compra con evidencia vinculada.</p>}
      {buyer.call_operator && <p className={styles.note}>Operador de la llamada vinculada al cobro · {buyer.call_operator}</p>}
      <p className={styles.note}>Primera compra · {labels[buyer.status] ?? buyer.status}</p>
      <div className={styles.controls}><a className={styles.link} href={"/admin?tab=crm&open_cliente_id=" + buyer.client_id}>Abrir ficha CRM</a>
        <a className={styles.link} href={"/admin?tab=captacion&lead=" + buyer.lead_id}>Abrir contacto de Captación</a></div>
    </div>
  </details>;
}
function ImportSpend({
  campaign,
  month,
  onSaved
}: {
  campaign: string;
  month: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("campaign", campaign);
    data.set("month", month);
    setSaving(true);
    setMessage("");
    try {
      await officeRequest(api, {
        method: "POST",
        body: data
      });
      setMessage("Exportación registrada.");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo registrar el CSV.");
    } finally {
      setSaving(false);
    }
  }
  return <details className={styles.details}>
    <summary>Registrar gasto desde Ads Manager</summary>
    <form className={styles.section} onSubmit={submit}>
      <p className={styles.note}>Exporta una fila por campaña, desde el día 1 del mes. Incluye los identificadores de campaña y cuenta, las fechas de inicio y fin del informe, el importe gastado y la moneda.</p>
      <div className={styles.controls}><label>CSV de Meta (máximo 512 KiB)<input type="file" name="file" accept=".csv,text/csv" required /></label>
        <label>Zona horaria de la cuenta<input name="zone" placeholder="Europe/Madrid" required maxLength={80} /></label></div>
      <p><label><input name="attested" type="checkbox" value="true" required /> Confirmo que el archivo procede de la exportación oficial de esta cuenta de anuncios.</label></p>
      <button className={styles.link} disabled={saving}>{saving ? "Registrando…" : "Registrar exportación"}</button>
      <p role="status" className={styles.note}>{message}</p>
    </form>
  </details>;
}
export default function OfficeCampaignPilot({
  month,
  onMonthChange
}: {
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const [campaign, setCampaign] = useState<string | null>(null),
    [cursor, setCursor] = useState("");
  const [refresh, setRefresh] = useState(0),
    [report, setReport] = useState<PilotReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const read = () => {
      setCampaign(new URL(window.location.href).searchParams.get("campana") || "");
      setCursor("");
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  useEffect(() => {
    if (campaign === null) return;
    const controller = new AbortController(),
      params = new URLSearchParams({
        month
      });
    if (campaign) params.set("campaign", campaign);
    if (cursor) params.set("cursor", cursor);
    setReport(null);
    setError("");
    officeRequest<PilotReport>(api + "?" + params, {
      signal: controller.signal
    }).then(result => {
      if (controller.signal.aborted) return;
      setReport(result);
      if (!campaign && result.selected) updateCampaignUrl(result.selected.id, "replaceState");
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo cargar la campaña.");
    });
    return () => controller.abort();
  }, [campaign, month, cursor, refresh]);
  function select(id: string) {
    updateCampaignUrl(id, "pushState");
    setCampaign(id);
    setCursor("");
  }
  const spend = report?.spend;
  return <section className={styles.report} aria-label="Piloto de campaña">
    <header className={styles.header}><div><p className={styles.area}>Marketing · Captación</p><h2>Piloto de campaña</h2></div>
      <div className={styles.controls}><label>Mes de entrada<input type="month" value={month} onChange={event => {
            if (event.target.value) {
              setCampaign("");
              setCursor("");
              onMonthChange(event.target.value);
            }
          }} /></label>
      {report && report.campaigns.length > 0 && <label>Campaña o formulario<select value={report.selected?.id || ""} onChange={e => select(e.target.value)}>
        {report.campaigns.map(c => <option key={c.id} value={c.id}>{c.name || c.id} · {c.id}</option>)}
      </select></label>}</div>
    </header>
    {error ? <div className={styles.section}><p role="alert">{error}</p><div className={styles.controls}>
      <button onClick={() => setRefresh(n => n + 1)}>Reintentar</button><button onClick={() => {
          select("");
          setRefresh(n => n + 1);
        }}>Ver campañas del mes</button>
    </div></div> : !report ? <p className={styles.notice} role="status">Consultando campaña y cobros…</p> : <>
      {report.selected ? <>
        <section className={styles.section}><div className={styles.sectionTitle}><h3>{report.selected.name || report.selected.id}</h3></div>
          <p className={styles.note}>{report.selected.id.startsWith("form-") ? "Formulario sin identificador de campaña" : "Campaña de Meta"} · {report.selected.id} · {day(report.period_from)} – {day(report.period_through)} · {report.zone}</p>
          {report.selected.id.startsWith("form-") && <p className={styles.note}>Las primeras compras de este formulario figuran también en «Sin atribuir» en su mes de cobro mientras falte la campaña.</p>}
          <div className={styles.sales}>
            <div><span>{report.selected.id.startsWith("form-") ? "Contactos del formulario" : "Contactos de la campaña"}</span><strong>{report.contacts}</strong><small>Una vez por persona en el mes, incluidas reentradas.</small></div>
            <div><span>Primeros compradores</span><strong>{report.first_buyers}</strong><small>Primera entrada atribuida en el mes y primera compra posterior.</small></div>
            <div><span>Gasto publicitario</span><strong>{spend ? money(spend.amount, spend.currency) : "Sin datos"}</strong>
              {spend && <small>{day(spend.from)} – {day(spend.through)}</small>}</div>
            <div><span>Coste por primer comprador</span><strong>{report.cpa !== null && spend ? money(report.cpa, spend.currency) : "Sin datos"}</strong>
              {spend && <small>{report.cost_first_buyers} primeros compradores con entrada en las fechas del gasto.</small>}</div>
          </div>
          {spend ? <p className={styles.note}>Gasto de {spend.source === "meta_insights" ? "Meta Ads Insights" : "una exportación de Ads Manager"} · Cuenta {spend.account_id} · {spend.source === "meta_insights" ? "Consultado" : "Registrado"} el {instant(spend.checked_at, report.zone)}
            {spend.worker && <> por {spend.worker}</>}{spend.file_sha256 && <> · Huella SHA-256 {spend.file_sha256.slice(0, 12)}…</>}</p> : <p className={styles.note}>{spendReasons[report.spend_reason ?? ""] ?? "No consta un importe de gasto comprobado para este período."}</p>}
          {!report.selected.id.startsWith("form-") && <ImportSpend key={report.selected.id + month} campaign={report.selected.id} month={month} onSaved={() => setRefresh(n => n + 1)} />}
        </section>
        {report.funnel && <OfficeCampaignConversion key={report.selected.id + month} funnel={report.funnel}/>}
        <section className={styles.section}><div className={styles.sectionTitle}><h3>Ingresos por moneda</h3></div>
          <p className={styles.note}>Cobros de estos compradores hasta {instant(report.as_of, report.zone)}, incluidas las compras posteriores al fin del mes. El bruto conserva los cobros con reembolso o reversión.</p>
          {report.amounts.length > 0 ? <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Moneda</th><th>Primeras compras · bruto</th><th>Todos los cobros · bruto</th><th>Cobros con reembolso o reversión</th></tr></thead>
            <tbody>{report.amounts.map(row => <tr key={row.currency ?? "unknown"}><th scope="row">{row.currency ?? "Sin divisa registrada"}</th>
              <td>{money(row.first_gross, row.currency)} ({row.first_count})</td><td>{money(row.gross, row.currency)} ({row.receipts})</td><td>{row.refund_flagged}</td></tr>)}</tbody></table></div> : <p className={styles.note}>Todavía no constan cobros atribuibles a esta entrada.</p>}
        </section>
        <section className={styles.section}><div className={styles.sectionTitle}><h3>Detalle de las primeras compras</h3></div>
          {report.buyers.map(b => <Buyer key={b.client_id} buyer={b} zone={report.zone} />)}
          {!report.buyers.length && <p className={styles.note}>Sin primeras compras en esta página.</p>}
          <div className={styles.controls}>{cursor && <button onClick={() => setCursor("")}>Primera página</button>}
            {report.next_cursor && <button onClick={() => setCursor(report.next_cursor!)}>Más compradores</button>}</div>
        </section>
      </> : <p className={styles.notice}>No hay contactos de campaña identificados este mes.</p>}
      <section className={styles.section}><div className={styles.sectionTitle}><h3>Sin atribuir</h3></div>
        <p className={styles.note}><strong>{report.unattributed_first_purchases}</strong> primeras compras del CRM cobradas en el mes sin campaña publicitaria demostrable. Este recuento global usa la fecha de compra y está excluido del CPA.</p>
      </section>
    </>}
  </section>;
}
