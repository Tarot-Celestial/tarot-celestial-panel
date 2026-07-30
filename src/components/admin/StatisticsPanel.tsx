"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeEuro,
  BarChart3,
  CheckCircle2,
  Clock3,
  Coins,
  Crown,
  Flame,
  Gauge,
  Medal,
  PhoneCall,
  RefreshCw,
  Repeat2,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
  Waves,
} from "lucide-react";
import styles from "./StatisticsPanel.module.css";

type LiveStatus = "connecting" | "live" | "updating" | "reconnecting" | "offline";
type Trend = "up" | "down" | "neutral";
type Tone = "positive" | "negative" | "neutral";
type Accent = "gold" | "purple" | "green" | "blue" | "pink" | "orange";

type StatisticsPanelProps = {
  month: string;
  loading: boolean;
  message: string;
  liveStatus: LiveStatus;
  totals: any;
  previousTotals: any;
  rows: any[];
  previousRows: any[];
  top: any;
  teams: any;
  invoices: any[];
  previousInvoiceSummary: any;
  onRefresh: () => void;
};

type Comparison = {
  trend: Trend;
  tone: Tone;
  percent: number | null;
  label: string;
  hasPrevious: boolean;
};

type MetricDefinition = {
  key: string;
  label: string;
  value: string;
  current: number;
  previous: number | null;
  icon: LucideIcon;
  accent: Accent;
  inverse?: boolean;
  detail: string;
};

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eur(value: unknown) {
  return safeNumber(value).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function numES(value: unknown, digits = 2) {
  return safeNumber(value).toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function monthLabel(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) return monthKey || "Mes seleccionado";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return capitalize(new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(date));
}

function comparison(current: number, previous: number | null, inverse = false): Comparison {
  if (previous === null || previous === undefined || !Number.isFinite(Number(previous))) {
    return { trend: "neutral", tone: "neutral", percent: null, label: "Sin datos anteriores", hasPrevious: false };
  }

  const safeCurrent = safeNumber(current);
  const safePrevious = safeNumber(previous);
  if (Math.abs(safeCurrent - safePrevious) < 0.0001) {
    return { trend: "neutral", tone: "neutral", percent: 0, label: "Sin variación", hasPrevious: true };
  }

  const trend: Trend = safeCurrent > safePrevious ? "up" : "down";
  const improved = inverse ? trend === "down" : trend === "up";
  if (safePrevious === 0) {
    return {
      trend,
      tone: "neutral",
      percent: null,
      label: safeCurrent === 0 ? "Sin variación" : "Nuevo periodo",
      hasPrevious: true,
    };
  }

  const percent = ((safeCurrent - safePrevious) / Math.abs(safePrevious)) * 100;
  return {
    trend,
    tone: improved ? "positive" : "negative",
    percent,
    label: `${percent > 0 ? "+" : ""}${numES(percent, 2)} %`,
    hasPrevious: true,
  };
}

function invoiceSummary(invoices: any[]) {
  const list = invoices || [];
  return {
    count: list.length,
    invoice_total: list.reduce((sum, invoice) => sum + safeNumber(invoice?.total), 0),
    accepted: list.filter((invoice) => String(invoice?.worker_ack || "") === "accepted").length,
    rejected: list.filter((invoice) => String(invoice?.worker_ack || "") === "rejected").length,
    review: list.filter((invoice) => String(invoice?.worker_ack || "") === "review").length,
    pending: list.filter((invoice) => !invoice?.worker_ack || String(invoice?.worker_ack) === "pending").length,
  };
}

function ackLabel(value: unknown) {
  const status = String(value || "pending");
  if (status === "accepted") return "Aceptada";
  if (status === "rejected") return "Rechazada";
  if (status === "review") return "Revisión";
  return "Pendiente";
}

function liveMeta(status: LiveStatus) {
  if (status === "live") return { label: "En vivo", className: styles.live };
  if (status === "updating") return { label: "Actualizando", className: styles.updating };
  if (status === "reconnecting") return { label: "Reconectando", className: styles.reconnecting };
  if (status === "offline") return { label: "Sin conexión", className: styles.offline };
  return { label: "Conectando", className: styles.connecting };
}

function Sparkline({ current, previous, comparisonValue }: { current: number; previous: number | null; comparisonValue: Comparison }) {
  const hasPrevious = previous !== null && previous !== undefined;
  const first = hasPrevious ? Math.max(0, safeNumber(previous)) : Math.max(0, safeNumber(current));
  const last = Math.max(0, safeNumber(current));
  const maxValue = Math.max(first, last, 1);
  const firstY = 30 - (first / maxValue) * 20;
  const lastY = 30 - (last / maxValue) * 20;
  const controlY = (firstY + lastY) / 2;
  const path = `M 4 ${firstY.toFixed(2)} C 28 ${firstY.toFixed(2)}, 46 ${controlY.toFixed(2)}, 82 ${lastY.toFixed(2)}`;

  return (
    <svg className={`${styles.sparkline} ${styles[`sparkline${capitalize(comparisonValue.tone)}`]}`} viewBox="0 0 86 36" aria-hidden="true">
      <path className={styles.sparkArea} d={`${path} L 82 34 L 4 34 Z`} />
      <path className={styles.sparkPath} d={path} />
      <circle className={styles.sparkPoint} cx="4" cy={firstY} r="2.4" />
      <circle className={styles.sparkPoint} cx="82" cy={lastY} r="2.8" />
    </svg>
  );
}

function TrendBadge({ value, previous, inverse = false }: { value: number; previous: number | null; inverse?: boolean }) {
  const result = comparison(value, previous, inverse);
  const Icon = result.trend === "up" ? TrendingUp : result.trend === "down" ? TrendingDown : Activity;
  return (
    <span className={`${styles.trendBadge} ${styles[`trend${capitalize(result.tone)}`]}`}>
      <Icon size={13} />
      {result.label}
    </span>
  );
}

function MetricCard({ metric, previousMonth }: { metric: MetricDefinition; previousMonth: string }) {
  const Icon = metric.icon;
  const result = comparison(metric.current, metric.previous, metric.inverse);
  return (
    <article className={`${styles.metricCard} ${styles[`accent${capitalize(metric.accent)}`]} ${styles[`tone${capitalize(result.tone)}`]}`}>
      <span className={styles.metricGlow} aria-hidden="true" />
      <div className={styles.metricTop}>
        <span className={styles.metricIcon}><Icon size={19} /></span>
        <span className={styles.metricCode}>{metric.key}</span>
      </div>
      <div className={styles.metricLabel}>{metric.label}</div>
      <strong className={styles.metricValue}>{metric.value}</strong>
      <div className={styles.metricVisual}>
        <Sparkline current={metric.current} previous={metric.previous} comparisonValue={result} />
        <span className={`${styles.metricTrend} ${styles[`trend${capitalize(result.tone)}`]}`}>
          {result.trend === "up" ? <TrendingUp size={14} /> : result.trend === "down" ? <TrendingDown size={14} /> : <Activity size={14} />}
          {result.label}
        </span>
      </div>
      <div className={styles.metricFoot}>
        <span>{metric.detail}</span>
        <span>{result.hasPrevious ? `vs. ${previousMonth}` : "Histórico no disponible"}</span>
      </div>
    </article>
  );
}

function RankingCard({
  title,
  icon: Icon,
  rows,
  valueKey,
  valueFormatter,
  invoiceByWorker,
}: {
  title: string;
  icon: LucideIcon;
  rows: any[];
  valueKey: string;
  valueFormatter: (row: any) => string;
  invoiceByWorker: Map<string, any>;
}) {
  const visible = (rows || []).slice(0, 5);
  const leaderValue = Math.max(0, safeNumber(visible[0]?.[valueKey]));

  return (
    <section className={styles.rankingCard}>
      <div className={styles.sectionHeaderCompact}>
        <span className={styles.sectionIcon}><Icon size={19} /></span>
        <div>
          <span className={styles.sectionKicker}>Clasificación mensual</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className={styles.rankingList}>
        {visible.map((row, index) => {
          const value = Math.max(0, safeNumber(row?.[valueKey]));
          const previousRankValue = index > 0 ? Math.max(0, safeNumber(visible[index - 1]?.[valueKey])) : null;
          const gap = previousRankValue === null ? null : Math.max(0, previousRankValue - value);
          const progress = leaderValue > 0 ? Math.max(3, Math.min(100, (value / leaderValue) * 100)) : 0;
          const invoice = invoiceByWorker.get(String(row?.worker_id || ""));
          return (
            <article key={`${row?.worker_id || row?.display_name}-${index}`} className={`${styles.rankingRow} ${styles[`rank${Math.min(index + 1, 4)}`]}`}>
              <div className={styles.rankPosition}>
                {index === 0 ? <Medal size={20} /> : index === 1 ? <Medal size={19} /> : index === 2 ? <Medal size={18} /> : <span>{index + 1}</span>}
              </div>
              <span className={styles.avatar}>{String(row?.display_name || "?").trim().charAt(0).toUpperCase()}</span>
              <div className={styles.rankMain}>
                <div className={styles.rankNameLine}>
                  <strong>{row?.display_name || "—"}</strong>
                  <span className={`${styles.teamBadge} ${String(row?.team || "").toLowerCase() === "fuego" ? styles.teamFire : styles.teamWater}`}>
                    {String(row?.team || "").toLowerCase() === "fuego" ? "🔥 Fuego" : String(row?.team || "").toLowerCase() === "agua" ? "💧 Agua" : "Sin equipo"}
                  </span>
                </div>
                <div className={styles.rankProgress}><span style={{ width: `${progress}%` }} /></div>
                <div className={styles.rankMeta}>
                  <span>{index === 0 ? "Líder del ranking" : `A ${numES(gap || 0, valueKey.includes("pct") ? 2 : 0)} del puesto anterior`}</span>
                  {invoice ? <span>{eur(invoice.total || 0)} facturados</span> : null}
                </div>
              </div>
              <strong className={styles.rankValue}>{valueFormatter(row)}</strong>
            </article>
          );
        })}
        {!visible.length ? <div className={styles.emptyState}>Sin datos reales para este ranking.</div> : null}
      </div>
    </section>
  );
}

function TeamBattle({ teams, rows, invoiceByWorker }: { teams: any; rows: any[]; invoiceByWorker: Map<string, any> }) {
  const buildTeam = (team: "fuego" | "agua") => {
    const members = (rows || []).filter((row) => String(row?.team || "").toLowerCase() === team);
    return {
      key: team,
      score: safeNumber(teams?.[team]?.score),
      members: safeNumber(teams?.[team]?.members),
      minutes: members.reduce((sum, row) => sum + safeNumber(row?.minutes_total), 0),
      calls: members.reduce((sum, row) => sum + safeNumber(row?.calls_total), 0),
      captadas: members.reduce((sum, row) => sum + safeNumber(row?.captadas_total), 0),
      invoice: members.reduce((sum, row) => sum + safeNumber(invoiceByWorker.get(String(row?.worker_id || ""))?.total), 0),
    };
  };

  const fire = buildTeam("fuego");
  const water = buildTeam("agua");
  const maxScore = Math.max(fire.score, water.score, 1);
  const winner = String(teams?.winner || "empate").toLowerCase();
  const difference = Math.abs(fire.score - water.score);

  const TeamCard = ({ team }: { team: ReturnType<typeof buildTeam> }) => {
    const isFire = team.key === "fuego";
    const isWinner = winner === team.key;
    return (
      <article className={`${styles.teamCard} ${isFire ? styles.fireCard : styles.waterCard} ${isWinner ? styles.teamWinner : ""}`}>
        <div className={styles.teamTop}>
          <span className={styles.teamEmblem}>{isFire ? <Flame size={28} /> : <Waves size={28} />}</span>
          <div>
            <span className={styles.sectionKicker}>Equipo {capitalize(team.key)}</span>
            <h3>{numES(team.score, 2)} pts</h3>
          </div>
          {isWinner ? <span className={styles.winnerBadge}><Crown size={14} /> Ganador</span> : null}
        </div>
        <div className={styles.teamMeter}><span style={{ width: `${Math.max(4, (team.score / maxScore) * 100)}%` }} /></div>
        <div className={styles.teamStats}>
          <div><span>Integrantes</span><strong>{numES(team.members, 0)}</strong></div>
          <div><span>Minutos</span><strong>{numES(team.minutes, 0)}</strong></div>
          <div><span>Llamadas</span><strong>{numES(team.calls, 0)}</strong></div>
          <div><span>Captadas</span><strong>{numES(team.captadas, 0)}</strong></div>
          <div className={styles.teamInvoice}><span>Facturación</span><strong>{eur(team.invoice)}</strong></div>
        </div>
      </article>
    );
  };

  return (
    <section className={styles.battleCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitleGroup}>
          <span className={styles.sectionIcon}><Trophy size={20} /></span>
          <div>
            <span className={styles.sectionKicker}>Arena de equipos</span>
            <h3>Fuego vs Agua</h3>
            <p>La puntuación conserva exactamente la fórmula actual del sistema.</p>
          </div>
        </div>
        <span className={styles.gameChip}>Diferencia: {numES(difference, 2)} pts</span>
      </div>
      <div className={styles.battleGrid}>
        <TeamCard team={fire} />
        <div className={styles.vsBadge}>VS</div>
        <TeamCard team={water} />
      </div>
    </section>
  );
}

function MinutesTrend({ current, previous }: { current: number; previous: number | null }) {
  const result = comparison(current, previous);
  return (
    <div className={styles.minutesTrend} title={result.hasPrevious ? `${numES(current, 0)} min frente a ${numES(previous || 0, 0)} min` : "Sin datos anteriores"}>
      <strong className={styles.minutesValue}>{numES(current, 0)} min</strong>
      <Sparkline current={current} previous={previous} comparisonValue={result} />
      <span className={`${styles.miniTrendLabel} ${styles[`trend${capitalize(result.tone)}`]}`}>
        {result.trend === "up" ? "↗" : result.trend === "down" ? "↘" : "→"} {result.label}
      </span>
    </div>
  );
}

export default function StatisticsPanel({
  month,
  loading,
  message,
  liveStatus,
  totals,
  previousTotals,
  rows,
  previousRows,
  top,
  teams,
  invoices,
  previousInvoiceSummary,
  onRefresh,
}: StatisticsPanelProps) {
  const currentInvoices = invoiceSummary(invoices || []);
  const previousInvoices = previousInvoiceSummary || null;
  const currentRows = rows || [];
  const previousRowsList = previousRows || [];
  const workers = currentRows.length;
  const previousWorkers = previousRowsList.length;
  const invoiceByWorker = new Map<string, any>();
  for (const invoice of invoices || []) invoiceByWorker.set(String(invoice?.worker_id || ""), invoice);
  const previousRowByWorker = new Map<string, any>();
  for (const row of previousRowsList) previousRowByWorker.set(String(row?.worker_id || ""), row);

  const mergedRows = currentRows.map((row) => ({
    ...row,
    invoice_total: safeNumber(invoiceByWorker.get(String(row?.worker_id || ""))?.total),
    worker_ack: invoiceByWorker.get(String(row?.worker_id || ""))?.worker_ack || null,
    worker_ack_note: invoiceByWorker.get(String(row?.worker_id || ""))?.worker_ack_note || null,
  }));

  const previousMonth = String(previousTotals?.month || previousInvoiceSummary?.month || "");
  const previousPeriodLabel = previousMonth ? monthLabel(previousMonth) : "mes anterior";
  const currentInvoiceTotal = currentInvoices.invoice_total;
  const previousInvoiceTotal = previousInvoices ? safeNumber(previousInvoices.invoice_total) : null;

  const currentComputed = {
    factura_media: workers ? currentInvoiceTotal / workers : 0,
    minutes_per_worker: workers ? safeNumber(totals?.minutes_total) / workers : 0,
    calls_per_worker: workers ? safeNumber(totals?.calls_total) / workers : 0,
    captadas_per_worker: workers ? safeNumber(totals?.captadas_total) / workers : 0,
    captadas_per_100_min: safeNumber(totals?.minutes_total)
      ? (safeNumber(totals?.captadas_total) / safeNumber(totals?.minutes_total)) * 100
      : 0,
  };
  const previousComputed = previousTotals
    ? {
        factura_media: previousWorkers ? safeNumber(previousInvoiceTotal) / previousWorkers : 0,
        minutes_per_worker: previousWorkers ? safeNumber(previousTotals?.minutes_total) / previousWorkers : 0,
        calls_per_worker: previousWorkers ? safeNumber(previousTotals?.calls_total) / previousWorkers : 0,
        captadas_per_worker: previousWorkers ? safeNumber(previousTotals?.captadas_total) / previousWorkers : 0,
        captadas_per_100_min: safeNumber(previousTotals?.minutes_total)
          ? (safeNumber(previousTotals?.captadas_total) / safeNumber(previousTotals?.minutes_total)) * 100
          : 0,
      }
    : null;

  const metrics: MetricDefinition[] = [
    { key: "PLAYERS", label: "Tarotistas con datos", value: numES(workers, 0), current: workers, previous: previousTotals ? previousWorkers : null, icon: Users, accent: "purple", detail: "Plantilla activa del periodo" },
    { key: "MIN", label: "Minutos totales", value: `${numES(totals?.minutes_total || 0, 0)} min`, current: safeNumber(totals?.minutes_total), previous: previousTotals ? safeNumber(previousTotals?.minutes_total) : null, icon: Clock3, accent: "blue", detail: "Producción real registrada" },
    { key: "CALLS", label: "Llamadas totales", value: numES(totals?.calls_total || 0, 0), current: safeNumber(totals?.calls_total), previous: previousTotals ? safeNumber(previousTotals?.calls_total) : null, icon: PhoneCall, accent: "green", detail: "Registros reales de llamadas" },
    { key: "CAP", label: "Captadas totales", value: numES(totals?.captadas_total || 0, 0), current: safeNumber(totals?.captadas_total), previous: previousTotals ? safeNumber(previousTotals?.captadas_total) : null, icon: Target, accent: "pink", detail: "Captaciones confirmadas" },
    { key: "PAY", label: "Pago por minutos", value: eur(totals?.pay_minutes || 0), current: safeNumber(totals?.pay_minutes), previous: previousTotals ? safeNumber(previousTotals?.pay_minutes) : null, icon: Coins, accent: "gold", detail: "Cálculo según tarifas actuales" },
    { key: "BONUS", label: "Bonus por captadas", value: eur(totals?.bonus_captadas || 0), current: safeNumber(totals?.bonus_captadas), previous: previousTotals ? safeNumber(previousTotals?.bonus_captadas) : null, icon: Sparkles, accent: "orange", detail: "Bonus real del periodo" },
    { key: "TOTAL", label: "Facturación total", value: eur(currentInvoiceTotal), current: currentInvoiceTotal, previous: previousInvoiceTotal, icon: BadgeEuro, accent: "gold", detail: "Suma de facturas reales" },
    { key: "AVG", label: "Factura media", value: eur(currentComputed.factura_media), current: currentComputed.factura_media, previous: previousComputed ? previousComputed.factura_media : null, icon: Gauge, accent: "purple", detail: "Promedio por tarotista" },
    { key: "MIN/P", label: "Minutos por tarotista", value: numES(currentComputed.minutes_per_worker, 0), current: currentComputed.minutes_per_worker, previous: previousComputed ? previousComputed.minutes_per_worker : null, icon: Clock3, accent: "blue", detail: "Media de producción" },
    { key: "CALL/P", label: "Llamadas por tarotista", value: numES(currentComputed.calls_per_worker, 2), current: currentComputed.calls_per_worker, previous: previousComputed ? previousComputed.calls_per_worker : null, icon: PhoneCall, accent: "green", detail: "Media de llamadas" },
    { key: "CAP/P", label: "Captadas por tarotista", value: numES(currentComputed.captadas_per_worker, 2), current: currentComputed.captadas_per_worker, previous: previousComputed ? previousComputed.captadas_per_worker : null, icon: UserCheck, accent: "pink", detail: "Media de captación" },
    { key: "CAP100", label: "Captadas / 100 min", value: numES(currentComputed.captadas_per_100_min, 2), current: currentComputed.captadas_per_100_min, previous: previousComputed ? previousComputed.captadas_per_100_min : null, icon: Target, accent: "orange", detail: "Eficiencia por producción" },
    { key: "CLIENT", label: "% Cliente medio", value: `${numES(totals?.avg_pct_cliente || 0, 2)} %`, current: safeNumber(totals?.avg_pct_cliente), previous: previousTotals ? safeNumber(previousTotals?.avg_pct_cliente) : null, icon: UserCheck, accent: "green", detail: "Calidad media del equipo" },
    { key: "REPEAT", label: "% Repetición medio", value: `${numES(totals?.avg_pct_repite || 0, 2)} %`, current: safeNumber(totals?.avg_pct_repite), previous: previousTotals ? safeNumber(previousTotals?.avg_pct_repite) : null, icon: Repeat2, accent: "purple", detail: "Fidelización media" },
    { key: "OK", label: "Facturas aceptadas", value: numES(currentInvoices.accepted, 0), current: currentInvoices.accepted, previous: previousInvoices ? safeNumber(previousInvoices.accepted) : null, icon: CheckCircle2, accent: "green", detail: `${currentInvoices.count} facturas generadas` },
    { key: "WAIT", label: "Facturas pendientes", value: numES(currentInvoices.pending, 0), current: currentInvoices.pending, previous: previousInvoices ? safeNumber(previousInvoices.pending) : null, icon: Activity, accent: "orange", inverse: true, detail: `${currentInvoices.review} en revisión · ${currentInvoices.rejected} rechazadas` },
  ];

  const topMinutes = [...mergedRows].sort((a, b) => safeNumber(b?.minutes_total) - safeNumber(a?.minutes_total));
  const live = liveMeta(liveStatus);
  const sortedRows = [...mergedRows].sort((a, b) => {
    const minutesDiff = safeNumber(b?.minutes_total) - safeNumber(a?.minutes_total);
    if (minutesDiff !== 0) return minutesDiff;
    return String(a?.display_name || "").localeCompare(String(b?.display_name || ""), "es");
  });

  return (
    <div className={styles.statistics}>
      <section className={styles.heroCard}>
        <span className={styles.heroGlow} aria-hidden="true" />
        <span className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>Centro de rendimiento · {monthLabel(month)}</span>
            <div className={styles.heroTitleRow}>
              <span className={styles.heroIcon}><BarChart3 size={25} /></span>
              <div>
                <h2>Estadísticas del mes</h2>
                <p>Producción, calidad, rankings, equipos y facturación desde una única fuente de datos real.</p>
              </div>
            </div>
          </div>
          <div className={styles.heroActions}>
            <span className={`${styles.liveBadge} ${live.className}`}><span /> {live.label}</span>
            <span className={styles.periodBadge}>{month}</span>
            <button className={`tc-btn ${styles.primaryButton}`} onClick={onRefresh} disabled={loading}>
              <RefreshCw size={15} className={loading ? styles.spinning : ""} />
              {loading ? "Actualizando" : "Actualizar estadísticas"}
            </button>
          </div>
        </div>
        <div className={styles.syncBar}>
          <span className={`${styles.syncDot} ${live.className}`} />
          <span>{message || (liveStatus === "live" ? "Sincronización Realtime activa" : "Preparando conexión en vivo")}</span>
          <span className={styles.syncSource}>Supabase · datos reales · {previousPeriodLabel}</span>
        </div>
      </section>

      <section className={styles.metricsSection}>
        <div className={styles.sectionHeadingInline}>
          <div>
            <span className={styles.sectionKicker}>Panel de estadísticas</span>
            <h3>Resumen general</h3>
          </div>
          <span className={styles.gameChip}><Sparkles size={13} /> Comparación automática</span>
        </div>
        <div className={styles.metricGrid}>
          {metrics.map((metric) => <MetricCard key={metric.key} metric={metric} previousMonth={previousPeriodLabel} />)}
        </div>
      </section>

      <div className={styles.rankingsGrid}>
        <RankingCard title="Top de captadas" icon={Trophy} rows={top?.captadas || []} valueKey="captadas_total" valueFormatter={(row) => `${numES(row?.captadas_total, 0)} captadas`} invoiceByWorker={invoiceByWorker} />
        <RankingCard title="Top por % cliente" icon={Crown} rows={top?.cliente || []} valueKey="pct_cliente" valueFormatter={(row) => `${numES(row?.pct_cliente, 2)} %`} invoiceByWorker={invoiceByWorker} />
        <RankingCard title="Top por % repetición" icon={Repeat2} rows={top?.repite || []} valueKey="pct_repite" valueFormatter={(row) => `${numES(row?.pct_repite, 2)} %`} invoiceByWorker={invoiceByWorker} />
        <RankingCard title="Top por minutos" icon={Clock3} rows={topMinutes} valueKey="minutes_total" valueFormatter={(row) => `${numES(row?.minutes_total, 0)} min`} invoiceByWorker={invoiceByWorker} />
      </div>

      <TeamBattle teams={teams} rows={mergedRows} invoiceByWorker={invoiceByWorker} />

      <section className={styles.performanceCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleGroup}>
            <span className={styles.sectionIcon}><BarChart3 size={20} /></span>
            <div>
              <span className={styles.sectionKicker}>Clasificación completa</span>
              <h3>Rendimiento por tarotista</h3>
              <p>Minutos, llamadas, captación, calidad, importes y aceptación sincronizados con las facturas reales.</p>
            </div>
          </div>
          <span className={styles.gameChip}>{sortedRows.length} tarotistas</span>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.performanceTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>Tarotista</th>
                <th>Equipo</th>
                <th>Minutos / tendencia</th>
                <th>Llamadas</th>
                <th>Captadas</th>
                <th>% Cliente</th>
                <th>% Repite</th>
                <th>Pago minutos</th>
                <th>Bonus captadas</th>
                <th>Factura</th>
                <th>Aceptación</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, index) => {
                const previousRow = previousRowByWorker.get(String(row?.worker_id || ""));
                const team = String(row?.team || "").toLowerCase();
                const ack = String(row?.worker_ack || "pending");
                return (
                  <tr key={row?.worker_id || `${row?.display_name}-${index}`}>
                    <td><span className={styles.tableRank}>{String(index + 1).padStart(2, "0")}</span></td>
                    <td>
                      <div className={styles.workerCell}>
                        <span className={styles.avatar}>{String(row?.display_name || "?").trim().charAt(0).toUpperCase()}</span>
                        <div><strong>{row?.display_name || "—"}</strong><span>{safeNumber(row?.revenue_total) > 0 ? `${eur(row?.revenue_total)} generados` : "Sin ingresos registrados"}</span></div>
                      </div>
                    </td>
                    <td><span className={`${styles.teamBadge} ${team === "fuego" ? styles.teamFire : team === "agua" ? styles.teamWater : styles.teamNone}`}>{team === "fuego" ? "🔥 Fuego" : team === "agua" ? "💧 Agua" : "Sin equipo"}</span></td>
                    <td><MinutesTrend current={safeNumber(row?.minutes_total)} previous={previousRow ? safeNumber(previousRow?.minutes_total) : null} /></td>
                    <td>{numES(row?.calls_total, 0)}</td>
                    <td><strong>{numES(row?.captadas_total, 0)}</strong></td>
                    <td><div className={styles.qualityCell}><strong>{numES(row?.pct_cliente, 2)} %</strong><TrendBadge value={safeNumber(row?.pct_cliente)} previous={previousRow ? safeNumber(previousRow?.pct_cliente) : null} /></div></td>
                    <td><div className={styles.qualityCell}><strong>{numES(row?.pct_repite, 2)} %</strong><TrendBadge value={safeNumber(row?.pct_repite)} previous={previousRow ? safeNumber(previousRow?.pct_repite) : null} /></div></td>
                    <td>{eur(row?.pay_minutes)}</td>
                    <td>{eur(row?.bonus_captadas)}</td>
                    <td><strong className={styles.invoiceValue}>{eur(row?.invoice_total)}</strong></td>
                    <td><span className={`${styles.ackBadge} ${styles[`ack${capitalize(ack)}`]}`} title={row?.worker_ack_note || ""}>{ackLabel(ack)}</span></td>
                  </tr>
                );
              })}
              {!sortedRows.length ? (
                <tr><td colSpan={12}><div className={styles.emptyState}>No hay estadísticas reales para el mes seleccionado.</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={styles.tableFootnote}>
          <span>ⓘ</span>
          Las mini gráficas comparan los minutos del mes seleccionado con el mes inmediatamente anterior. Cuando el valor anterior es cero se muestra un estado neutral sin porcentaje ficticio.
        </div>
      </section>
    </div>
  );
}
