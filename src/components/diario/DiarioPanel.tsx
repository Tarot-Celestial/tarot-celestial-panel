"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Building2,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  Crown,
  Euro,
  Globe2,
  Headphones,
  LoaderCircle,
  Minus,
  PhoneCall,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  AlertTriangle,
  WifiOff,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./DiarioPanel.module.css";

const sb = supabaseBrowser();
const MADRID_TIME_ZONE = "Europe/Madrid";

type IconComponent = LucideIcon;
type LiveStatus = "connecting" | "live" | "updating" | "reconnecting" | "offline";
type LoadSource = "initial" | "manual" | "realtime";

type DiarioPanelProps = {
  embedded?: boolean;
};

type DiarioRow = {
  id: string;
  payment_id: string;
  source_rendimiento_id?: string | null;
  source: "operador" | "web";
  cliente_id?: string | null;
  nombre: string;
  telefono?: string | null;
  fecha_pago?: string | null;
  importe?: number | null;
  metodo?: string | null;
  central?: string | null;
  tarotista?: string | null;
  estado?: string | null;
};

type GeneratedRow = {
  name: string;
  count: number;
  importe: number;
  previous_count?: number;
  previous_importe?: number;
};

type MonthlySummary = {
  month: string;
  previous_month: string;
  total_importe_rendimiento: number;
  total_registros_rendimiento: number;
  previous_total_importe_rendimiento: number;
  previous_total_registros_rendimiento: number;
  byTelefonista: GeneratedRow[];
  byTarotista: GeneratedRow[];
};

type DailyTotals = {
  total_clientes: number;
  total_pagos: number;
  total_importe: number;
};

type PeriodInfo = {
  mode: string;
  selected_date: string;
  comparison_date: string;
  selected_month: string;
  comparison_month: string;
  time_zone: string;
};

type ComparisonView = {
  tone: "positive" | "negative" | "neutral";
  label: string;
  detail: string;
  direction: "up" | "down" | "flat";
};

const EMPTY_TOTALS: DailyTotals = { total_clientes: 0, total_pagos: 0, total_importe: 0 };
const EMPTY_MONTHLY: MonthlySummary = {
  month: "",
  previous_month: "",
  total_importe_rendimiento: 0,
  total_registros_rendimiento: 0,
  previous_total_importe_rendimiento: 0,
  previous_total_registros_rendimiento: 0,
  byTelefonista: [],
  byTarotista: [],
};
const EMPTY_PERIOD: PeriodInfo = {
  mode: "hoy",
  selected_date: "",
  comparison_date: "",
  selected_month: "",
  comparison_month: "",
  time_zone: MADRID_TIME_ZONE,
};

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    return { ...JSON.parse(text), _raw: text, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: text.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

function eur(value: unknown) {
  return (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function number(value: unknown) {
  return (Number(value) || 0).toLocaleString("es-ES");
}


function madridTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthKeyInMadrid(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 7);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-ES", {
    timeZone: MADRID_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateLabel(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Periodo anterior";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function monthLabel(month?: string | null) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return "Mes seleccionado";
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1, 12));
  const label = date.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function initials(name: string) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
}

function buildComparison(currentValue: unknown, previousValue: unknown): ComparisonView {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  if (previous === 0 && current === 0) {
    return { tone: "neutral", label: "Sin datos anteriores", detail: "Sin actividad comparable", direction: "flat" };
  }
  if (previous === 0) {
    return { tone: "positive", label: "Nuevo periodo", detail: "El periodo anterior fue 0", direction: "up" };
  }
  const percentage = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(percentage) < 0.005) {
    return { tone: "neutral", label: "= 0 %", detail: "Sin variación", direction: "flat" };
  }
  const formatted = Math.abs(percentage).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return percentage > 0
    ? { tone: "positive", label: `↑ +${formatted} %`, detail: "Sube frente al periodo anterior", direction: "up" }
    : { tone: "negative", label: `↓ -${formatted} %`, detail: "Baja frente al periodo anterior", direction: "down" };
}

