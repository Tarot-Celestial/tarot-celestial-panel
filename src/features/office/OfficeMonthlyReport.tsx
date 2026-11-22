"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, RefreshCw, UsersRound } from "lucide-react";
import { accountingToday } from "@/lib/accounting";
import { monthLabel } from "@/features/accounting/monthly-model";
import OfficeAccountingMonth from "./OfficeAccountingMonth";
import type { OfficeCohortCurrency, OfficeCohortOrigin, OfficeCohortReport } from "./office-cohorts";
import styles from "./OfficeMonthlyReport.module.css";

export type OfficeReportArea = "finanzas" | "inteligencia" | "estrategia";
type Props = {
  area: OfficeReportArea; month: string; report: OfficeCohortReport | null; loading: boolean; error: string | null;
  onMonthChange: (month: string) => void; onReload: () => void; children?: ReactNode;
};
const areas = { finanzas: "Finanzas", inteligencia: "Inteligencia", estrategia: "Estrategia" };
const origins: Record<OfficeCohortOrigin, string> = {
  meta_lead: "Formulario de Meta", web_registration: "Registro web", referral: "Recomendación",
  instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", manual: "Registro manual",
  other_recorded: "Otra procedencia registrada", unknown: "Sin procedencia acreditada",
};
const basisLabels = {
  historical: "Documentado antes de la primera compra",
  current_only: "Origen actual de la ficha, sin fecha verificable",
  unknown: "Sin origen documentado",
};
const periods = [
  ["first", "Primeras compras"], ["month_to_date", "Compras del mes de captación"], ["lifetime_to_cutoff", "Compras acumuladas al corte"],
] as const;
const integer = new Intl.NumberFormat("es-ES");

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Sin conciliar";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, currencyDisplay: "code" }).format(value);
}

function SalesTable({ amounts, caption }: { amounts: OfficeCohortCurrency[]; caption: string }) {
  if (!amounts.length) return <p className={styles.note}>Sin compras para este grupo.</p>;
  return <div className={styles.scroll}><table className={styles.table}>
    <caption>{caption}</caption>
    <thead><tr>{["Periodo de compra", "Divisa", "Compras", "Bruto", "Confirmado", "Bruto con devolución", "Parciales sin importe", "Sin conciliar"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
    <tbody>{amounts.map(row => periods.map(([key, label]) => {
      const metric = row[key];
      return <tr key={(row.currency || "unknown") + key}><th scope="row">{label}</th><td>{row.currency || "Sin registrar"}</td>
        <td>{integer.format(metric.purchases)}</td><td>{money(metric.gross, row.currency)}</td><td>{money(metric.confirmed, row.currency)}</td>
        <td>{money(metric.refund_flagged, row.currency)}</td><td>{integer.format(metric.refund_unknown_count)}</td><td>{integer.format(metric.unresolved_count)}</td>
      </tr>;
    }))}</tbody>
  </table></div>;
}

function CrmSection({ report, area }: { report: OfficeCohortReport; area: OfficeReportArea }) {
  const cutoff = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: report.zone }).format(new Date(report.as_of));
  return <section className={styles.section} aria-label="Captación y ventas del CRM">
    <div className={styles.sectionTitle}><UsersRound size={19} aria-hidden="true" /><h3>Captación y ventas del CRM</h3></div>
    <div className={styles.cohort}>
      <div><span className={styles.figure}>{integer.format(report.captured_clients)}</span><span>Clientes captados</span></div>
      <p>Clientes de Tarot Celestial con su primera compra en {monthLabel(report.month)}. Las ventas del mes y las acumuladas corresponden a estos mismos clientes e incluyen su primera compra.</p>
    </div>
    {area === "finanzas" && report.totals.length > 0 && <div className={styles.sales}>
      {report.totals.map(row => <div key={row.currency || "unknown"}>
        <span>Ventas confirmadas del grupo en el mes · {row.currency || "Sin divisa registrada"}</span>
        <strong>{money(row.month_to_date.confirmed, row.currency)}</strong>
        <small>{integer.format(row.month_to_date.purchases)} compras registradas en el mes</small>
      </div>)}
    </div>}
    <p className={styles.note}>El CRM reúne los pagos registrados por Central y web, las compras de llamadas y los cobros del Oráculo. Datos al {cutoff} ({report.zone}).</p>
    <SalesTable amounts={report.totals} caption="Ventas de los clientes captados, por moneda" />
    <p className={styles.note}>El bruto recoge los cobros históricos. El confirmado recoge los que conservan estado confirmado. La columna de devoluciones muestra el bruto original de los cobros marcados.</p>
    <h4 className={styles.subheading}>Procedencia de los clientes</h4>
    {report.origins.length === 0 ? <p className={styles.note}>Sin clientes captados en el periodo.</p> : report.origins.map(group =>
      <details className={styles.details} key={group.origin + group.basis}><summary>{origins[group.origin]} <span>{integer.format(group.captured_clients)} {group.captured_clients === 1 ? "cliente" : "clientes"}</span>
        <small className={styles.basis}>{basisLabels[group.basis]}</small></summary>
        <SalesTable amounts={group.amounts} caption={"Ventas del grupo · " + origins[group.origin]} />
      </details>)}
    {area === "estrategia" && <StrategyNote report={report} />}
  </section>;
}

