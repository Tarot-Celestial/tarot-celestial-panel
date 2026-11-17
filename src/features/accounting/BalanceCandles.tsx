"use client";

import { useId, useState } from "react";
import { CandlestickChart } from "lucide-react";
import { formatMoney, type Currency, type Candle } from "@/lib/accounting";
import styles from "./accounting.module.css";

export default function BalanceCandles({ candles, currency }: { candles: Candle[]; currency: Currency }) {
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const titleId = useId();
  if (!candles.length) return <div className={styles.chartEmpty}>
    <CandlestickChart size={40} strokeWidth={1.2} /><strong>La historia empieza con tu primer movimiento</strong>
    <p>Cuando registres ingresos o gastos verás las velas reales de tu saldo. No hay datos de muestra.</p>
  </div>;
  const selected = candles.find(candle => candle.date === focusedDate) || candles[candles.length - 1];
  let low = Infinity, high = -Infinity;
  for (const candle of candles) { low = Math.min(low, candle.low); high = Math.max(high, candle.high); }
  const padding = Math.max(100, (high - low) * .15);
  const lower = low - padding, upper = high + padding;
  const width = Math.max(720, candles.length * 18 + 110), height = 292;
  const top = 16, bottom = height - 38, left = 18, right = width - 100;
  const y = (value: number) => top + (upper - value) / (upper - lower) * (bottom - top);
  const step = (right - left) / candles.length;
  const candleWidth = Math.max(3, Math.min(15, step * .55));
  const tickSpacing = Math.max(1, Math.ceil(candles.length / 7));
  return <div>
    <div className={styles.ohlc} aria-live="polite"><strong>{selected.date.split("-").reverse().join("/")}</strong>
      <span>Apertura <b>{formatMoney(selected.open, currency)}</b></span><span>Máximo <b>{formatMoney(selected.high, currency)}</b></span>
      <span>Mínimo <b>{formatMoney(selected.low, currency)}</b></span><span>Cierre <b className={selected.close >= selected.open ? styles.positive : styles.negative}>{formatMoney(selected.close, currency)}</b></span>
    </div>
    <div className={styles.chartScroll} tabIndex={0} aria-label="Gráfica de velas. Desplaza horizontalmente si hay muchos días.">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId} className={styles.chartSvg}>
        <title id={titleId}>Saldo disponible por día. Cada vela muestra apertura, máximo, mínimo y cierre; verde si el saldo subió, rojo si bajó.</title>
        {[0, 1, 2, 3, 4].map(index => {
          const value = lower + (upper - lower) * index / 4;
          return <g key={index}><line x1={left} x2={right + 12} y1={y(value)} y2={y(value)} stroke="rgba(173,185,208,.12)" strokeDasharray="3 5" /><text x={right + 22} y={y(value) + 4} fill="#95a0b8" fontSize="10" fontFamily="ui-monospace, monospace">{formatMoney(Math.round(value), currency)}</text></g>;
        })}
        {candles.map((candle, index) => {
          const x = left + step * (index + .5), rising = candle.close >= candle.open;
          const color = rising ? "#58d7b5" : "#fb7e92";
          const bodyY = y(Math.max(candle.open, candle.close));
          return <g key={candle.date} tabIndex={0} role="img" aria-label={`${candle.date}: apertura ${formatMoney(candle.open, currency)}, máximo ${formatMoney(candle.high, currency)}, mínimo ${formatMoney(candle.low, currency)}, cierre ${formatMoney(candle.close, currency)}`} onMouseEnter={() => setFocusedDate(candle.date)} onFocus={() => setFocusedDate(candle.date)}>
            <rect x={x - step / 2} y={top} width={step} height={bottom - top} fill={selected.date === candle.date ? "rgba(184,159,235,.05)" : "transparent"} />
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth={1.5} />
            <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={Math.max(2, Math.abs(y(candle.open) - y(candle.close)))} fill={color} rx={1} />
            {index % tickSpacing === 0 || index === candles.length - 1 ? <text x={x} y={height - 12} textAnchor="middle" fill="#95a0b8" fontSize="10">{candle.date.slice(5).split("-").reverse().join("/")}</text> : null}
          </g>;
        })}
      </svg>
    </div>
    <p className={styles.chartCaption}><span className={styles.greenDot} /> Sube <span className={styles.redDot} /> Baja <span>Una vela por día con movimientos · datos contables, no cotizaciones</span></p>
  </div>;
}
