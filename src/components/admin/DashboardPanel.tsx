"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BellRing,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Euro,
  Gamepad2,
  Info,
  LogIn,
  Minus,
  MousePointerClick,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  UserRoundCheck,
  UserRoundX,
  Users,
  Wifi,
  Zap,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { tcToast } from "@/lib/tc-toast";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./DashboardPanel.module.css";

const sb = supabaseBrowser();

type DashboardPanelProps = {
  month: string;
};

type TrendDirection = "up" | "down" | "neutral";
type ComparisonTone = "positive" | "negative" | "neutral";
type KpiAccent = "gold" | "purple" | "green" | "blue" | "pink" | "orange";

type ComparisonData = {
  trend: TrendDirection;
  tone: ComparisonTone;
  percentage: number | null;
  hasPrevious: boolean;
  previous: number | null;
};

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function numES(n: any, digits = 0) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function previousMonthKey(month: string) {
  const [yearRaw, monthRaw] = String(month || "").split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return month;
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [yearRaw, monthRaw] = String(month || "").split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return month;
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1))
  );
}

function minsUntil(dateValue: any) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 60000);
}

function isPendingReserva(v: any) {
  const s = String(v || "").trim().toLowerCase();
  return ["pendiente", "pending", "confirmada", "confirmado", "programada", "activa"].includes(s);
}

function reservationMonth(row: any) {
  const raw = String(row?.fecha_reserva || "").trim();
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function buildComparison(current: number, previous: number | null, positiveWhenUp = true): ComparisonData {
  if (previous === null || previous === undefined || !Number.isFinite(Number(previous))) {
    return { trend: "neutral", tone: "neutral", percentage: null, hasPrevious: false, previous: null };
  }

  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  const trend: TrendDirection = currentValue > previousValue ? "up" : currentValue < previousValue ? "down" : "neutral";
  const percentage = previousValue === 0
    ? currentValue === 0
      ? 0
      : null
    : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;

  const tone: ComparisonTone = trend === "neutral"
    ? "neutral"
    : (trend === "up") === positiveWhenUp
      ? "positive"
      : "negative";

  return {
    trend,
    tone,
    percentage,
    hasPrevious: true,
    previous: previousValue,
  };
}

function comparisonText(comparison: ComparisonData) {
  if (!comparison.hasPrevious) return "Sin datos anteriores";
  if (comparison.percentage === null) {
    if (comparison.trend === "up") return "Nuevo periodo";
    if (comparison.trend === "down") return "Sin actividad";
    return "Sin variación";
  }
  if (Math.abs(comparison.percentage) < 0.005) return "Sin variación";
  return `${comparison.percentage > 0 ? "+" : ""}${numES(comparison.percentage, 2)} %`;
}

function relativeTime(value: any) {
  if (!value) return "Sin actividad registrada";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Sin actividad registrada";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Ahora mismo";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}

function clientActivityStatus(row: any) {
  const source = row?.ultima_actividad_at || row?.ultimo_acceso_at;
  const timestamp = source ? new Date(source).getTime() : 0;
  const elapsed = timestamp ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
  const minute = 60 * 1000;
  const day = 24 * 60 * minute;

  if (elapsed <= 3 * minute) return { key: "online", label: "Online", detail: relativeTime(source) };
  if (elapsed <= day) return { key: "recent", label: "Actividad reciente", detail: relativeTime(source) };
  if (elapsed > 7 * day) return { key: "inactive", label: "Inactividad prolongada", detail: relativeTime(source) };
  return { key: "offline", label: "Offline", detail: relativeTime(source) };
}

function toneClass(tone: ComparisonTone) {
  if (tone === "positive") return styles.tonePositive;
  if (tone === "negative") return styles.toneNegative;
  return styles.toneNeutral;
}

function accentClass(accent: KpiAccent) {
  if (accent === "gold") return styles.accentGold;
  if (accent === "green") return styles.accentGreen;
  if (accent === "blue") return styles.accentBlue;
  if (accent === "pink") return styles.accentPink;
  if (accent === "orange") return styles.accentOrange;
  return styles.accentPurple;
}

function TrendIcon({ trend, size = 15 }: { trend: TrendDirection; size?: number }) {
  if (trend === "up") return <TrendingUp size={size} aria-hidden="true" />;
  if (trend === "down") return <TrendingDown size={size} aria-hidden="true" />;
  return <Minus size={size} aria-hidden="true" />;
}

function Sparkline({ current, comparison }: { current: number; comparison: ComparisonData }) {
  const previous = comparison.hasPrevious ? Number(comparison.previous || 0) : null;
  const currentValue = Math.max(0, Number(current) || 0);
  const values = previous === null ? [currentValue, currentValue] : [Math.max(0, previous), currentValue];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1);
  const yFor = (value: number) => 26 - ((value - minValue) / range) * 16;
  const previousY = previous === null || values[0] === values[1] ? 18 : yFor(values[0]);
  const currentY = previous === null || values[0] === values[1] ? 18 : yFor(values[1]);
  const path = `M 4 ${previousY.toFixed(2)} C 28 ${previousY.toFixed(2)}, 64 ${currentY.toFixed(2)}, 96 ${currentY.toFixed(2)}`;

  return (
    <svg className={styles.sparkline} viewBox="0 0 100 34" role="img" aria-label="Tendencia del indicador">
      <path className={styles.sparkArea} d={`${path} L 96 32 L 4 32 Z`} />
      <path className={styles.sparkLine} d={path} />
      <circle className={styles.sparkPoint} cx="4" cy={previousY} r="2.4" />
      <circle className={styles.sparkPoint} cx="96" cy={currentY} r="2.9" />
    </svg>
  );
}