function StrategyNote({ report }: { report: OfficeCohortReport }) {
  const missing = report.origins.filter(group => group.basis === "unknown").reduce((sum, group) => sum + group.captured_clients, 0);
  const unverified = report.origins.filter(group => group.basis === "current_only").reduce((sum, group) => sum + group.captured_clients, 0);
  const known = report.origins.filter(group => group.basis === "historical" && group.captured_clients > 0);
  const largest = Math.max(0, ...known.map(group => group.captured_clients));
  const leaders = known.filter(group => group.captured_clients === largest).map(group => origins[group.origin]).join(", ");
  return <aside className={styles.strategy}><strong>Propuesta para revisión interna</strong><p>
    {missing > 0
      ? "Revisar la procedencia de " + integer.format(missing) + (missing === 1 ? " cliente captado que sigue sin atribución." : " clientes captados que siguen sin atribución.")
      : unverified > 0
        ? "Comprobar la fecha y la fuente del origen anotado en las fichas de " + integer.format(unverified) + (unverified === 1 ? " cliente antes de atribuir su captación a un canal." : " clientes antes de atribuir su captación a un canal.")
        : largest > 0
        ? "Revisar las primeras compras y las compras posteriores del grupo con más captaciones en el mes (" + leaders + "). Contrastar los datos de inversión antes de decidir cambios de presupuesto."
        : "Comprobar que el CRM recoge las primeras compras del mes antes de plantear cambios de presupuesto."}
  </p></aside>;
}

export function OfficeMonthlyReport({ area, month, onMonthChange, report, loading, error, onReload, children }: Props) {
  const [revision, setRevision] = useState(0);
  const selected = report?.month === month ? report : null;
  const maxMonth = accountingToday().slice(0, 7);
  return <section className={styles.report} aria-label={"Informe mensual de " + areas[area]}>
    <header className={styles.header}>
      <div><p className={styles.area}>{areas[area]}</p><h2>Informe mensual</h2></div>
      <div className={styles.controls}><label><CalendarDays size={15} aria-hidden="true" /><span>Mes del informe</span>
        <input type="month" aria-label="Mes del informe" value={month} max={maxMonth} onChange={event => {
          const value = event.currentTarget.value;
          if (/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value) && value <= maxMonth) onMonthChange(value);
        }} /></label>
        <button type="button" onClick={() => { setRevision(value => value + 1); onReload(); }}><RefreshCw size={15} aria-hidden="true" />Actualizar informe</button>
      </div>
    </header>
    {children}
    {error ? <p className={styles.notice} role="alert">{error}</p> : selected ? <CrmSection report={selected} area={area} /> :
      <p className={styles.notice} role="status">{loading ? "Leyendo captación y ventas del CRM…" : "Pendiente de lectura del CRM."}</p>}
    <OfficeAccountingMonth key={month + ":" + revision} area={area} month={month} />
  </section>;
}
export default OfficeMonthlyReport;
