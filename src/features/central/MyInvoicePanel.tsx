"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeEuro, CalendarDays, Coins, Crown, Sparkles, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./MyInvoicePanel.module.css";

export type MyInvoiceData = {
  worker: { id: string; display_name: string; team?: string | null };
  month: string;
  invoice: { id: string; status: string; updated_at?: string | null } | null;
  fixed_salary: number;
  rewards: number;
  total: number;
  previous: { month: string; total: number; exists: boolean; difference: number; variation_pct: number | null };
  lines: Array<{ id: string; kind: string; label: string; amount: number; created_at?: string | null }>;
  evolution: Array<{ at?: string | null; total: number; label: string }>;
  progress: { xp_month: number | null; total_xp: number | null; streak_days: number | null; loyalty_index: number | null; level: string | null; level_xp: number | null; next_level_xp: number | null; next_level_name: string | null };
  next_payment_at: string | null;
};

export type MyInvoiceFeed = ReturnType<typeof useMyInvoice>;
type Props = { feed: MyInvoiceFeed };
const sb = supabaseBrowser();
const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

export function useMyInvoice() {
  const [data, setData] = useState<MyInvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data: session } = await sb.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;
    try {
      const res = await fetch(`/api/central/my-invoice?t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar la factura");
      setData(json as MyInvoiceData); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar la factura"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!data?.worker.id) return;
    const channel = sb.channel(`central-my-invoice-${data.worker.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `worker_id=eq.${data.worker.id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_lines", filter: `invoice_id=eq.${data.invoice?.id || "00000000-0000-0000-0000-000000000000"}` }, () => void load())
      .subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [data?.worker.id, data?.invoice?.id, load]);
  return { data, loading, error, reload: load };
}

export default function MyInvoicePanel({ feed }: Props) {
  const { data, loading, error } = feed;
  const max = useMemo(() => Math.max(1, ...(data?.evolution || []).map((point) => point.total)), [data]);
  if (loading) return <section className={styles.state}>Cargando tu factura…</section>;
  if (!data) return <section className={styles.state}>{error || "No se pudo cargar tu factura."}</section>;
  const variation = data.previous.variation_pct;
  const up = (variation || 0) >= 0;
  return <section className={styles.root}>
    <header className={styles.hero}>
      <div><span>FACTURA INTELIGENTE</span><h1>Tu esfuerzo se convierte en resultados</h1><p>Consulta tu factura mensual con los mismos datos reales de Facturación Admin.</p></div>
      <div className={styles.heroTotal}><small>TOTAL ACTUAL</small><strong>{eur(data.total)}</strong><em>{data.invoice ? `Factura ${data.invoice.status}` : "Acumulado actual"}</em></div>
    </header>

    <div className={styles.grid}>
      <div className={styles.main}>
        <div className={styles.cards}>
          <article><WalletCards/><div><span>NÓMINA FIJA</span><strong>{eur(data.fixed_salary)}</strong><small>Configurada en la ficha real del trabajador</small></div></article>
          <article><Coins/><div><span>RECOMPENSAS</span><strong>{eur(data.rewards)}</strong><small>Bonos/recompensas incluidos en la factura</small></div></article>
          <article><Sparkles/><div><span>XP GANADO ESTE MES</span><strong>{data.progress.xp_month == null ? "—" : `${data.progress.xp_month} XP`}</strong><small>Informativo · nunca se suma al total económico</small></div></article>
        </div>

        <article className={styles.chartCard}><div className={styles.sectionTitle}><div><Crown/><span>EVOLUCIÓN DE LA FACTURA</span></div><strong>{eur(data.total)}</strong></div>
          <div className={styles.chart}>{data.evolution.map((point, i) => <div key={`${point.label}-${i}`} className={styles.barWrap} title={`${point.label}: ${eur(point.total)}`}><div className={styles.bar} style={{ height: `${Math.max(8, (point.total / max) * 100)}%` }}/><span>{i + 1}</span></div>)}</div>
          <div className={styles.legend}>{data.evolution.length <= 1 ? "Sin movimientos adicionales este mes: la línea permanece estable en la nómina fija." : "La evolución aumenta únicamente con movimientos económicos reales de la factura."}</div>
        </article>
      </div>

      <aside className={styles.side}>
        <article className={styles.summary}><BadgeEuro/><span>RESUMEN DE TU FACTURA</span><strong>{eur(data.total)}</strong>
          <div><b>Nómina fija</b><b>{eur(data.fixed_salary)}</b></div><div><b>Recompensas</b><b>{eur(data.rewards)}</b></div><div className={styles.totalRow}><b>Total</b><b>{eur(data.total)}</b></div><div><b>XP este mes</b><b>{data.progress.xp_month == null ? "No disponible" : `${data.progress.xp_month} XP`}</b></div>
        </article>
        <article className={styles.compare}>{up ? <TrendingUp/> : <TrendingDown/>}<span>COMPARACIÓN MENSUAL</span><div><b>Este mes</b><b>{eur(data.total)}</b></div><div><b>Mes anterior</b><b>{data.previous.exists ? eur(data.previous.total) : "Sin factura"}</b></div><div><b>Diferencia</b><b>{data.previous.exists ? eur(data.previous.difference) : "—"}</b></div><strong>{variation == null ? "Sin comparación disponible" : `${variation >= 0 ? "+" : ""}${variation.toLocaleString("es-ES")} % vs mes anterior`}</strong></article>
        <article className={styles.payment}><CalendarDays/><span>PRÓXIMO PAGO</span><strong>{data.next_payment_at ? new Date(data.next_payment_at).toLocaleDateString("es-ES") : "Sin fecha configurada"}</strong><small>No se inventa una fecha si Facturación no la tiene definida.</small></article>
      </aside>
    </div>
  </section>;
}