function GameKpi({
  label,
  value,
  numericValue,
  icon,
  accent = "purple",
  comparison,
  periodLabel,
  previousDisplay,
  meta,
  compact = false,
}: {
  label: string;
  value: string;
  numericValue: number;
  icon: ReactNode;
  accent?: KpiAccent;
  comparison: ComparisonData;
  periodLabel: string;
  previousDisplay?: string;
  meta?: string;
  compact?: boolean;
}) {
  return (
    <article className={`${styles.kpiCard} ${accentClass(accent)} ${toneClass(comparison.tone)} ${compact ? styles.kpiCompact : ""}`}>
      <div className={styles.kpiGlow} />
      <div className={styles.kpiTopline}>
        <span className={styles.kpiIcon}>{icon}</span>
        <span className={styles.kpiSignal}><Radio size={11} aria-hidden="true" /> En vivo</span>
      </div>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={styles.kpiVisualRow}>
        <Sparkline current={numericValue} comparison={comparison} />
        <div className={styles.kpiTrendCopy}>
          <strong><TrendIcon trend={comparison.trend} /> {comparisonText(comparison)}</strong>
          <span>{periodLabel}</span>
        </div>
      </div>
      <div className={styles.kpiFoot}>
        <span>{previousDisplay ? `Anterior: ${previousDisplay}` : comparison.hasPrevious ? "Periodo anterior disponible" : "Histórico no disponible"}</span>
        {meta ? <span>{meta}</span> : null}
      </div>
    </article>
  );
}

function AlertIcon({ tone }: { tone: "danger" | "warning" | "success" | "info" }) {
  if (tone === "danger") return <ShieldAlert size={20} aria-hidden="true" />;
  if (tone === "warning") return <TriangleAlert size={20} aria-hidden="true" />;
  if (tone === "success") return <CheckCircle2 size={20} aria-hidden="true" />;
  return <Info size={20} aria-hidden="true" />;
}

function alertToneClass(tone: "danger" | "warning" | "success" | "info") {
  if (tone === "danger") return styles.alertDanger;
  if (tone === "warning") return styles.alertWarning;
  if (tone === "success") return styles.alertSuccess;
  return styles.alertInfo;
}

