"use client";

import { useState } from "react";
import type { PilotFunnel } from "./office-campaign-pilot";
import styles from "./OfficeMonthlyReport.module.css";

const percent = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 2 });
const regions = new Intl.DisplayNames("es", { type: "region" });

function rate(buyers: number, contacts: number) {
  return contacts ? percent.format(buyers / contacts) : "Sin base";
}

function purchaseCount(buyers: number, contacts: number) {
  const purchases = buyers === 1 ? "primera compra" : "primeras compras";
  const people = contacts === 1 ? "contacto" : "contactos";
  return `${buyers} ${purchases} entre ${contacts} ${people}`;
}

function countryLabel(country: string | null) {
  if (!country) return "Sin país registrado";
  return /^[A-Z]{2}$/.test(country) ? regions.of(country) || country : country;
}

function duration(minutes: number | null) {
  if (minutes === null) return "Sin dato";
  const rounded = Math.round(minutes);
  if (rounded < 1) return "Menos de 1 min";
  if (rounded < 60) return rounded + " min";
  if (rounded < 1440) return Math.floor(rounded / 60) + " h " + rounded % 60 + " min";
  return Math.floor(rounded / 1440) + " d " + Math.floor(rounded % 1440 / 60) + " h";
}

export default function OfficeCampaignConversion({ funnel }: { funnel: PilotFunnel }) {
  const [selection, setSelection] = useState("");
  const rows = funnel.countries;
  const countryKey = (country: string | null) => country === null ? "unknown" : "country:" + country;
  const selectedRow = rows.find(row => countryKey(row.country) === selection);
  const row = selectedRow ?? funnel.total;

  return <section className={styles.section} aria-label="Conversión a primera compra">
    <div className={styles.conversionHeader}>
      <h3>Conversión a primera compra</h3>
      <label>País del contacto
        <select value={selectedRow ? selection : ""} onChange={event => setSelection(event.target.value)}>
          <option value="">Todos los países</option>
          {rows.map(item => <option key={countryKey(item.country)} value={countryKey(item.country)}>
            {countryLabel(item.country)} ({item.contacts})
          </option>)}
        </select>
      </label>
    </div>
    <div className={styles.sales} aria-live="polite">
      <div><span>Conversión acumulada</span><strong>{rate(row.first_buyers, row.contacts)}</strong>
        <small>{purchaseCount(row.first_buyers, row.contacts)}.</small></div>
      <div><span>Respuesta digital comprobada</span><strong>{row.replied} de {row.contacts}</strong>
        <small>Tiempo hasta la primera respuesta (mediana) · {duration(row.median_reply_minutes)}</small></div>
      <div><span>Conversión en 7 días</span><strong>{rate(row.buyers_within_7d, row.matured_contacts)}</strong>
        <small>{purchaseCount(row.buyers_within_7d, row.matured_contacts)} con siete días completos de observación.</small></div>
    </div>
    <dl className={styles.conversionEvidence}>
      <div><dt>Recibieron una línea telefónica</dt><dd>{row.phone_routed}</dd></div>
      <div><dt>Recibieron acceso al Oráculo</dt><dd>{row.oracle_routed}</dd></div>
      <div><dt>Contactos con consulta registrada</dt><dd>{row.recorded_consultations}</dd></div>
      <div><dt>Primera compra tras una respuesta digital comprobada</dt><dd>{row.buyers_after_reply}</dd></div>
      <div><dt>Sin respuesta digital acreditada ni primera compra atribuida</dt><dd>{row.without_reply_or_purchase}</dd></div>
    </dl>
    <p className={styles.note}>Se cuentan los contactos del formulario de esta campaña. Las respuestas digitales requieren un envío acreditado. Las consultas registradas y las rutas pueden corresponder a la misma persona.</p>
  </section>;
}