function methodKind(value?: string | null) {
  const method = String(value || "").toLowerCase();
  if (method.includes("paypal")) return "paypal";
  if (method.includes("bizum")) return "bizum";
  if (method.includes("tpv") || method.includes("stripe") || method.includes("tarjeta") || method.includes("card")) return "tpv";
  if (method.includes("efectivo") || method.includes("cash")) return "cash";
  return "other";
}

function stateKind(value?: string | null) {
  const state = String(value || "completed").toLowerCase();
  if (["completed", "paid", "pagado", "completado", "confirmado", "approved", "aprobado"].some((token) => state.includes(token))) return "success";
  if (["pending", "pendiente", "procesando"].some((token) => state.includes(token))) return "warning";
  if (["failed", "fallido", "error", "cancel", "anulad", "refund", "reembols"].some((token) => state.includes(token))) return "danger";
  return "neutral";
}

function MiniTrend({ current, previous, tone }: { current: number; previous: number; tone: ComparisonView["tone"] }) {
  const max = Math.max(Math.abs(current), Math.abs(previous), 1);
  const previousHeight = Math.max(12, Math.round((Math.abs(previous) / max) * 42));
  const currentHeight = Math.max(12, Math.round((Math.abs(current) / max) * 42));
  return (
    <div className={`${styles.miniTrend} ${styles[`trend_${tone}`]}`} aria-hidden="true">
      <span style={{ height: previousHeight }} />
      <span style={{ height: currentHeight }} />
    </div>
  );
}

function TrendBadge({ comparison }: { comparison: ComparisonView }) {
  const Icon = comparison.direction === "up" ? TrendingUp : comparison.direction === "down" ? TrendingDown : Minus;
  return (
    <div className={`${styles.trendBadge} ${styles[`trendBadge_${comparison.tone}`]}`} title={comparison.detail}>
      <Icon size={14} strokeWidth={2.5} />
      <span>{comparison.label}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  current,
  previous,
  icon: Icon,
  hint,
  accent,
}: {
  label: string;
  value: string;
  current: number;
  previous: number;
  icon: IconComponent;
  hint: string;
  accent: "violet" | "gold" | "cyan" | "pink";
}) {
  const comparison = buildComparison(current, previous);
  return (
    <article className={`${styles.statCard} ${styles[`accent_${accent}`]}`}>
      <div className={styles.statGlow} />
      <div className={styles.statTop}>
        <div className={styles.statIcon}><Icon size={21} strokeWidth={2.2} /></div>
        <MiniTrend current={current} previous={previous} tone={comparison.tone} />
      </div>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statFooter}>
        <TrendBadge comparison={comparison} />
        <span className={styles.statHint}>{hint}</span>
      </div>
    </article>
  );
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  const config = {
    connecting: { label: "Conectando", icon: LoaderCircle },
    live: { label: "En vivo", icon: Radio },
    updating: { label: "Actualizando", icon: RefreshCw },
    reconnecting: { label: "Reconectando", icon: LoaderCircle },
    offline: { label: "Sin conexión", icon: WifiOff },
  }[status];
  const Icon = config.icon;
  return (
    <div className={`${styles.liveIndicator} ${styles[`live_${status}`]}`}>
      <Icon size={14} className={status === "connecting" || status === "reconnecting" || status === "updating" ? styles.spin : ""} />
      <span>{config.label}</span>
    </div>
  );
}