function alertStatusLabel(tone: "danger" | "warning" | "success" | "info") {
  if (tone === "danger") return "Urgente";
  if (tone === "warning") return "Preventivo";
  if (tone === "success") return "Positivo";
  return "Informativo";
}

export default function DashboardPanel({ month }: DashboardPanelProps) {
  const [activeBrand, setActiveBrand] = useState<"celestial" | "orion">("celestial");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statsRows, setStatsRows] = useState<any[]>([]);
  const [statsTotals, setStatsTotals] = useState<any>(null);
  const [previousStatsRows, setPreviousStatsRows] = useState<any[]>([]);
  const [previousStatsTotals, setPreviousStatsTotals] = useState<any>(null);
  const [previousStatsLoaded, setPreviousStatsLoaded] = useState(false);
  const [reservas, setReservas] = useState<any[]>([]);
  const [diarioRows, setDiarioRows] = useState<any[]>([]);
  const [yesterdayRows, setYesterdayRows] = useState<any[]>([]);
  const [yesterdayLoaded, setYesterdayLoaded] = useState(false);
  const [clientAccess, setClientAccess] = useState<any>(null);
  const [pushTitle, setPushTitle] = useState("Aviso Tarot Celestial");
  const [pushBody, setPushBody] = useState("");
  const [pushSending, setPushSending] = useState(false);
  const [pushMsg, setPushMsg] = useState("");

  const previousMonth = useMemo(() => previousMonthKey(month), [month]);

  useEffect(() => {
    setActiveBrand(getActiveBrand());
    const onBrand = (event: any) => setActiveBrand(String(event?.detail?.brand || "celestial") === "orion" ? "orion" : "celestial");
    window.addEventListener("tc-brand-changed", onBrand as EventListener);
    return () => window.removeEventListener("tc-brand-changed", onBrand as EventListener);
  }, []);

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadDashboard(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const [invRes, statsRes, previousStatsRes, reservasRes, diarioRes, yesterdayRes, accessRes] = await Promise.all([
        fetch(`/api/admin/invoices/list?month=${encodeURIComponent(month)}&brand=${activeBrand}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/stats/monthly?month=${encodeURIComponent(month)}&brand=${activeBrand}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/stats/monthly?month=${encodeURIComponent(previousMonth)}&brand=${activeBrand}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/crm/reservas/listar?brand=${activeBrand}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/crm/diario/listar?mode=hoy&brand=${activeBrand}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/crm/diario/listar?mode=ayer&brand=${activeBrand}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/admin/client-access/summary", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const invJ = await safeJson(invRes);
      const statsJ = await safeJson(statsRes);
      const previousStatsJ = await safeJson(previousStatsRes);
      const reservasJ = await safeJson(reservasRes);
      const diarioJ = await safeJson(diarioRes);
      const yesterdayJ = await safeJson(yesterdayRes);
      const accessJ = await safeJson(accessRes);

      if (!invJ?._ok || !invJ?.ok) throw new Error(invJ?.error || `HTTP ${invJ?._status}`);
      if (!statsJ?._ok || !statsJ?.ok) throw new Error(statsJ?.error || `HTTP ${statsJ?._status}`);
      if (!reservasJ?._ok || !reservasJ?.ok) throw new Error(reservasJ?.error || `HTTP ${reservasJ?._status}`);
      if (!diarioJ?._ok || !diarioJ?.ok) throw new Error(diarioJ?.error || `HTTP ${diarioJ?._status}`);
      if (!accessJ?._ok || !accessJ?.ok) throw new Error(accessJ?.error || `HTTP ${accessJ?._status}`);

      setInvoices(Array.isArray(invJ.invoices) ? invJ.invoices : []);
      setStatsRows(Array.isArray(statsJ.rows) ? statsJ.rows : []);
      setStatsTotals(statsJ.totals || null);
      setReservas(Array.isArray(reservasJ.reservas) ? reservasJ.reservas : []);
      setDiarioRows(Array.isArray(diarioJ.rows) ? diarioJ.rows : []);
      setClientAccess(accessJ || null);

      const previousStatsOk = Boolean(previousStatsJ?._ok && previousStatsJ?.ok);
      setPreviousStatsLoaded(previousStatsOk);
      setPreviousStatsRows(previousStatsOk && Array.isArray(previousStatsJ.rows) ? previousStatsJ.rows : []);
      setPreviousStatsTotals(previousStatsOk ? (previousStatsJ.totals || null) : null);

      const yesterdayOk = Boolean(yesterdayJ?._ok && yesterdayJ?.ok);
      setYesterdayLoaded(yesterdayOk);
      setYesterdayRows(yesterdayOk && Array.isArray(yesterdayJ.rows) ? yesterdayJ.rows : []);

      if (!silent) setMsg("Dashboard sincronizado con los datos reales del sistema.");
    } catch (e: any) {
      if (!silent) {
        setMsg(`No se pudo actualizar: ${e?.message || "Error cargando dashboard"}`);
        tcToast({ title: "Error en dashboard", description: String(e?.message || "No se pudo cargar"), tone: "error" });
      }
      setInvoices([]);
      setStatsRows([]);
      setStatsTotals(null);
      setPreviousStatsRows([]);
      setPreviousStatsTotals(null);
      setPreviousStatsLoaded(false);
      setReservas([]);
      setDiarioRows([]);
      setYesterdayRows([]);
      setYesterdayLoaded(false);
      setClientAccess(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(false);
    const timer = setInterval(() => loadDashboard(true), 20000);
    return () => clearInterval(timer);
  }, [month, previousMonth, activeBrand]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void loadDashboard(true), 350);
    };

    const channel = sb
      .channel(`admin-dashboard-payments-${month}-${activeBrand}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_pagos" }, scheduleRefresh)
      .subscribe();

    window.addEventListener("tc-payment-recorded", scheduleRefresh as EventListener);

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("tc-payment-recorded", scheduleRefresh as EventListener);
      void sb.removeChannel(channel);
    };
    // La consulta central se invalida una sola vez por lote de eventos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, activeBrand]);

  const totalFacturacion = useMemo(
    () => Number(statsTotals?.revenue_total || 0),
    [statsTotals]
  );

  const previousInvoiceData = useMemo(() => {
    const withHistory = invoices.filter((row: any) => Boolean(row?.has_previous_invoice));
    if (!withHistory.length) return { total: null as number | null, count: 0 };
    return {
      total: withHistory.reduce((acc: number, row: any) => acc + (Number(row?.previous_total) || 0), 0),
      count: withHistory.length,
    };
  }, [invoices]);

  const pendientes = useMemo(
    () => reservas.filter((row: any) => isPendingReserva(row?.estado)).length,
    [reservas]
  );

  const pendingSelectedMonth = useMemo(
    () => reservas.filter((row: any) => isPendingReserva(row?.estado) && reservationMonth(row) === month).length,
    [reservas, month]
  );

  const pendingPreviousMonth = useMemo(
    () => reservas.filter((row: any) => isPendingReserva(row?.estado) && reservationMonth(row) === previousMonth).length,
    [reservas, previousMonth]
  );

  const reservasProximas = useMemo(() => {
    return [...reservas]
      .filter((row: any) => isPendingReserva(row?.estado))
      .sort((a: any, b: any) => {
        const at = a?.fecha_reserva ? new Date(a.fecha_reserva).getTime() : 0;
        const bt = b?.fecha_reserva ? new Date(b.fecha_reserva).getTime() : 0;
        return at - bt;
      })
      .slice(0, 5);
  }, [reservas]);

  const facturacionComparison = useMemo(
    () => buildComparison(totalFacturacion, previousStatsLoaded ? Number(previousStatsTotals?.revenue_total || 0) : null, true),
    [totalFacturacion, previousStatsLoaded, previousStatsTotals]
  );
  const clientsTodayComparison = useMemo(
    () => buildComparison(diarioRows.length, yesterdayLoaded ? yesterdayRows.length : null, true),
    [diarioRows.length, yesterdayLoaded, yesterdayRows.length]
  );
  const reservasComparison = useMemo(
    () => buildComparison(pendingSelectedMonth, pendingPreviousMonth, false),
    [pendingSelectedMonth, pendingPreviousMonth]
  );
  const tarotistasComparison = useMemo(
    () => buildComparison(statsRows.length, previousStatsLoaded ? previousStatsRows.length : null, true),
    [statsRows.length, previousStatsLoaded, previousStatsRows.length]
  );
  const noHistoricalComparison = useMemo(() => buildComparison(0, null), []);

  const alertas = useMemo(() => {
    const items: { title: string; description: string; tone: "danger" | "warning" | "success" | "info" }[] = [];

    const verySoon = reservasProximas.filter((row: any) => {
      const mins = minsUntil(row?.fecha_reserva);
      return mins !== null && mins >= -2 && mins <= 10;
    });

    if (verySoon.length > 0) {
      items.push({
        title: "Reservas inminentes",
        description: `${verySoon.length} reserva(s) en los próximos 10 minutos.`,
        tone: "danger",
      });
    }

    if (diarioRows.length >= 5) {
      items.push({
        title: "Buen ritmo de compras",
        description: `Hoy han comprado ${diarioRows.length} clientes.`,
        tone: "success",
      });
    }

    if (pendientes >= 5) {
      items.push({
        title: "Carga de reservas",
        description: `Hay ${pendientes} reservas activas o pendientes de gestionar.`,
        tone: pendientes >= 10 ? "danger" : "warning",
      });
    }

    const totalMes = Number(statsTotals?.revenue_total || 0);
    if (totalMes >= 3000) {
      items.push({
        title: "Facturación fuerte",
        description: `El mes ya acumula ${eur(totalMes)} en cobros registrados.`,
        tone: "success",
      });
    }

    const top = [...statsRows].sort((a: any, b: any) => Number(b?.captadas_total || 0) - Number(a?.captadas_total || 0))[0];
    if (top && Number(top?.captadas_total || 0) >= 3) {
      items.push({
        title: "Tarotista destacada",
        description: `${top.display_name || "Equipo"} lidera captación con ${numES(top.captadas_total || 0)} captadas.`,
        tone: "info",
      });
    }

    if (diarioRows.length === 0 && new Date().getHours() >= 12) {
      items.push({
        title: "Sin compras hoy",
        description: "Todavía no hay compras registradas hoy. Revisa seguimientos, cobros o captación.",
        tone: "warning",
      });
    }

    if (items.length === 0) {
      items.push({
        title: "Panel estable",
        description: "No hay alertas críticas ahora mismo.",
        tone: "info",
      });
    }

    return items;
  }, [reservasProximas, diarioRows, pendientes, statsRows, statsTotals]);

  async function sendClientPush() {
    try {
      const title = String(pushTitle || "").trim();
      const body = String(pushBody || "").trim();
      if (!title || !body) throw new Error("Escribe título y mensaje antes de enviar.");

      setPushSending(true);
      setPushMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const res = await fetch("/api/admin/client-push/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, url: "/cliente/dashboard", save_internal: true }),
      });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status || 500}`);

      const sent = Number(json?.sent || 0);
      const total = Number(json?.total || 0);
      setPushMsg(`Notificación enviada. ${sent}/${total} dispositivos recibieron el envío.`);
      setPushBody("");
      tcToast({ title: "Notificación enviada", description: `${sent}/${total} dispositivos`, tone: "success" });
    } catch (e: any) {
      const errorText = String(e?.message || "No se pudo enviar la notificación");
      setPushMsg(`Error: ${errorText}`);
      tcToast({ title: "Error enviando push", description: errorText, tone: "error" });
    } finally {
      setPushSending(false);
    }
  }

  const selectedMonthLabel = monthLabel(month);
  const previousMonthLabel = monthLabel(previousMonth);
  const accessTotals = clientAccess?.totals || {};

  return (
    <div className={styles.dashboard}>
      <section className={styles.heroCard}>
        <div className={styles.heroGlow} />
        <div className={styles.heroGrid} />
        <div className={styles.heroContent}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}><Gamepad2 size={13} aria-hidden="true" /> Centro de mando</span>
            <div className={styles.heroTitleRow}>
              <span className={styles.heroIcon}><Zap size={25} aria-hidden="true" /></span>
              <div>
                <h2>Dashboard ejecutivo</h2>
                <p>Indicadores reales, actividad operativa y señales inteligentes del negocio.</p>
              </div>
            </div>
          </div>
          <div className={styles.heroActions}>
            <span className={styles.periodBadge}><Clock3 size={14} aria-hidden="true" /> {selectedMonthLabel}</span>
            <button className={`tc-btn tc-btn-gold ${styles.primaryButton}`} onClick={() => loadDashboard(false)} disabled={loading}>
              <RefreshCw size={16} className={loading ? styles.spinning : ""} aria-hidden="true" />
              {loading ? "Actualizando..." : "Actualizar dashboard"}
            </button>
          </div>
        </div>
        <div className={styles.syncBar}>
          <span className={styles.syncDot} />
          <span>{msg || "Sincronización automática cada 20 segundos"}</span>
          <span className={styles.syncSource}>Supabase · Facturas · Reservas · Actividad</span>
        </div>
      </section>

      <section className={styles.kpiGrid} aria-label="Estadísticas principales del Dashboard">
        <GameKpi
          label="Facturación visible"
          value={eur(totalFacturacion)}
          numericValue={totalFacturacion}
          icon={<Euro size={21} aria-hidden="true" />}
          accent="gold"
          comparison={facturacionComparison}
          periodLabel="vs mes anterior"
          previousDisplay={facturacionComparison.hasPrevious ? eur(Number(previousStatsTotals?.revenue_total || 0)) : undefined}
          meta="Cobros oficiales del mes"
        />
        <GameKpi
          label="Clientes hoy"
          value={String(diarioRows.length)}
          numericValue={diarioRows.length}
          icon={<Users size={21} aria-hidden="true" />}
          accent="green"
          comparison={clientsTodayComparison}
          periodLabel="vs ayer"
          previousDisplay={clientsTodayComparison.hasPrevious ? String(yesterdayRows.length) : undefined}
          meta="Compras registradas"
        />
        <GameKpi
          label="Reservas pendientes"
          value={String(pendingSelectedMonth)}
          numericValue={pendingSelectedMonth}
          icon={<CalendarClock size={21} aria-hidden="true" />}
          accent="orange"
          comparison={reservasComparison}
          periodLabel="vs mes anterior"
          previousDisplay={String(pendingPreviousMonth)}
          meta={`${pendientes} activas totales`}
        />
        <GameKpi
          label="Tarotistas con datos"
          value={String(statsRows.length)}
          numericValue={statsRows.length}
          icon={<Trophy size={21} aria-hidden="true" />}
          accent="purple"
          comparison={tarotistasComparison}
          periodLabel="vs mes anterior"
          previousDisplay={tarotistasComparison.hasPrevious ? String(previousStatsRows.length) : undefined}
          meta="Rendimiento mensual"
        />
        <GameKpi
          label="Clientes online"
          value={String(accessTotals?.online_now || 0)}
          numericValue={Number(accessTotals?.online_now || 0)}
          icon={<Wifi size={21} aria-hidden="true" />}
          accent="blue"
          comparison={noHistoricalComparison}
          periodLabel="snapshot actual"
          meta="Ventana de 3 minutos"
        />
        <GameKpi
          label="Accesos hoy"
          value={String(accessTotals?.active_today || 0)}
          numericValue={Number(accessTotals?.active_today || 0)}
          icon={<LogIn size={21} aria-hidden="true" />}
          accent="pink"
          comparison={noHistoricalComparison}
          periodLabel="sin registro histórico diario"
          meta="Dato real disponible"
        />
      </section>

      <section className={styles.panelCard}>
        <div className={styles.panelGlow} />
        <div className={styles.sectionHeading}>
          <div className={styles.sectionTitleGroup}>
            <span className={`${styles.sectionIcon} ${styles.iconPurple}`}><BellRing size={20} aria-hidden="true" /></span>
            <div>
              <span className={styles.sectionKicker}>Acción directa</span>
              <h3>Enviar notificación a clientes</h3>
              <p>Envía un push a los clientes que ya tienen activadas las notificaciones.</p>
            </div>
          </div>
          <span className={styles.gameChip}><Sparkles size={13} aria-hidden="true" /> Push manual</span>
        </div>

        <div className={styles.pushGrid}>
          <label className={styles.fieldGroup}>
            <span>Título</span>
            <input
              className={`tc-input ${styles.gameInput}`}
              value={pushTitle}
              onChange={(event) => setPushTitle(event.target.value)}
              placeholder="Título de la notificación"
            />
          </label>
          <label className={`${styles.fieldGroup} ${styles.messageField}`}>
            <span>Mensaje</span>
            <textarea
              className={`tc-textarea ${styles.gameTextarea}`}
              value={pushBody}
              onChange={(event) => setPushBody(event.target.value)}
              placeholder="Escribe el mensaje que verán los clientes..."
              rows={4}
            />
          </label>
          <div className={styles.pushFooter}>
            <div className={styles.pushHint}><CircleAlert size={15} aria-hidden="true" /> También se guarda en el historial interno del cliente.</div>
            <button
              className={`tc-btn tc-btn-gold ${styles.primaryButton}`}
              onClick={sendClientPush}
              disabled={pushSending || !pushTitle.trim() || !pushBody.trim()}
            >
              <Send size={16} aria-hidden="true" /> {pushSending ? "Enviando..." : "Enviar notificación"}
            </button>
          </div>
          {pushMsg ? (
            <div className={`${styles.pushMessage} ${pushMsg.startsWith("Error") ? styles.pushError : styles.pushSuccess}`}>
              {pushMsg}
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.panelCard}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionTitleGroup}>
            <span className={`${styles.sectionIcon} ${styles.iconOrange}`}><ShieldAlert size={20} aria-hidden="true" /></span>
            <div>
              <span className={styles.sectionKicker}>Sistema de señales</span>
              <h3>Alertas inteligentes</h3>
              <p>Lecturas automáticas generadas con la lógica y los datos actuales del negocio.</p>
            </div>
          </div>
          <span className={styles.liveBadge}><span /> {alertas.length} señales activas</span>
        </div>

        <div className={styles.alertGrid}>
          {alertas.map((alerta, index) => (
            <article key={`${alerta.title}-${index}`} className={`${styles.alertCard} ${alertToneClass(alerta.tone)}`}>
              <div className={styles.alertTopline}>
                <span className={styles.alertIcon}><AlertIcon tone={alerta.tone} /></span>
                <span className={styles.alertStatus}>{alertStatusLabel(alerta.tone)}</span>
              </div>
              <h4>{alerta.title}</h4>
              <p>{alerta.description}</p>
              <div className={styles.alertPulse}><span /> Señal calculada en tiempo real</div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.panelCard}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionTitleGroup}>
            <span className={`${styles.sectionIcon} ${styles.iconGreen}`}><Activity size={20} aria-hidden="true" /></span>
            <div>
              <span className={styles.sectionKicker}>Presencia digital</span>
              <h3>Actividad panel cliente</h3>
              <p>Accesos, actividad reciente y estado de conexión detectado por la lógica actual.</p>
            </div>
          </div>
          <span className={styles.gameChip}><Radio size={13} aria-hidden="true" /> Estado en vivo</span>
        </div>

        <div className={`${styles.kpiGrid} ${styles.activityKpiGrid}`}>
          <GameKpi
            label="Online ahora"
            value={String(accessTotals?.online_now || 0)}
            numericValue={Number(accessTotals?.online_now || 0)}
            icon={<Wifi size={19} aria-hidden="true" />}
            accent="green"
            comparison={noHistoricalComparison}
            periodLabel="snapshot actual"
            meta="Últimos 3 min"
            compact
          />
          <GameKpi
            label="Activos hoy"
            value={String(accessTotals?.active_today || 0)}
            numericValue={Number(accessTotals?.active_today || 0)}
            icon={<UserRoundCheck size={19} aria-hidden="true" />}
            accent="blue"
            comparison={noHistoricalComparison}
            periodLabel="sin histórico diario"
            meta="Acceso reciente"
            compact
          />
          <GameKpi
            label="Inactivos 7d"
            value={String(accessTotals?.inactive_7d || 0)}
            numericValue={Number(accessTotals?.inactive_7d || 0)}
            icon={<UserRoundX size={19} aria-hidden="true" />}
            accent="orange"
            comparison={noHistoricalComparison}
            periodLabel="sin snapshot anterior"
            meta="Lógica existente"
            compact
          />
          <GameKpi
            label="Accesos totales"
            value={numES(accessTotals?.total_accesses || 0)}
            numericValue={Number(accessTotals?.total_accesses || 0)}
            icon={<MousePointerClick size={19} aria-hidden="true" />}
            accent="purple"
            comparison={noHistoricalComparison}
            periodLabel="acumulado real"
            meta="Sin serie histórica"
            compact
          />
        </div>

        <div className={styles.activityList}>
          {(clientAccess?.latest || []).slice(0, 6).map((row: any) => {
            const status = clientActivityStatus(row);
            const fullName = [row?.nombre, row?.apellido].filter(Boolean).join(" ").trim() || "Cliente";
            return (
              <article key={row.id} className={`${styles.activityRow} ${styles[`status_${status.key}`] || ""}`}>
                <div className={styles.avatar}>{fullName.slice(0, 1).toUpperCase()}</div>
                <div className={styles.activityIdentity}>
                  <strong>{fullName}</strong>
                  <span>{status.detail}</span>
                </div>
                <div className={styles.activityDates}>
                  <div>
                    <span>Último acceso</span>
                    <strong>{row?.ultimo_acceso_at ? new Date(row.ultimo_acceso_at).toLocaleString("es-ES") : "—"}</strong>
                  </div>
                  <div>
                    <span>Última actividad</span>
                    <strong>{row?.ultima_actividad_at ? new Date(row.ultima_actividad_at).toLocaleString("es-ES") : "—"}</strong>
                  </div>
                </div>
                <div className={styles.activityState}>
                  <span className={styles.stateDot} />
                  <div>
                    <strong>{status.label}</strong>
                    <span>{status.detail}</span>
                  </div>
                </div>
              </article>
            );
          })}
          {!clientAccess?.latest?.length ? (
            <div className={styles.emptyState}>
              <Activity size={24} aria-hidden="true" />
              <strong>Sin actividad reciente</strong>
              <span>Todavía no hay registros de clientes para mostrar.</span>
            </div>
          ) : null}
        </div>
      </section>

      <div className={styles.dataNotice}>
        <CheckCircle2 size={16} aria-hidden="true" />
        <span>Comparaciones activas: facturación {selectedMonthLabel} vs {previousMonthLabel}, clientes de hoy vs ayer, reservas y tarotistas vs mes anterior.</span>
      </div>
    </div>
  );
}
