"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Coins, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { CentralXpData } from "./useCentralXpData";
import styles from "./CentralXpCoinsPanel.module.css";

type Props = {
  data: CentralXpData | null;
  error: string;
  busy: boolean;
  load: (silent?: boolean) => Promise<boolean>;
  exchangeXp: (xp: number, operationId: string) => Promise<unknown>;
};

const fmt = (value: number) => Number(value || 0).toLocaleString("es-ES");

export default function CentralXpCoinsPanel({ data, error, busy, load, exchangeXp }: Props) {
  const exchange = data?.coin_exchange;
  const ratio = exchange?.ratio;
  const step = Math.max(1, ratio?.xp_units || 1);
  const minimum = Math.max(step, ratio?.min_xp || step);
  const max = Math.floor(Number(exchange?.available_xp || 0) / step) * step;
  const [amount, setAmount] = useState(minimum);
  const [confirming, setConfirming] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setAmount((current) => Math.min(max || minimum, Math.max(minimum, Math.floor(current / step) * step))), [max, minimum, step]);
  const coins = useMemo(() => ratio ? Math.floor(amount / ratio.xp_units) * ratio.coin_units : 0, [amount, ratio]);
  const valid = Boolean(exchange?.available && exchange.enabled && ratio && amount >= minimum && amount <= max && amount % step === 0);

  function requestConfirmation() {
    if (!valid) return;
    setOperationId(crypto.randomUUID());
    setMessage("");
    setConfirming(true);
  }
  async function confirm() {
    if (!operationId || submitting) return;
    setSubmitting(true);
    try {
      await exchangeXp(amount, operationId);
      setMessage(`Canje completado: +${fmt(coins)} Coins.`);
      setConfirming(false);
      setOperationId("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo completar el canje");
    } finally { setSubmitting(false); }
  }

  if (!data && busy) return <div className={styles.state}>Cargando saldo real…</div>;
  return <section className={styles.page}>
    <header className={styles.hero}>
      <div><span><Sparkles size={14}/> TU SISTEMA XP</span><h1>Canjear XP por Coins</h1><p>Convierte voluntariamente XP disponible. Tu XP histórico y tu nivel no disminuyen.</p></div>
      <button onClick={() => void load()} disabled={busy}><RefreshCw size={16}/> Actualizar</button>
    </header>
    {error ? <div className={styles.error}>{error}</div> : null}
    {!exchange?.available ? <div className={styles.notice}>El canje estará disponible al ejecutar <b>SQL_NECESARIO.sql</b> en Supabase.</div> : null}
    <div className={styles.balances}>
      <article><small>XP HISTÓRICO</small><strong>{fmt(exchange?.historical_xp || 0)} XP</strong><p>Se conserva para nivel y progreso.</p></article>
      <article><small>XP DISPONIBLE</small><strong>{fmt(exchange?.available_xp || 0)} XP</strong><p>Histórico menos XP ya canjeado.</p></article>
      <article className={styles.coins}><small>SALDO COINS</small><strong><Coins size={22}/>{fmt(exchange?.coin_balance || 0)}</strong><p>Cartera real de la telefonista.</p></article>
    </div>
    <div className={styles.exchangeBox}>
      <div className={styles.title}><div><small>CONVERSIÓN CONFIGURADA</small><h2>{ratio ? `${fmt(ratio.xp_units)} XP = ${fmt(ratio.coin_units)} Coins` : "Sin configuración"}</h2></div><ShieldCheck size={24}/></div>
      <label>XP que quieres canjear
        <input type="number" min={minimum} max={max} step={step} value={amount} onChange={(event) => setAmount(Number(event.target.value) || 0)} disabled={!exchange?.enabled}/>
      </label>
      <input className={styles.range} type="range" min={minimum} max={Math.max(minimum, max)} step={step} value={Math.min(Math.max(minimum, amount), Math.max(minimum, max))} onChange={(event) => setAmount(Number(event.target.value))} disabled={!exchange?.enabled || max < minimum}/>
      <div className={styles.preview}><span>{fmt(amount)} XP</span><ArrowRight/><strong>+{fmt(coins)} Coins</strong></div>
      <button className={styles.primary} disabled={!valid || submitting} onClick={requestConfirmation}>{exchange?.enabled ? "Revisar canje" : "Canje desactivado"}</button>
      {message ? <p className={message.startsWith("Canje completado") ? styles.success : styles.errorText}>{message}</p> : null}
    </div>
    <div className={styles.history}><h2>Historial de canjes</h2>{exchange?.history?.length ? exchange.history.map((item) => <div key={item.id}><span><b>{fmt(item.xp_spent)} XP</b><small>{new Date(item.created_at).toLocaleString("es-ES")}</small></span><strong>+{fmt(item.coins_granted)} Coins</strong></div>) : <p>Todavía no has realizado ningún canje.</p>}</div>
    {confirming ? <div className={styles.backdrop}><div className={styles.modal}><Coins size={30}/><h2>Confirmar canje</h2><p>Vas a convertir <b>{fmt(amount)} XP disponibles</b> en <b>{fmt(coins)} Coins</b>. Tu XP histórico y tu nivel se conservarán.</p><div><button onClick={() => setConfirming(false)} disabled={submitting}>Cancelar</button><button className={styles.primary} onClick={() => void confirm()} disabled={submitting}>{submitting ? "Procesando…" : "Confirmar"}</button></div></div></div> : null}
  </section>;
}
