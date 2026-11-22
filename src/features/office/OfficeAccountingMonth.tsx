"use client";

import { useEffect, useState } from "react";
import { Landmark, LockKeyhole } from "lucide-react";
import { ACCOUNT_LABELS, formatMoney } from "@/lib/accounting";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { accountingAccessExpired, accountingRequest, accountingSessionIdentity } from "@/features/accounting/accounting-client";
import type { OfficeAccountingReport } from "./office-accounting-report";
import styles from "./OfficeMonthlyReport.module.css";

type Result = { ok: true; expiresAt: string; report: OfficeAccountingReport };
type Session = { unlocked: boolean; expiresAt?: string };
type Panel = { state: "checking" | "locked" | "error"; message?: string } | { state: "open"; report: OfficeAccountingReport };

export default function OfficeAccountingMonth({ month, area }: { month: string; area: string }) {
  const [panel, setPanel] = useState<Panel>({ state: "checking" });
  useEffect(() => {
    let active = true;
    let generation = 0;
    let expiryTimer: number | undefined;
    let loaded = false;
    let identity: string | null = null;

    function clear(state: "checking" | "locked" | "error", message?: string) {
      generation++;
      loaded = false;
      window.clearTimeout(expiryTimer);
      if (active) setPanel({ state, message });
    }
    function scheduleExpiry(expiresAt?: string) {
      window.clearTimeout(expiryTimer);
      const expires = expiresAt ? Date.parse(expiresAt) : NaN;
      if (!Number.isFinite(expires) || expires <= Date.now()) { clear("locked"); return false; }
      expiryTimer = window.setTimeout(() => clear("locked"), expires - Date.now());
      return true;
    }
    async function check() {
      if (!active || document.visibilityState === "hidden") return;
      const current = ++generation;
      try {
        if (loaded) {
          const session = await accountingRequest<Session>("/session");
          if (!active || current !== generation) return;
          if (!session.unlocked) { clear("locked"); return; }
          scheduleExpiry(session.expiresAt);
          return;
        }
        const result = await accountingRequest<Result>("/informe-mensual?mes=" + encodeURIComponent(month));
        if (!active || current !== generation || !scheduleExpiry(result.expiresAt)) return;
        if (result.report.month !== month) throw new Error("El libro devolvió otro periodo.");
        loaded = true;
        setPanel({ state: "open", report: result.report });
      } catch (cause) {
        if (!active || current !== generation) return;
        if (accountingAccessExpired(cause)) clear("locked");
        else clear("error", "No se pudo verificar el libro de Contabilidad. Actualiza el informe para reintentar.");
      }
    }
    const hide = () => clear("checking");
    const focus = () => { if (document.visibilityState !== "hidden") { hide(); void check(); } };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); else focus(); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("tc-accounting-access");
    if (channel) channel.onmessage = event => {
      if (event.data === "locked") clear("locked");
      else if (event.data === "changed") focus();
    };
    const { data } = supabaseBrowser().auth.onAuthStateChange((event, session) => {
      const nextIdentity = accountingSessionIdentity(session);
      const changed = identity !== null && identity !== nextIdentity;
      identity = nextIdentity;
      if (event === "SIGNED_OUT" || changed) clear("locked");
    });
    void check();
    const poll = window.setInterval(() => void check(), 30000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", focus);
    return () => {
      active = false;
      generation++;
      window.clearTimeout(expiryTimer);
      window.clearInterval(poll);
      channel?.close();
      data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", focus);
    };
  }, [month]);

  const accountingLink = "/admin/contabilidad?" + new URLSearchParams({ oficina: area, mes: month });
  const report = panel.state === "open" ? panel.report : null;
  return <section className={styles.section} aria-label="Libro de Contabilidad">
    <div className={styles.sectionTitle}><Landmark size={19} aria-hidden="true" /><h3>Libro de Contabilidad</h3></div>
    {report ? <>
      <p className={styles.note}>Del {report.from} al {report.through} · Madrid. Movimientos vigentes en cada libro, en su moneda original.</p>
      <div className={styles.scroll}><table className={styles.table}>
        <caption>Resultado por cuenta y moneda</caption>
        <thead><tr>{["Cuenta", "Moneda", "Ingresos", "Gastos", "Resultado"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>{report.accounts.map(row => <tr key={row.account + row.currency}>
          <th scope="row">{ACCOUNT_LABELS[row.account]}</th><td>{row.currency}</td>
          <td>{formatMoney(row.income, row.currency)}</td><td>{formatMoney(row.expense, row.currency)}</td><td>{formatMoney(row.net, row.currency)}</td>
        </tr>)}</tbody></table></div>
      <details className={styles.details}><summary>Saldos, bóveda y traspasos</summary>
        <div className={styles.scroll}><table className={styles.table}>
          <caption>Disponible y bóveda al inicio y al corte</caption>
          <thead><tr>{["Cuenta y moneda", "Disponible inicial", "Disponible al corte", "Bóveda inicial", "Bóveda al corte", "Traspasos recibidos", "Traspasos enviados"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
          <tbody>{report.accounts.map(row => <tr key={row.account + row.currency}><th scope="row">{ACCOUNT_LABELS[row.account]} · {row.currency}</th>
            {[row.opening, row.available, row.openingVault, row.vault, row.transferIn, row.transferOut].map((cents, index) => <td key={index}>{formatMoney(cents, row.currency)}</td>)}
          </tr>)}</tbody></table></div>
      </details>
      <details className={styles.details}><summary>Ingresos y gastos por categoría</summary>
        {report.categories.length ? <div className={styles.scroll}><table className={styles.table}>
          <caption>Categorías registradas en el libro</caption>
          <thead><tr>{["Cuenta", "Categoría", "Movimiento", "Moneda", "Importe"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
          <tbody>{report.categories.map((row, index) => <tr key={index}><th scope="row">{ACCOUNT_LABELS[row.account]}</th><td>{row.name}</td>
            <td>{row.kind === "income" ? "Ingreso" : "Gasto"}</td><td>{row.currency}</td><td>{formatMoney(row.amount, row.currency)}</td></tr>)}</tbody>
        </table></div> : <p className={styles.note}>Sin ingresos ni gastos registrados en el periodo.</p>}
      </details>
    </> : <div className={styles.lock} role="status">
      <LockKeyhole size={21} aria-hidden="true" />
      <div><strong>{panel.state === "checking" ? "Comprobando acceso privado…" : panel.state === "locked" ? "Contabilidad bloqueada" : "Lectura de Contabilidad pendiente"}</strong>
        {panel.state === "locked" && <p>Desbloquea Contabilidad con su contraseña para consultar el libro de este mes.</p>}
        {panel.state === "error" && <p>{panel.message}</p>}</div>
    </div>}
    {panel.state !== "checking" && <a className={styles.link} href={accountingLink}>{report ? "Abrir Contabilidad" : "Ir a Contabilidad"}</a>}
  </section>;
}
