"use client";

import { useEffect, useState } from "react";
import { officeRequest } from "./office-client";
import styles from "./OfficeCohortHistory.module.css";

type Month = { month: string; captured_clients: number };
const labels = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" });

export default function OfficeCohortHistory({ month, onMonthChange }: { month: string; onMonthChange: (value: string) => void }) {
  const year = month.slice(0, 4);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ year: string; months?: Month[]; error?: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    officeRequest<{ months: Month[] }>("/api/admin/office/cohorts/history?year=" + year, { signal: abort.signal })
      .then(data => { if (!abort.signal.aborted) setResult({ year, months: data.months }); })
      .catch(() => { if (!abort.signal.aborted) setResult({ year, error: "No se pudo consultar el histórico." }); });
    return () => abort.abort();
  }, [year, retry]);
  const current = result?.year === year ? result : null;
  const maximum = Math.max(1, ...(current?.months || []).map(row => row.captured_clients));
  return <section className={styles.chart} aria-label="Histórico mensual de captación">
    <h3>Primeras compras por mes <span>{year}</span></h3>
    {!current ? <p role="status">Consultando el histórico…</p> : current.error ? <p role="alert">{current.error}{" "}
      <button type="button" onClick={() => { setResult(null); setRetry(n => n + 1); }}>Reintentar</button></p> :
      <div className={styles.months}>{current.months?.map(row => {
        const label = labels.format(new Date(row.month + "-01T12:00:00Z"));
        return <button type="button" key={row.month} aria-pressed={month === row.month}
          aria-label={`${label} de ${year}, ${row.captured_clients} clientes con primera compra`} onClick={() => onMonthChange(row.month)}>
          <strong>{row.captured_clients}</strong>
          <span className={styles.plot} aria-hidden="true"><i style={{ height: (100 * row.captured_clients / maximum) + "%" }}/></span>
          <span>{label}</span>
        </button>;
      })}</div>}
  </section>;
}
