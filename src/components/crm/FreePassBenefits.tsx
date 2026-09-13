"use client";
import { useRef, useState } from "react";
import styles from "./CRMNuevaEra.module.css";

export type FreePassStatus = {
  eligible_until?: string | null;
  eligible: boolean; total: number; available: number; used: number;
  minutes: number; cycle_days: number; cycle_start: string | null; renews_at: string | null;
};
export default function FreePassBenefits({ benefits, clienteId, getToken, onRefresh }: {
  benefits?: FreePassStatus | null;
  clienteId?: string;
  getToken?: () => Promise<string>;
  onRefresh?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const locked = useRef(false);
  // Keep the exact operation after an uncertain network response, even if Realtime updates.
  const pending = useRef<{ request_id: string; cycle_start: string; expected_used: number } | null>(null);
  async function consume() {
    if (locked.current || !getToken || !clienteId || !benefits?.cycle_start) return;
    locked.current = true; setBusy(true); setMessage("");
    try {
      pending.current ??= { request_id: crypto.randomUUID(), cycle_start: benefits.cycle_start, expected_used: benefits.used };
      const token = await getToken();
      if (!token) throw new Error("Vuelve a iniciar sesión.");
      const response = await fetch("/api/crm/clientes/pases", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cliente_id: clienteId, ...pending.current }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        if (json.refresh) { pending.current = null; await onRefresh?.(); }
        throw new Error(json.error || "No se pudo confirmar el pase.");
      }
      pending.current = null;
      setMessage(json.replayed ? "Este pase ya estaba acreditado. No se ha consumido otro." : "Pase acreditado en el saldo FREE.");
      await onRefresh?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo confirmar el pase. Reintenta para comprobarlo.");
    } finally { locked.current = false; setBusy(false); }
  }
  return <section className={styles.benefits} aria-label="Beneficios del cliente" aria-busy={busy}>
    <div className={styles.eyebrow}>Beneficios del cliente</div>
    {benefits ? <>
      <div className={styles.passCount}><strong>{benefits.available} <span>/ {benefits.total}</span></strong><span>Pases FREE disponibles</span></div>
      <p>{benefits.minutes} minutos FREE por pase · Cada {benefits.cycle_days} días</p>
      {benefits.eligible && <p>Habilitados por una compra en los últimos 4 meses. Comprar de nuevo no añade pases ni reinicia el ciclo.</p>}
      {!benefits.eligible ? <p>Sin pases habilitados: se necesita una compra confirmada en los últimos 4 meses.</p> : benefits.renews_at ? <p>Renovación: {new Date(benefits.renews_at).toLocaleDateString("es-ES")} · No se acumulan.</p> : null}
      {getToken && <button type="button" className="tc-btn tc-btn-gold" disabled={busy || (!pending.current && benefits.available < 1)} onClick={() => void consume()}>{busy ? "Confirmando…" : pending.current ? "Comprobar operación" : "Usar 1 pase"}</button>}
    </> : <p>No se pudieron consultar los pases. Actualiza la ficha para comprobarlos.</p>}
    <div role="status" className={styles.feedback}>{message}</div>
  </section>;
}
