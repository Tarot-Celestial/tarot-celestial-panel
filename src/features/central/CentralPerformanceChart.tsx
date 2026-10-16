"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CentralDailyPerformance as Performance } from "@/lib/central-daily-performance";
import styles from "./CentralDailyOverview.module.css";

export default function CentralPerformanceChart({ performance, loading, error }: {
  performance?: Performance; loading?: boolean; error?: string;
}) {
  const gradientId = `daily-fill-${useId().replace(/:/g, "")}`;
  const frame = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(736);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setPlotWidth(Math.max(260, Math.round(entry.contentRect.width)));
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const points = performance?.hourly.filter(point => point.cumulative_xp != null) || [];
  const maximum = Math.max(10, ...points.map(point => Math.max(point.cumulative_xp || 0, point.reference_xp || 0)));
  const ceiling = Math.ceil(maximum / 10) * 10;
  const floor = Math.floor(Math.min(0, ...points.map(point => Math.min(point.cumulative_xp || 0, point.reference_xp || 0))) / 10) * 10;
  const x = (hour: number) => 44 + hour / 24 * (plotWidth - 68);
  const y = (value: number) => 140 - (value - floor) / (ceiling - floor) * 116;
  const line = points.map(point => `${x(point.hour)},${y(point.cumulative_xp || 0)}`).join(" ");
  const reference = points.filter(point => point.reference_xp != null).map(point => `${x(point.hour)},${y(point.reference_xp || 0)}`).join(" ");
  const hasActivity = points.some(point => point.cumulative_xp !== 0);
  const showData = !!performance && !loading && !error;
  const status = showData ? performance.status : "neutral";
  const message = error ? "No se pudo actualizar el resumen" : loading ? "Cargando tu actividad…" : !performance ? "El resumen aún no está disponible" : !hasActivity ? "Aún no hay XP registrado en este día" : "";

  return <div className={styles.performance} data-performance={status}>
    <div className={styles.chartMeta}>
      <span>Ritmo de XP registrado</span>
      <span className={styles.performanceState}>{showData ? performance.label : error ? "Sin actualizar" : loading ? "Cargando" : "Sin datos"}</span>
    </div>
    <div className={styles.chartFrame} ref={frame} aria-busy={loading}>
      <svg viewBox={`0 0 ${plotWidth} 172`} role="img" aria-label={showData ? `${performance.current_xp} XP registrados. ${performance.description}` : message}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".24"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
        {[floor, (ceiling + floor) / 2, ceiling].map(value => <g key={value}><line className={styles.chartGrid} x1="44" x2={plotWidth - 24} y1={y(value)} y2={y(value)}/><text className={styles.chartLabel} x="32" y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g>)}
        {[0, 6, 12, 18, 24].map(hour => <g key={hour}><line className={styles.chartGrid} x1={x(hour)} x2={x(hour)} y1="24" y2="140"/><text className={styles.chartLabel} x={x(hour)} y="164" textAnchor="middle">{String(hour).padStart(2, "0")}:00</text></g>)}
        {showData && reference && <polyline className={styles.referenceLine} points={reference}/>}
        {showData && points.length > 0 && <>
          <polygon fill={`url(#${gradientId})`} points={`${x(points[0].hour)},${y(0)} ${line} ${x(points[points.length - 1].hour)},${y(0)}`}/>
          <polyline className={styles.activityLine} points={line}/>
          {hasActivity && <circle cx={x(points[points.length - 1].hour)} cy={y(performance.current_xp)} r="4" fill="currentColor"/>}
        </>}
      </svg>
      {message && <div className={styles.chartMessage} role="status"><strong>{message}</strong><span>{error ? "Pulsa sincronizar para volver a intentarlo." : loading ? "Consultando los registros de esta fecha." : "Aquí verás cómo avanza tu actividad."}</span></div>}
    </div>
    {showData && <details className={styles.chartExplanation}>
      <summary>{performance.reference_xp != null ? `Referencia: ${performance.reference_xp.toLocaleString("es-ES", { maximumFractionDigits: 1 })} XP · ${performance.sample_days} jornadas` : "Cómo se calcula el color"}</summary>
      <p>{performance.description}</p>
      {performance.reason !== "compared" && <p>Verde: desde el 100 % de la referencia; naranja: 70–99 %; rojo: menos del 70 %. Sin una referencia suficiente, el gráfico queda neutro.</p>}
      <p>La línea discontinua representa la referencia histórica. Zona horaria: Europe/Madrid.</p>
    </details>}
  </div>;
}