function RankingList({
  title,
  subtitle,
  rows,
  emptyText,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  rows: GeneratedRow[];
  emptyText: string;
  icon: IconComponent;
}) {
  const leader = Math.max(...rows.map((row) => Number(row.importe || 0)), 1);
  return (
    <section className={styles.rankingCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionIcon}><Icon size={20} /></div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className={styles.rankingList}>
        {rows.length ? rows.slice(0, 10).map((item, index) => {
          const comparison = buildComparison(item.importe, item.previous_importe || 0);
          const progress = Math.max(4, Math.round((Number(item.importe || 0) / leader) * 100));
          return (
            <div className={`${styles.rankingRow} ${index < 3 ? styles[`rank_${index + 1}`] : ""}`} key={`${item.name}-${index}`}>
              <div className={styles.rankPosition}>{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}</div>
              <div className={styles.avatar}>{initials(item.name)}</div>
              <div className={styles.rankIdentity}>
                <div className={styles.rankName}>{item.name}</div>
                <div className={styles.progressTrack}><span style={{ width: `${progress}%` }} /></div>
                <div className={styles.rankMeta}>{number(item.count)} registros · Anterior {eur(item.previous_importe || 0)}</div>
              </div>
              <div className={styles.rankScore}>
                <strong>{eur(item.importe)}</strong>
                <TrendBadge comparison={comparison} />
              </div>
            </div>
          );
        }) : <div className={styles.emptyState}>{emptyText}</div>}
      </div>
    </section>
  );
}

