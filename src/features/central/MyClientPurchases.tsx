"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, CreditCard, PhoneCall, ShoppingBag, Sparkles, Trophy, Wallet } from "lucide-react";
import RegistrarLlamadaModal from "@/components/crm/RegistrarLlamadaModal";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./MyClientPurchases.module.css";

type Props = { clientId: string; client: any; tarotists: any[]; onRefresh: () => void; refreshVersion?: number };

type Payload = {
  rows: any[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
  stats: any;
  rank: any;
};

async function getToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || "";
}

function money(value: any, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(Number(value) || 0);
}

function dateTime(value: any) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const rankInfo: Record<string, { label: string; next: number | null; perks: string[] }> = {
  bronce: { label: "Bronce", next: 100, perks: ["Acceso al rango mensual Bronce"] },
  plata: { label: "Plata", next: 500, perks: ["Acceso al rango mensual Plata"] },
  oro: { label: "Oro", next: null, perks: ["Máximo rango mensual actual"] },
};

export default function MyClientPurchases({ clientId, client, tarotists, onRefresh, refreshVersion = 0 }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(`/api/central/my-clients/purchases?client_id=${encodeURIComponent(clientId)}&page=${page}&page_size=10`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudieron cargar las compras.");
      setData(payload);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las compras.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [clientId, page]);

  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    if (refreshVersion > 0) void load(false);
  }, [refreshVersion, load]);

  const maxMonthly = useMemo(() => Math.max(1, ...(data?.stats?.monthly || []).map((item: any) => Number(item.amount) || 0)), [data]);
  const rank = String(data?.rank?.current || "").toLowerCase();
  const rankMeta = rankInfo[rank] || { label: "Sin rango", next: 100, perks: [] };
  const progress = rankMeta.next ? Math.min(100, ((Number(data?.rank?.spent_30d) || 0) / rankMeta.next) * 100) : 100;

  if (loading) return <div className={styles.state}>Cargando compras reales…</div>;
  if (error) return <div className={styles.state}>{error}</div>;
  if (!data) return null;

  return (
    <div className={styles.root}>
      <div className={styles.statsGrid}>
        <article><Wallet /><span>Total gastado</span><strong>{money(data.stats.total_spent)}</strong></article>
        <article><ShoppingBag /><span>Total de compras</span><strong>{data.stats.total_purchases}</strong></article>
        <article><Sparkles /><span>Minutos comprados</span><strong>{data.stats.minutes_total || "Sin datos"}</strong><small>{data.stats.minutes_normal} normales · {data.stats.minutes_free} free</small></article>
        <article><CreditCard /><span>Compra media</span><strong>{money(data.stats.average_purchase)}</strong></article>
      </div>

      <div className={styles.analyticsGrid}>
        <section className={styles.panel}>
          <header><div><span className={styles.kicker}>COMPARACIÓN MENSUAL</span><h3>Evolución de compras</h3></div><BarChart3 /></header>
          <div className={styles.compare}>
            <div><span>Este mes</span><strong>{money(data.stats.current_month.amount)}</strong><small>{data.stats.current_month.purchases} compras</small></div>
            <div><span>Mes anterior</span><strong>{money(data.stats.previous_month.amount)}</strong><small>{data.stats.previous_month.purchases} compras</small></div>
            <div><span>Diferencia</span><strong className={(data.stats.difference || 0) >= 0 ? styles.positive : styles.negative}>{money(data.stats.difference)}</strong><small>{data.stats.percentage === null ? "Sin base comparable" : `${data.stats.percentage > 0 ? "+" : ""}${data.stats.percentage}%`}</small></div>
          </div>
          <div className={styles.chart}>
            {(data.stats.monthly || []).map((item: any) => <div key={item.month} className={styles.barItem}><div className={styles.barTrack}><div className={styles.bar} style={{ height: `${Math.max(5, (item.amount / maxMonthly) * 100)}%` }} /></div><small>{item.month.slice(5)}</small></div>)}
          </div>
        </section>

        <section className={styles.panel}>
          <header><div><span className={styles.kicker}>PREFERENCIAS DE COMPRA</span><h3>Hábitos reales</h3></div><Trophy /></header>
          <div className={styles.favorite}><span>Canal favorito</span><strong>{data.stats.favorite_method?.method || "Sin datos"}</strong><small>{data.stats.favorite_method ? `${data.stats.favorite_method.count} compras` : "Todavía no hay suficientes compras"}</small></div>
          <div className={styles.favorite}><span>Paquete favorito</span><strong>{data.stats.favorite_package?.package || "Sin datos"}</strong><small>{data.stats.favorite_package ? `${data.stats.favorite_package.count} compras` : "No hay paquete estructurado disponible"}</small></div>
        </section>
      </div>

      <div className={styles.actionGrid}>
        <section className={styles.panel}>
          <header><div><span className={styles.kicker}>OPERATIVA CRM</span><h3>Registrar llamada</h3></div><PhoneCall /></header>
          <p>Usa el mismo asistente del CRM. Actualiza minutos, rendimiento y genera la nota automática.</p>
          <div className={styles.balance}>{Number(client?.minutos_free_pendientes || 0)} free · {Number(client?.minutos_normales_pendientes || 0)} normales pendientes</div>
          <button type="button" className={styles.primaryButton} onClick={() => setRegisterOpen(true)}>REGISTRAR LLAMADA</button>
        </section>

        <section className={`${styles.panel} ${styles[`rank_${rank || "none"}`] || ""}`}>
          <header><div><span className={styles.kicker}>RANGO MENSUAL DE LA CLIENTA</span><h3>{rankMeta.label}</h3></div><Trophy /></header>
          <div className={styles.rankNumbers}><span>{money(data.rank.spent_30d)} en 30 días</span><span>{data.rank.purchases_30d} compras</span></div>
          <div className={styles.progressTrack}><div style={{ width: `${progress}%` }} /></div>
          <small>{data.rank.from} → {data.rank.to}</small>
          <div className={styles.perks}>{rankMeta.perks.map((perk) => <div key={perk}>✨ {perk}</div>)}</div>
        </section>
      </div>

      <section className={styles.panel}>
        <header><div><span className={styles.kicker}>HISTORIAL COMPLETO</span><h3>Compras y pagos</h3></div><span>{data.pagination.total} registros</span></header>
        <div className={styles.list}>
          {data.rows.length ? data.rows.map((row: any) => (
            <article key={`${row.source}-${row.id}`} className={styles.purchaseRow}>
              <div className={styles.methodBadge}>{row.method}</div>
              <div className={styles.purchaseMain}><strong>{money(row.amount, row.currency)}</strong><span>{row.package || row.notes || "Compra sin descripción"}</span><small>{dateTime(row.created_at)}</small></div>
              <div className={styles.purchaseMeta}><span>{row.minutes_total ? `${row.minutes_total} min` : "Minutos no disponibles"}</span><span className={styles.statusBadge}>{row.status}</span>{row.registered_by && <small>Registrada por {row.registered_by}</small>}</div>
            </article>
          )) : <div className={styles.empty}>Esta clienta todavía no tiene compras registradas.</div>}
        </div>
        <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft /> Anterior</button><span>Página {data.pagination.page} de {data.pagination.total_pages}</span><button disabled={page >= data.pagination.total_pages} onClick={() => setPage((p) => p + 1)}>Siguiente <ChevronRight /></button></div>
      </section>

      <RegistrarLlamadaModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        cliente={{ id: clientId, nombre: client?.nombre, apellido: client?.apellido, telefono: client?.telefono, minutos_free_pendientes: client?.minutos_free_pendientes, minutos_normales_pendientes: client?.minutos_normales_pendientes }}
        tarotistas={tarotists || []}
        getToken={getToken}
        onSuccess={async () => { setRegisterOpen(false); await load(false); onRefresh(); }}
      />
    </div>
  );
}
