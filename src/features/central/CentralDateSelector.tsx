"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./CentralDateSelector.module.css";

const label = (value: string) => new Intl.DateTimeFormat("es-ES", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date(`${value}T12:00:00Z`));

function move(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type CentralDateSelectorProps = {
  value: string;
  today: string;
  loading: boolean;
  onChange: (date: string) => void;
};

export default function CentralDateSelector({ value, today, loading, onChange }: CentralDateSelectorProps) {
  const isToday = value === today;
  const chooseDate = (date: string) => {
    if (date && date <= today && date !== value) onChange(date);
  };

  return (
    <section className={`tc-glass ${styles.bar}`} aria-label="Seleccionar fecha del resumen">
      <div className={styles.context}>
        <span className={styles.contextTitle}>Resumen diario</span>
        <span className={styles.timezone}>Europe/Madrid</span>
      </div>
      <div className={styles.controls}>
        <button className={`${styles.today} ${isToday ? styles.todayActive : ""}`} type="button" aria-pressed={isToday} onClick={() => chooseDate(today)}>
          Hoy
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button className={styles.arrow} type="button" aria-label="Día anterior" onClick={() => chooseDate(move(value, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <label className={styles.dateField} title={label(value)}>
          <CalendarDays size={18} aria-hidden="true" />
          <input aria-label="Fecha del resumen" type="date" value={value} max={today} onChange={(event) => chooseDate(event.target.value)} />
        </label>
        <button className={styles.arrow} type="button" aria-label="Día siguiente" disabled={value >= today} onClick={() => chooseDate(move(value, 1))}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      {loading ? <span className={styles.loading} role="status">Cargando resumen…</span> : null}
    </section>
  );
}