export default function DiarioPanel({ embedded = false }: DiarioPanelProps) {
  const [activeBrand, setActiveBrand] = useState<"celestial" | "orion">("celestial");
  const [mode, setMode] = useState<"hoy" | "ayer" | "fecha">("hoy");
  const [date, setDate] = useState(madridTodayKey);
  const [rows, setRows] = useState<DiarioRow[]>([]);
  const [totals, setTotals] = useState<DailyTotals>(EMPTY_TOTALS);
  const [previousTotals, setPreviousTotals] = useState<DailyTotals>(EMPTY_TOTALS);
  const [byCentral, setByCentral] = useState<GeneratedRow[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary>(EMPTY_MONTHLY);
  const [period, setPeriod] = useState<PeriodInfo>(EMPTY_PERIOD);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [movementToDelete, setMovementToDelete] = useState<DiarioRow | null>(null);
  const [deletingMovement, setDeletingMovement] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [query, setQuery] = useState("");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const realtimeTimerRef = useRef<number | null>(null);
  const loadInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const loadDiarioRef = useRef<(silent?: boolean, source?: LoadSource) => Promise<void>>();
  const requestSequenceRef = useRef(0);
  const lastExternalRefreshRef = useRef(0);

  useEffect(() => {
    setActiveBrand(getActiveBrand());
    const onBrand = (event: Event) => {
      const brandEvent = event as CustomEvent<{ brand?: string }>;
      setActiveBrand(String(brandEvent.detail?.brand || "celestial") === "orion" ? "orion" : "celestial");
    };
    window.addEventListener("tc-brand-changed", onBrand);
    return () => window.removeEventListener("tc-brand-changed", onBrand);
  }, []);

  const getTokenOrLogin = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }, []);

  const loadDiario = useCallback(async (silent = false, source: LoadSource = "manual") => {
    if (loadInFlightRef.current) {
      requestSequenceRef.current += 1;
      pendingRefreshRef.current = true;
      return;
    }

    loadInFlightRef.current = true;
    const requestId = ++requestSequenceRef.current;
    if (!silent) {
      setLoading(true);
      setMessage("");
    }
    if (source === "realtime") setLiveStatus("updating");

    try {
      const token = await getTokenOrLogin();
      if (!token) return;
      const params = new URLSearchParams({ mode, brand: activeBrand });
      if (mode === "fecha" && date) params.set("date", date);

      const response = await fetch(`/api/crm/diario/listar?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await safeJson(response);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status || response.status}`);
      if (requestId !== requestSequenceRef.current) return;

      setRows(Array.isArray(json.rows) ? json.rows : []);
      setTotals({ ...EMPTY_TOTALS, ...(json.totals || {}) });
      setPreviousTotals({ ...EMPTY_TOTALS, ...(json.dailyComparison?.totals || {}) });
      setByCentral(Array.isArray(json.byCentral) ? json.byCentral : []);
      setMonthlySummary({
        ...EMPTY_MONTHLY,
        ...(json.monthlySummary || {}),
        byTelefonista: Array.isArray(json.monthlySummary?.byTelefonista) ? json.monthlySummary.byTelefonista : [],
        byTarotista: Array.isArray(json.monthlySummary?.byTarotista) ? json.monthlySummary.byTarotista : [],
      });
      setPeriod({ ...EMPTY_PERIOD, ...(json.period || {}) });
      if (!silent) setMessage(`Diario actualizado · ${Array.isArray(json.rows) ? json.rows.length : 0} cobros visibles`);
      if (source === "realtime") setLiveStatus("live");
    } catch (error: any) {
      console.error("[Diario] Error actualizando", error);
      if (!silent) {
        setMessage(`No se pudo actualizar Diario: ${error?.message || "error desconocido"}`);
        setRows([]);
        setTotals(EMPTY_TOTALS);
        setPreviousTotals(EMPTY_TOTALS);
        setByCentral([]);
        setMonthlySummary(EMPTY_MONTHLY);
      }
      if (source === "realtime") setLiveStatus("reconnecting");
    } finally {
      loadInFlightRef.current = false;
      if (!silent) setLoading(false);
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        window.setTimeout(() => void loadDiarioRef.current?.(true, "realtime"), 0);
      }
    }
  }, [activeBrand, date, getTokenOrLogin, mode]);

  useEffect(() => {
    loadDiarioRef.current = loadDiario;
  }, [loadDiario]);

  useEffect(() => {
    void loadDiario(false, "initial");
  }, [loadDiario]);

  useEffect(() => {
    if (!period.selected_month || !period.comparison_month) return;
    let active = true;
    const visibleMonths = new Set([period.selected_month, period.comparison_month]);
    setLiveStatus("connecting");

    const eventAffectsVisiblePeriod = (payload: any) => {
      const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old || {};
      const rawDate = String(row?.fecha_hora || row?.fecha || row?.created_at || row?.updated_at || "");
      if (!rawDate) return true;
      const eventMonth = monthKeyInMadrid(rawDate);
      return visibleMonths.has(eventMonth);
    };

    const scheduleRefresh = (payload: any) => {
      if (!active || !eventAffectsVisiblePeriod(payload)) return;
      setLiveStatus("updating");
      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null;
        if (active) void loadDiarioRef.current?.(true, "realtime");
      }, 700);
    };

    const channel = sb
      .channel(`admin-diario-${activeBrand}-${period.selected_date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_pagos" }, scheduleRefresh)
      .subscribe((status: string) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setLiveStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLiveStatus("reconnecting");
        else if (status === "CLOSED") setLiveStatus("offline");
      });

    return () => {
      active = false;
      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      void sb.removeChannel(channel);
    };
  }, [activeBrand, period.comparison_month, period.selected_date, period.selected_month]);

  useEffect(() => {
    let active = true;
    let broadcast: BroadcastChannel | null = null;

    const refreshFromExternalChange = () => {
      if (!active) return;
      const now = Date.now();
      // Realtime, evento local y BroadcastChannel pueden anunciar la misma
      // operación. Este pequeño límite evita consultas duplicadas sin perderla.
      if (now - lastExternalRefreshRef.current < 500) return;
      lastExternalRefreshRef.current = now;
      void loadDiarioRef.current?.(true, "realtime");
    };

    const onPaymentRecorded = () => refreshFromExternalChange();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshFromExternalChange();
    };
    const onFocus = () => refreshFromExternalChange();

    window.addEventListener("tc-payment-recorded", onPaymentRecorded);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    try {
      broadcast = new BroadcastChannel("tc-payments");
      broadcast.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "payment-recorded") refreshFromExternalChange();
      });
    } catch {
      broadcast = null;
    }

    // Respaldo de baja frecuencia por si Realtime queda temporalmente desconectado.
    // Solo consulta mientras la pestaña está visible.
    const fallbackTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshFromExternalChange();
    }, 30000);

    return () => {
      active = false;
      window.removeEventListener("tc-payment-recorded", onPaymentRecorded);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(fallbackTimer);
      broadcast?.close();
    };
  }, []);


  const cancelEconomicMovement = useCallback(async () => {
    if (!movementToDelete?.payment_id || deletingMovement) return;
    setDeletingMovement(true);
    setDeleteError("");

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const response = await fetch("/api/crm/diario/cancelar-movimiento", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payment_id: movementToDelete.payment_id }),
      });
      const json = await safeJson(response);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || "No se pudo eliminar el movimiento");

      setMovementToDelete(null);
      setMessage("Movimiento económico eliminado correctamente");
      await loadDiario(true, "manual");

      window.dispatchEvent(new CustomEvent("tc-payment-recorded", { detail: { type: "payment-cancelled", paymentId: movementToDelete.payment_id } }));
      try {
        const broadcast = new BroadcastChannel("tc-payments");
        broadcast.postMessage({ type: "payment-recorded", action: "cancelled", paymentId: movementToDelete.payment_id });
        broadcast.close();
      } catch {}
    } catch (error: any) {
      console.error("[Diario] Error eliminando movimiento", error);
      setDeleteError(error?.message || "No se pudo eliminar el movimiento económico");
    } finally {
      setDeletingMovement(false);
    }
  }, [deletingMovement, getTokenOrLogin, loadDiario, movementToDelete]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      [row.nombre, row.telefono, row.metodo, row.central, row.tarotista, row.source, row.estado]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [query, rows]);

  const selectedPeriodText = period.selected_date
    ? `${dateLabel(period.selected_date)} · comparado con ${dateLabel(period.comparison_date)}`
    : "Cargando periodo real…";
  const monthlyAmountComparison = buildComparison(
    monthlySummary.total_importe_rendimiento,
    monthlySummary.previous_total_importe_rendimiento
  );
  const monthlyCountComparison = buildComparison(
    monthlySummary.total_registros_rendimiento,
    monthlySummary.previous_total_registros_rendimiento
  );

  return (
    <div className={`${styles.panel} ${embedded ? styles.embedded : ""}`}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <div className={styles.heroIdentity}>
            <div className={styles.heroIcon}><CalendarDays size={29} /></div>
            <div>
              <div className={styles.eyebrow}><Sparkles size={13} /> CENTRO DE CONTROL DIARIO</div>
              <h2>Diario de cobros</h2>
              <p>Ingresos, actividad y producción real sincronizados en una única vista.</p>
            </div>
          </div>
          <div className={styles.heroStatus}>
            <LiveIndicator status={liveStatus} />
            <div className={styles.periodPill}><CalendarDays size={14} /> {selectedPeriodText}</div>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.modeGroup}>
            {(["hoy", "ayer", "fecha"] as const).map((item) => (
              <button
                type="button"
                key={item}
                className={`${styles.modeButton} ${mode === item ? styles.modeButtonActive : ""}`}
                onClick={() => setMode(item)}
              >
                {item === "hoy" ? "Hoy" : item === "ayer" ? "Ayer" : "Fecha"}
              </button>
            ))}
          </div>
          {mode === "fecha" && (
            <label className={styles.dateControl}>
              <CalendarDays size={16} />
              <input type="date" value={date} onChange={(event: ChangeEvent<HTMLInputElement>) => setDate(event.target.value)} />
            </label>
          )}
          <label className={styles.searchControl}>
            <Search size={17} />
            <input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Buscar cliente, central, método…" />
          </label>
          <button className={styles.refreshButton} type="button" onClick={() => void loadDiario(false, "manual")} disabled={loading}>
            <RefreshCw size={17} className={loading ? styles.spin : ""} />
            {loading ? "Actualizando" : "Actualizar"}
          </button>
        </div>
      </section>

      <div className={`${styles.message} ${message.startsWith("No se pudo") ? styles.messageError : ""}`} aria-live="polite">
        {message || "Datos reales del sistema · sin valores simulados"}
      </div>

      <section className={styles.statsGrid}>
        <StatCard
          label="Clientes únicos"
          value={number(totals.total_clientes)}
          current={totals.total_clientes}
          previous={previousTotals.total_clientes}
          icon={Users}
          hint={`vs. ${dateLabel(period.comparison_date)}`}
          accent="violet"
        />
        <StatCard
          label="Cobros totales"
          value={number(totals.total_pagos)}
          current={totals.total_pagos}
          previous={previousTotals.total_pagos}
          icon={CreditCard}
          hint={`vs. ${dateLabel(period.comparison_date)}`}
          accent="cyan"
        />
        <StatCard
          label="Importe total diario"
          value={eur(totals.total_importe)}
          current={totals.total_importe}
          previous={previousTotals.total_importe}
          icon={Euro}
          hint={`vs. ${dateLabel(period.comparison_date)}`}
          accent="gold"
        />
        <article className={`${styles.statCard} ${styles.accent_pink} ${styles.centralCard}`}>
          <div className={styles.statGlow} />
          <div className={styles.statTop}>
            <div className={styles.statIcon}><Building2 size={21} /></div>
            <span className={styles.centralCount}>{byCentral.length} orígenes</span>
          </div>
          <div className={styles.statLabel}>Pagos por centrales</div>
          <div className={styles.centralList}>
            {byCentral.length ? byCentral.slice(0, 4).map((central) => {
              const comparison = buildComparison(central.importe, central.previous_importe || 0);
              return (
                <div className={styles.centralChip} key={central.name}>
                  <span>{central.name}</span>
                  <strong>{eur(central.importe)}</strong>
                  <span className={`${styles.centralTrend} ${styles[`centralTrend_${comparison.tone}`]}`}>{comparison.label}</span>
                </div>
              );
            }) : <span className={styles.emptyInline}>Sin cobros en el periodo</span>}
          </div>
        </article>
      </section>

      <section className={styles.monthlyHero}>
        <div className={styles.monthlyAura} />
        <div className={styles.monthlyMain}>
          <div className={styles.monthlyIcon}><CircleDollarSign size={27} /></div>
          <div>
            <div className={styles.monthlyLabel}>Facturado este mes desde rendimiento</div>
            <div className={styles.monthlyValue}>{eur(monthlySummary.total_importe_rendimiento)}</div>
            <div className={styles.monthlyMeta}>
              {monthLabel(monthlySummary.month)} · {number(monthlySummary.total_registros_rendimiento)} registros reales con importe
            </div>
          </div>
        </div>
        <div className={styles.monthlyComparisons}>
          <div className={styles.monthlyComparisonBox}>
            <span>Importe vs. {dateLabel(period.comparison_date)}</span>
            <TrendBadge comparison={monthlyAmountComparison} />
            <small>Anterior MTD (1–{period.comparison_date.slice(-2)}): {eur(monthlySummary.previous_total_importe_rendimiento)}</small>
          </div>
          <div className={styles.monthlyComparisonBox}>
            <span>Registros con importe</span>
            <TrendBadge comparison={monthlyCountComparison} />
            <small>Anterior MTD (1–{period.comparison_date.slice(-2)}): {number(monthlySummary.previous_total_registros_rendimiento)}</small>
          </div>
          <div className={styles.companyBadge}><Zap size={15} /> Dinero generado para la empresa, no factura a pagar</div>
        </div>
      </section>

      <section className={styles.rankingsGrid}>
        <RankingList
          title="Generado por telefonista"
          subtitle={`MTD 1–${period.selected_date.slice(-2)} frente a 1–${period.comparison_date.slice(-2)} del mes anterior`}
          rows={monthlySummary.byTelefonista}
          emptyText="No hay importes de rendimiento para telefonistas en este mes."
          icon={Headphones}
        />
        <RankingList
          title="Generado por tarotista"
          subtitle={`Producción real MTD hasta ${dateLabel(period.selected_date)} frente a ${dateLabel(period.comparison_date)}`}
          rows={monthlySummary.byTarotista}
          emptyText="No hay importes de rendimiento para tarotistas en este mes."
          icon={Crown}
        />
      </section>

      <section className={styles.paymentsSection}>
        <div className={styles.sectionHeaderWide}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIcon}><PhoneCall size={20} /></div>
            <div>
              <h3>Movimientos del periodo</h3>
              <p>{filteredRows.length} de {rows.length} cobros visibles · fuentes reales de Rendimiento y CRM</p>
            </div>
          </div>
          <div className={styles.sourceLegend}>
            <span><Headphones size={13} /> Operador</span>
            <span><Globe2 size={13} /> Web automática</span>
          </div>
        </div>

        <div className={styles.tableScroller}>
          <table className={styles.paymentsTable}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Origen</th>
                <th>Central</th>
                <th>Tarotista</th>
                <th>Método</th>
                <th>Estado</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const method = methodKind(row.metodo);
                const state = stateKind(row.estado);
                return (
                  <tr key={row.id}>
                    <td><span className={styles.dateCell}>{formatDate(row.fecha_pago)}</span></td>
                    <td>
                      <div className={styles.clientCell}>
                        <span className={styles.clientAvatar}>{initials(row.nombre)}</span>
                        <div><strong>{row.nombre || "—"}</strong><small>{row.telefono || "Sin teléfono"}</small></div>
                      </div>
                    </td>
                    <td><span className={`${styles.sourceBadge} ${row.source === "web" ? styles.sourceWeb : styles.sourceOperator}`}>{row.source === "web" ? <Globe2 size={13} /> : <Headphones size={13} />}{row.source === "web" ? "Web auto" : "Operador"}</span></td>
                    <td>{row.central || "—"}</td>
                    <td>{row.tarotista || "—"}</td>
                    <td><span className={`${styles.methodBadge} ${styles[`method_${method}`]}`}>{row.metodo || "—"}</span></td>
                    <td><span className={`${styles.stateBadge} ${styles[`state_${state}`]}`}>{row.estado || "—"}</span></td>
                    <td>
                      <div className={styles.amountActionCell}>
                        <strong className={styles.amountCell}>{eur(row.importe || 0)}</strong>
                        <button
                          type="button"
                          className={styles.deleteMovementButton}
                          onClick={() => { setDeleteError(""); setMovementToDelete(row); }}
                          aria-label={`Eliminar movimiento de ${row.nombre}`}
                          title="Eliminar movimiento"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filteredRows.length && (
                <tr><td colSpan={8}><div className={styles.emptyState}>No hay cobros para este periodo o búsqueda.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {movementToDelete && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deletingMovement) setMovementToDelete(null);
        }}>
          <section className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="delete-movement-title">
            <div className={styles.confirmModalIcon}><AlertTriangle size={24} /></div>
            <div className={styles.confirmModalHeader}>
              <h3 id="delete-movement-title">Eliminar movimiento económico</h3>
              <p>Esta operación dejará de contabilizarse en el Diario y en todas las estadísticas económicas, pero conservará su trazabilidad para auditoría.</p>
            </div>

            <dl className={styles.movementDetails}>
              <div><dt>Cliente</dt><dd>{movementToDelete.nombre || "—"}</dd></div>
              <div><dt>Fecha</dt><dd>{formatDate(movementToDelete.fecha_pago)}</dd></div>
              <div><dt>Importe</dt><dd>{eur(movementToDelete.importe || 0)}</dd></div>
              <div><dt>Método de pago</dt><dd>{movementToDelete.metodo || "—"}</dd></div>
              <div><dt>Telefonista</dt><dd>{movementToDelete.central || "—"}</dd></div>
              <div><dt>Tarotista</dt><dd>{movementToDelete.tarotista || "—"}</dd></div>
            </dl>

            {deleteError && <div className={styles.deleteError}>{deleteError}</div>}

            <div className={styles.confirmModalActions}>
              <button type="button" className={styles.cancelDeleteButton} onClick={() => setMovementToDelete(null)} disabled={deletingMovement}>
                Cancelar
              </button>
              <button type="button" className={styles.confirmDeleteButton} onClick={() => void cancelEconomicMovement()} disabled={deletingMovement}>
                {deletingMovement ? <><LoaderCircle size={16} className={styles.spin} /> Eliminando…</> : "Eliminar definitivamente"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
