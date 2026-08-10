"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import nextDynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { TC_EVENTS, TC_LEGACY_EVENTS, emitTcEvent, listenTcEvent } from "@/lib/tc-events";











import { BarChart3, BookOpen, CalendarDays, ChevronDown, CreditCard, KeyRound, LayoutDashboard, Megaphone, Phone, ShieldCheck, Users, Trophy } from "lucide-react";
import adminStyles from "./AdminPremium.module.css";

const sb = supabaseBrowser();
const DashboardPanel = nextDynamic(() => import("@/components/admin/DashboardPanel"), { ssr:false });
const StatisticsPanel = nextDynamic(() => import("@/components/admin/StatisticsPanel"), { ssr:false });
const OperatorPanel = nextDynamic(() => import("@/components/panel/OperatorPanel"), { ssr:false });
const AdminClientesTab = nextDynamic(() => import("@/components/admin/AdminClientesTab"), { ssr:false });
const CRMClientesPanel = nextDynamic(() => import("@/components/crm/CRMClientesPanel"), { ssr:false });
const ReservasPanel = nextDynamic(() => import("@/components/reservas/ReservasPanel"), { ssr:false });
const ReservasGlobalWatcher = nextDynamic(() => import("@/components/reservas/ReservasGlobalWatcher"), { ssr:false });
const DiarioPanel = nextDynamic(() => import("@/components/diario/DiarioPanel"), { ssr:false });
const PaymentMotivationWatcher = nextDynamic(() => import("@/components/motivation/PaymentMotivationWatcher"), { ssr:false });
const AdminChatPanel = nextDynamic(() => import("@/components/admin/AdminChatPanel"), { ssr:false });
const RendimientoPanel = nextDynamic(() => import("@/components/rendimiento/RendimientoPanel"), { ssr:false });
const CaptacionPanel = nextDynamic(() => import("@/components/captacion/CaptacionPanel"), { ssr:false });
const CollaboratorBillingReport = nextDynamic(() => import("@/components/admin/CollaboratorBillingReport"), { ssr:false });
const ClientRanksAdminPanel = nextDynamic(() => import("@/components/admin/ClientRanksAdminPanel"), { ssr:false });
const ClientWebAdminPanel = nextDynamic(() => import("@/components/admin/ClientWebAdminPanel"), { ssr:false });
const ManualInvoiceModal = nextDynamic(() => import("@/components/admin/ManualInvoiceModal"), { ssr:false });


const ADMIN_NAV = [
  { key: "dashboard", icon: LayoutDashboard, label: "Dashboard", kicker: "Control ejecutivo", tone: "gold" },
  { key: "panel", icon: Phone, label: "Panel", kicker: "Extensiones y llamadas", tone: "cyan" },
  { key: "facturas", icon: CreditCard, label: "Facturación", kicker: "Ingresos y cierre", tone: "emerald" },
  { key: "editor", icon: BookOpen, label: "Editor", kicker: "Factura abierta", tone: "violet" },
  { key: "estadisticas", icon: BarChart3, label: "Estadísticas", kicker: "Rendimiento global", tone: "blue" },
  { key: "asistencia", icon: ShieldCheck, label: "Asistencia", kicker: "Control operativo", tone: "mint" },
  { key: "trabajadores", icon: KeyRound, label: "Trabajadores", kicker: "Roles y accesos", tone: "purple" },
  { key: "clientes", icon: Users, label: "Clientes", kicker: "Vista premium", tone: "violet" },
  { key: "rangos-clientes", icon: Trophy, label: "Rangos de clientes", kicker: "Gestión y auditoría", tone: "goldPurple" },
  { key: "crm", icon: LayoutDashboard, label: "CRM", kicker: "Fichas y cobros", tone: "magenta" },
  { key: "chat", icon: LayoutDashboard, label: "Chat", kicker: "Consultas de pago", tone: "indigo" },
  { key: "captacion", icon: Megaphone, label: "Captación", kicker: "Leads y seguimiento", tone: "orange" },
  { key: "rendimiento", icon: BarChart3, label: "Rendimiento", kicker: "Llamadas registradas", tone: "blue" },
  { key: "reservas", icon: CalendarDays, label: "Reservas", kicker: "Agenda interna", tone: "gold" },
  { key: "diario", icon: CalendarDays, label: "Diario", kicker: "Compras del día", tone: "cyan" },
] as const;

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) return monthKeyNow();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function storedMoney(n: any, currency = "EUR") {
  const x = Number(n) || 0;
  if (currency === "MULTI") return `${numES(x, 2)} · varias monedas`;
  try {
    return x.toLocaleString("es-ES", { style: "currency", currency: currency || "EUR" });
  } catch {
    return `${numES(x, 2)} ${currency || "EUR"}`;
  }
}

function storedCurrencyBreakdown(values: Record<string, number> | null | undefined) {
  const entries = Object.entries(values || {});
  if (!entries.length) return storedMoney(0, "EUR");
  return entries.map(([currency, total]) => storedMoney(total, currency)).join(" · ");
}

function numES(n: any, digits = 2) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function minsToHhmm(mins: any) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dayName(day: any) {
  const d = Number(day);
  if (d === 0) return "Domingo";
  if (d === 1) return "Lunes";
  if (d === 2) return "Martes";
  if (d === 3) return "Miércoles";
  if (d === 4) return "Jueves";
  if (d === 5) return "Viernes";
  if (d === 6) return "Sábado";
  return "—";
}

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

type TabKey =
  | "dashboard"
  | "panel"
  | "facturas"
  | "editor"
  | "estadisticas"
  | "asistencia"
  | "trabajadores"
  | "clientes"
  | "rangos-clientes"
  | "clientes-web"
  | "crm"
  | "chat"
  | "captacion"
  | "rendimiento"
  | "reservas"
  | "diario";

function ackLabel(v: any) {
  const s = String(v || "pending");
  if (s === "accepted") return "✅ Aceptada";
  if (s === "rejected") return "❌ Rechazada";
  if (s === "review") return "🟡 Revisión";
  if (s === "not_applicable") return "◇ No aplica";
  return "⏳ Pendiente";
}

function ackStyle(v: any) {
  const s = String(v || "pending");
  if (s === "accepted") {
    return {
      background: "rgba(120,255,190,0.10)",
      border: "1px solid rgba(120,255,190,0.25)",
    };
  }
  if (s === "rejected") {
    return {
      background: "rgba(255,80,80,0.10)",
      border: "1px solid rgba(255,80,80,0.25)",
    };
  }
  if (s === "review") {
    return {
      background: "rgba(215,181,109,0.10)",
      border: "1px solid rgba(215,181,109,0.25)",
    };
  }
  if (s === "not_applicable") {
    return {
      background: "rgba(181,156,255,0.08)",
      border: "1px solid rgba(181,156,255,0.22)",
    };
  }
  return {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
  };
}

function formatComparisonPercent(value: any, trend: string, hasPrevious: boolean) {
  if (!hasPrevious) return "Sin histórico";
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return trend === "up" ? "Nuevo" : trend === "down" ? "Sin actividad" : "0,00 %";
  }
  const numeric = Number(value) || 0;
  return `${numeric > 0 ? "+" : ""}${numES(numeric, 2)} %`;
}

function trendSymbol(trend: string) {
  if (trend === "up") return "↗";
  if (trend === "down") return "↘";
  return "→";
}

function InvoiceMiniTrend({ invoice }: { invoice: any }) {
  const trend = String(invoice?.minutes_trend || "neutral");
  const hasPrevious = Boolean(invoice?.has_previous_invoice) && invoice?.previous_minutes !== null;
  const current = Math.max(0, Number(invoice?.current_minutes || 0));
  const previous = Math.max(0, Number(invoice?.previous_minutes || 0));
  const maxValue = Math.max(current, previous, 1);
  const previousY = hasPrevious ? 28 - (previous / maxValue) * 20 : 18;
  const currentY = hasPrevious ? 28 - (current / maxValue) * 20 : 18;
  const path = `M 4 ${previousY.toFixed(2)} C 24 ${previousY.toFixed(2)}, 54 ${currentY.toFixed(2)}, 80 ${currentY.toFixed(2)}`;
  const percentLabel = formatComparisonPercent(invoice?.minutes_change_pct, trend, hasPrevious);
  const fixedSalary = String(invoice?.trend_basis || "") === "fixed_salary";

  return (
    <div
      className={`tc-invoice-mini-trend tc-invoice-trend-${trend}`}
      title={
        fixedSalary
          ? "Perfil central con importe fijo: no existe tendencia por minutos."
          : hasPrevious
            ? `${numES(current, 0)} min este mes frente a ${numES(previous, 0)} min el mes anterior.`
            : "No existe una factura del mes anterior para calcular la tendencia."
      }
    >
      <svg viewBox="0 0 84 34" role="img" aria-label={`Tendencia ${trend}`}>
        <path className="tc-invoice-spark-area" d={`${path} L 80 32 L 4 32 Z`} />
        <path className="tc-invoice-spark-line" d={path} />
        <circle className="tc-invoice-spark-dot" cx="4" cy={previousY} r="2.4" />
        <circle className="tc-invoice-spark-dot" cx="80" cy={currentY} r="2.8" />
      </svg>
      <div className="tc-invoice-trend-copy">
        <strong>{trendSymbol(trend)} {fixedSalary ? "Fijo" : percentLabel}</strong>
        <span>{fixedSalary ? "Central" : hasPrevious ? `${numES(current, 0)} min` : "Sin datos"}</span>
      </div>
    </div>
  );
}

function PreviousMonthComparison({ invoice }: { invoice: any }) {
  const hasPrevious = Boolean(invoice?.has_previous_invoice);
  const trend = String(invoice?.total_trend || "neutral");
  const percentLabel = invoice?.comparison_note
    ? String(invoice.comparison_note)
    : formatComparisonPercent(invoice?.total_change_pct, trend, hasPrevious);
  const previousValue = invoice?.is_collaborator
    ? storedCurrencyBreakdown(invoice?.previous_generated_by_currency)
    : eur(invoice?.previous_total || 0);

  return (
    <div className={`tc-invoice-comparison tc-invoice-trend-${trend}`}>
      <span className="tc-invoice-comparison-label">
        {hasPrevious ? `Mes anterior: ${previousValue}` : "Mes anterior: sin datos"}
      </span>
      <strong>{trendSymbol(trend)} {percentLabel}</strong>
    </div>
  );
}

function AdminPage() {
  const searchParams = useSearchParams();
  const [ok, setOk] = useState(false);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [ranksMenuOpen, setRanksMenuOpen] = useState(false);

  useEffect(() => {
    const onOpenCrmTab = () => setTab("crm" as any);
    window.addEventListener("tc-open-crm-tab", onOpenCrmTab);
    return () => window.removeEventListener("tc-open-crm-tab", onOpenCrmTab);
  }, []);
  const [crmCloseNotif, setCrmCloseNotif] = useState<any>(null);
  const [crmDismissedIds, setCrmDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    const requestedTab = String(searchParams?.get("tab") || "").trim().toLowerCase();
    if (!requestedTab) return;

    const rankAliasMap: Record<string, string> = {
      bronzes: "bronce",
      bronze: "bronce",
      silvers: "plata",
      silver: "plata",
      golds: "oro",
      gold: "oro",
    };

    if (rankAliasMap[requestedTab]) {
      setTab("crm");
      return;
    }

    const allowedTabs = new Set<string>([...ADMIN_NAV.map((item) => item.key), "clientes-web"]);
    if (allowedTabs.has(requestedTab as any)) {
      setTab(requestedTab as TabKey);
      if (requestedTab === "rangos-clientes" || requestedTab === "clientes-web") setRanksMenuOpen(true);
    }
  }, [searchParams]);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  const [month, setMonth] = useState<string>(monthKeyNow());

  const [genLoading, setGenLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<string>("");

  const [listLoading, setListLoading] = useState(false);
  const [listMsg, setListMsg] = useState<string>("");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [manualInvoiceOpen, setManualInvoiceOpen] = useState(false);
  const [manualInvoiceId, setManualInvoiceId] = useState<string | null>(null);

  const [selId, setSelId] = useState<string>("");
  const [selLoading, setSelLoading] = useState(false);
  const [selMsg, setSelMsg] = useState<string>("");
  const [selInvoice, setSelInvoice] = useState<any>(null);
  const [selWorker, setSelWorker] = useState<any>(null);
  const [selLines, setSelLines] = useState<any[]>([]);
  const [selCollaboratorReport, setSelCollaboratorReport] = useState<any>(null);
  const [newLabel, setNewLabel] = useState("Ajuste");
  const [newAmount, setNewAmount] = useState<string>("0");
  const [newKind, setNewKind] = useState("adjustment");

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsMsg, setStatsMsg] = useState("");
  const [statsTotals, setStatsTotals] = useState<any>(null);
  const [statsRows, setStatsRows] = useState<any[]>([]);
  const [statsPreviousTotals, setStatsPreviousTotals] = useState<any>(null);
  const [statsPreviousRows, setStatsPreviousRows] = useState<any[]>([]);
  const [statsPreviousInvoiceSummary, setStatsPreviousInvoiceSummary] = useState<any>(null);
  const [statsTop, setStatsTop] = useState<any>({ captadas: [], cliente: [], repite: [] });
  const [statsTeams, setStatsTeams] = useState<any>({ fuego: null, agua: null, winner: "empate" });
  const [statsLiveStatus, setStatsLiveStatus] = useState<"connecting" | "live" | "updating" | "reconnecting" | "offline">("connecting");
  const [heroVipCount, setHeroVipCount] = useState(0);
  const [heroMetrics, setHeroMetrics] = useState<any>({ leads_mes: 0, captadas_mes: 0, facturacion_mes: 0 });


  async function loadHeroMetricsDirect() {
    try {
      const activeBrand = getActiveBrand();
      const response = await fetch(`/api/admin/dashboard?month=${encodeURIComponent(month)}&brand=${encodeURIComponent(activeBrand)}`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || "ERR_ADMIN_DASHBOARD");
      setHeroMetrics({
        leads_mes: Number(json.leads_mes || 0),
        captadas_mes: Number(json.captadas_mes || 0),
        facturacion_mes: Number(json.facturacion_mes || 0),
      });
    } catch (err) {
      console.error("Hero metrics error:", err);
    }
  }

  const pollRef = useRef<any>(null);
  const lastMonthRef = useRef<string>("");
  const statsFetchInFlightRef = useRef(false);
  const statsRefreshQueuedRef = useRef(false);
  const statsRealtimeTimerRef = useRef<number | null>(null);
  const invoiceRealtimeTimerRef = useRef<number | null>(null);
  const statsSelectedMonthRef = useRef(month);
  const statsViewActiveRef = useRef(false);
  statsSelectedMonthRef.current = month;
  statsViewActiveRef.current = ok && tab === "estadisticas";

  const totalSum = useMemo(() => {
    return (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
  }, [invoices]);

  const invoiceSummary = useMemo(() => {
    const rows = invoices || [];
    return {
      count: rows.length,
      accepted: rows.filter((x: any) => String(x?.worker_ack || "pending") === "accepted").length,
      rising: rows.filter((x: any) => String(x?.minutes_trend || "neutral") === "up").length,
      pending: rows.filter((x: any) => !x?.worker_ack || String(x.worker_ack) === "pending").length,
    };
  }, [invoices]);

  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const [attOnline, setAttOnline] = useState<any[]>([]);
  const [attExpected, setAttExpected] = useState<any[]>([]);
  const [attIncidents, setAttIncidents] = useState<any[]>([]);
  const [attNote, setAttNote] = useState<string>("");

  const [stLoading, setStLoading] = useState(false);
  const [stMsg, setStMsg] = useState("");
  const [stRows, setStRows] = useState<any[]>([]);
  const [stWorkerId, setStWorkerId] = useState<string>("");
  const [stGroup, setStGroup] = useState<"day" | "week" | "month">("day");
  const [stFrom, setStFrom] = useState<string>("");
  const [stTo, setStTo] = useState<string>("");

  const [accLoading, setAccLoading] = useState(false);
  const [accMsg, setAccMsg] = useState("");
  const [accTotals, setAccTotals] = useState<any>({ income: 0, expense: 0, net: 0 });
  const [accEntries, setAccEntries] = useState<any[]>([]);
  const [accMonths, setAccMonths] = useState<any[]>([]);
  const [accBreakdown, setAccBreakdown] = useState<any>({ income: [], expense: [] });

  // Staff / horarios
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffMsg, setStaffMsg] = useState("");
  const [staffWorkers, setStaffWorkers] = useState<any[]>([]);
  const [staffSchedules, setStaffSchedules] = useState<any[]>([]);
  const [staffQ, setStaffQ] = useState("");

  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState<"tarotista" | "central" | "admin">("tarotista");
  const [newWorkerTeam, setNewWorkerTeam] = useState("");
  const [newWorkerEmail, setNewWorkerEmail] = useState("");
  const [newWorkerLevel, setNewWorkerLevel] = useState<1 | 2>(1);

  const [scheduleWorkerId, setScheduleWorkerId] = useState("");
  const [scheduleDay, setScheduleDay] = useState("1");
  const [scheduleStart, setScheduleStart] = useState("10:00:00");
  const [scheduleEnd, setScheduleEnd] = useState("18:00:00");
  const [scheduleTimezone, setScheduleTimezone] = useState("Europe/Madrid");

  const [editingWorkerId, setEditingWorkerId] = useState("");
  const [editingWorkerName, setEditingWorkerName] = useState("");
  const [editingWorkerRole, setEditingWorkerRole] = useState<"tarotista" | "central" | "admin">("tarotista");
  const [editingWorkerTeam, setEditingWorkerTeam] = useState("");
  const [editingWorkerEmail, setEditingWorkerEmail] = useState("");
  const [editingWorkerLevel, setEditingWorkerLevel] = useState<1 | 2>(1);
  const [passwordWorkerId, setPasswordWorkerId] = useState("");
  const [passwordValue, setPasswordValue] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tc_month_admin");
      if (saved) setMonth(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("tc_month_admin", month);
    } catch {}
  }, [month]);

  useEffect(() => {
    const openCaptacion = () => setTab("captacion");
    const openParking = () => setTab("panel");

    const cleanupCaptacion = listenTcEvent(
      [TC_EVENTS.openCaptacion, TC_LEGACY_EVENTS.openCaptacion],
      openCaptacion as EventListener
    );
    const cleanupParking = listenTcEvent(
      [TC_EVENTS.openParking, TC_LEGACY_EVENTS.openParking],
      openParking as EventListener
    );

    return () => {
      cleanupCaptacion();
      cleanupParking();
    };
  }, []);

  useEffect(() => {
    emitTcEvent(TC_EVENTS.activeTabChanged, { tab, surface: "admin" });
  }, [tab]);

  useEffect(() => {
  (async () => {
    try {
      const cachedRole = sessionStorage.getItem("tc_admin_role");
      const cachedTs = Number(sessionStorage.getItem("tc_admin_role_ts") || "0");

      if (cachedRole === "admin" && Date.now() - cachedTs < 300000) {
        setOk(true);
        return;
      }

      const { data } = await sb.auth.getSession();
      const user = data.session?.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: worker, error } = await sb
        .from("workers")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !worker) {
        console.error("❌ No se encontró worker:", error);
        window.location.href = "/login";
        return;
      }

      const role = worker.role?.toLowerCase();

      sessionStorage.setItem("tc_admin_role", role || "");
      sessionStorage.setItem("tc_admin_role_ts", String(Date.now()));

      if (role !== "admin") {
        window.location.href =
          role === "central" ? "/panel-central" : "/panel-tarotista";
        return;
      }

      setOk(true);
    } catch (e) {
      console.error("admin auth error", e);
    }
  })();
}, []);

  useEffect(() => {
    if (!ok) return;
    const bgTimer = window.setTimeout(() => setBackgroundReady(true), 8000);

    if(backgroundReady){loadLatestCrmCloseNotif(true);}

    const channel = sb
      .channel("crm-close-notifs-admin")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_call_close_notifications",
        },
        (payload) => {
          const n: any = payload.new;
          if (!crmDismissedIds.includes(String(n?.id || ""))) {
            setCrmCloseNotif(n);
          }
        }
      )
      .subscribe();

    const timer = setInterval(() => {
      if(backgroundReady){loadLatestCrmCloseNotif(true);}
    }, 180000);

    return () => {
      clearInterval(timer);
      sb.removeChannel(channel);
    };
  return ()=> window.clearTimeout(bgTimer);
  }, [ok]);


  async function loadLatestCrmCloseNotif(silent = false) {
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/crm/call-close-notifications/latest", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) return;
      const notif = j.notification || null;
      if (!notif?.id) return;
      if (crmDismissedIds.includes(String(notif.id))) return;
      setCrmCloseNotif(notif);
    } catch {}
  }


  async function markCrmCloseNotifRead(id: string) {
    try {
      const token = await getTokenOrLogin();
      if (!token || !id) return;

      await fetch("/api/admin/crm/call-close-notifications/mark-read", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  function openAdminClienteReview(clienteId: string) {
    if (!clienteId) return;
    setTab("crm");
    window.setTimeout(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("crm-open-cliente", {
            detail: { id: String(clienteId) },
          })
        );
      }
    }, 250);
  }

  useEffect(() => {
    function onOpenFromCaptacion(e: any) {
      const id = String(e?.detail?.id || "").trim();
      if (!id) return;
      setTab("crm" as any);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("crm-open-cliente", { detail: { id } }));
      }, 250);
    }

    window.addEventListener("captacion-open-cliente", onOpenFromCaptacion);
    return () => window.removeEventListener("captacion-open-cliente", onOpenFromCaptacion);
  }, []);

  function openReservaFromPopup(reserva: any) {
    setTab("reservas");
    window.setTimeout(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("reservas-open-item", {
            detail: { id: String(reserva?.id || "") },
          })
        );
      }
    }, 250);
  }

  async function syncNow() {
    if (syncLoading) return;
    setSyncLoading(true);
    setSyncMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/sync/calls", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
      setSyncMsg(`✅ Sincronización OK. Upserted: ${j.upserted ?? 0}`);
    } catch (e: any) {
      setSyncMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSyncLoading(false);
    }
  }

  async function generateInvoices() {
  if (genLoading) return;
  setGenLoading(true);
  setGenMsg("");

  try {
    const token = await getTokenOrLogin();
    if (!token) return;

    const r = await fetch("/api/invoices/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ month }),
    });

    const j = await safeJson(r);

    if (!j?._ok || !j?.ok) {
      throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
    }

    const created = Number(j?.created || 0);
    const updated = Number(j?.updated || 0);
    const sourceRows = Number(j?.source_rows || 0);

    setGenMsg(`✅ Facturas generadas para ${month}. Nuevas: ${created} · Actualizadas: ${updated} · Registros de rendimiento usados: ${sourceRows}`);

    await listInvoices();
    setTab("facturas");

  } catch (e: any) {
    setGenMsg(`❌ ${e?.message || "Error"}`);
  } finally {
    setGenLoading(false);
  }
}

  async function listInvoices(silent = false) {
    if (listLoading && !silent) return;
    if (!silent) {
      setListLoading(true);
      setListMsg("");
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(
        `/api/admin/invoices/list?month=${encodeURIComponent(month)}&t=${Date.now()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setInvoices(j.invoices || []);
      if (!silent) setListMsg(`✅ Cargadas ${j.invoices?.length ?? 0} facturas (${month}).`);
    } catch (e: any) {
      if (!silent) setListMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setListLoading(false);
    }
  }

  async function loadCollaboratorReport(invoiceId: string, silent = false) {
    const parts = String(invoiceId || "").split(":");
    const collaboratorId = parts[1] || "";
    const reportMonth = parts[2] || month;
    if (!collaboratorId) throw new Error("COLLABORATOR_ID_INVALID");

    if (!silent) {
      setSelLoading(true);
      setSelMsg("");
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;
      const r = await fetch(
        `/api/admin/invoices/collaborator?collaborator_id=${encodeURIComponent(collaboratorId)}&month=${encodeURIComponent(reportMonth)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setSelId(invoiceId);
      setSelCollaboratorReport(j.report);
      setSelInvoice(null);
      setSelWorker(null);
      setSelLines([]);
      if (!silent) setTab("editor");
    } catch (e: any) {
      if (!silent) setSelMsg(`❌ ${e?.message || "Error"}`);
      throw e;
    } finally {
      if (!silent) setSelLoading(false);
    }
  }

  async function deleteCollaboratorReportRecord(payload: {
    recordType: "service" | "payment";
    source: "rendimiento_llamadas" | "crm_cliente_pagos";
    recordId: string;
    reason: string;
    note?: string;
  }) {
    if (!selId || !String(selId).startsWith("collaborator:")) throw new Error("COLLABORATOR_ID_INVALID");
    const [, collaboratorId, reportMonth] = String(selId).split(":");
    if (!collaboratorId) throw new Error("COLLABORATOR_ID_INVALID");

    setSelLoading(true);
    setSelMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) throw new Error("NO_AUTH");

      const response = await fetch("/api/admin/invoices/collaborator", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collaborator_id: collaboratorId,
          month: reportMonth || month,
          record_type: payload.recordType,
          source: payload.source,
          record_id: payload.recordId,
          reason: payload.reason,
          note: payload.note || null,
        }),
      });

      const result = await safeJson(response);
      if (!result?._ok || !result?.ok) {
        throw new Error(result?.error || `HTTP ${result?._status}. ${result?._raw || "(vacía)"}`);
      }

      if (result.report) setSelCollaboratorReport(result.report);
      await listInvoices(true);
    } catch (error: any) {
      console.error("[Mario report delete]", error);
      throw error;
    } finally {
      setSelLoading(false);
    }
  }

  async function loadInvoice(invoice_id: string) {
    if (!invoice_id) return;
    if (String(invoice_id).startsWith("collaborator:")) {
      try {
        await loadCollaboratorReport(invoice_id, false);
      } catch {}
      return;
    }

    setSelLoading(true);
    setSelMsg("");
    setSelId(invoice_id);
    setSelCollaboratorReport(null);
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/admin/invoices/edit?invoice_id=${encodeURIComponent(invoice_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setSelInvoice(j.invoice);
      setSelWorker(j.worker);
      setSelLines(j.lines || []);
      setTab("editor");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSelLoading(false);
    }
  }

  async function postEdit(payload: any) {
    const token = await getTokenOrLogin();
    if (!token) return null;

    const r = await fetch("/api/admin/invoices/edit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const j = await safeJson(r);
    if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
    return j;
  }

  async function addLine() {
    if (!selId) return;
    try {
      const amt = Number(String(newAmount).replace(",", "."));
      await postEdit({
        action: "add_line",
        invoice_id: selId,
        kind: newKind,
        label: newLabel,
        amount: isFinite(amt) ? amt : 0,
        meta: {},
      });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Línea añadida.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function updateLine(line_id: string, payload: { label: string; amount?: number; meta?: any }) {
    if (!selId) return;
    try {
      await postEdit({
        action: "update_line",
        invoice_id: selId,
        line_id,
        label: payload.label,
        amount: payload.amount,
        meta: payload.meta,
      });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Guardado.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function deleteLine(line_id: string) {
    if (!selId) return;
    if (!confirm("¿Borrar esta línea?")) return;
    try {
      await postEdit({ action: "delete_line", invoice_id: selId, line_id });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Línea borrada.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function setStatus(status: string) {
    if (!selId) return;
    try {
      await postEdit({ action: "set_status", invoice_id: selId, status });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Estado actualizado.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function downloadInvoicePdf(invoiceId: string) {
    if (!invoiceId) return;
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      let endpoint = `/api/admin/invoices/pdf?invoice_id=${encodeURIComponent(invoiceId)}`;
      if (String(invoiceId).startsWith("manual:")) {
        endpoint = `/api/admin/invoices/manual/pdf?id=${encodeURIComponent(String(invoiceId).replace("manual:", ""))}`;
      } else if (String(invoiceId).startsWith("collaborator:")) {
        const [, collaboratorId, reportMonth] = String(invoiceId).split(":");
        endpoint = `/api/admin/invoices/collaborator/pdf?collaborator_id=${encodeURIComponent(collaboratorId || "")}&month=${encodeURIComponent(reportMonth || month)}`;
      }

      const r = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const html = await r.text();
      if (!r.ok) throw new Error(html || `HTTP ${r.status}`);

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener,noreferrer");

      if (!win) {
        URL.revokeObjectURL(url);
        throw new Error("BLOQUEO_POPUP");
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "No se pudo abrir la factura"}`);
    }
  }

  async function loadAdminStats(
    silent = false,
    source: "manual" | "initial" | "realtime" = "manual"
  ) {
    if (statsFetchInFlightRef.current) {
      statsRefreshQueuedRef.current = true;
      return;
    }

    statsFetchInFlightRef.current = true;
    const requestMonth = statsSelectedMonthRef.current;
    if (!silent) {
      setStatsLoading(true);
      setStatsMsg("");
    }
    if (source === "realtime") setStatsLiveStatus("updating");

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const [statsRes, rankRes, invRes] = await Promise.all([
        fetch(`/api/stats/monthly?month=${encodeURIComponent(requestMonth)}&brand=${getActiveBrand()}&t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/rankings/monthly?month=${encodeURIComponent(requestMonth)}&t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/admin/invoices/list?month=${encodeURIComponent(requestMonth)}&t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const statsJ = await safeJson(statsRes);
      const rankJ = await safeJson(rankRes);
      const invJ = await safeJson(invRes);

      if (!statsJ?._ok || !statsJ?.ok) throw new Error(statsJ?.error || `HTTP ${statsJ?._status}`);
      if (!rankJ?._ok || !rankJ?.ok) throw new Error(rankJ?.error || `HTTP ${rankJ?._status}`);
      if (!invJ?._ok || !invJ?.ok) throw new Error(invJ?.error || `HTTP ${invJ?._status}`);

      if (requestMonth !== statsSelectedMonthRef.current) {
        statsRefreshQueuedRef.current = true;
        return;
      }

      setStatsTotals(statsJ.totals || null);
      setStatsRows(statsJ.rows || []);
      setStatsPreviousTotals(
        statsJ.previous
          ? { ...(statsJ.previous.totals || {}), month: statsJ.previous.month || invJ.previous_month || "" }
          : null
      );
      setStatsPreviousRows(statsJ.previous?.rows || []);
      setStatsPreviousInvoiceSummary(invJ.previous_summary || null);
      setStatsTop(rankJ.top || { captadas: [], cliente: [], repite: [] });
      setStatsTeams(rankJ.teams || { fuego: null, agua: null, winner: "empate" });
      setInvoices(invJ.invoices || []);

      if (!silent) setStatsMsg("✅ Estadísticas sincronizadas con datos reales.");
      if (source === "realtime") setStatsLiveStatus("live");
    } catch (e: any) {
      if (!silent) setStatsMsg(`❌ ${e?.message || "Error"}`);
      if (source === "realtime") setStatsLiveStatus("offline");
    } finally {
      statsFetchInFlightRef.current = false;
      if (!silent) setStatsLoading(false);

      if (statsRefreshQueuedRef.current) {
        statsRefreshQueuedRef.current = false;
        window.setTimeout(() => {
          if (statsViewActiveRef.current) void loadAdminStats(true, "realtime");
        }, 80);
      }
    }
  }

  async function loadAttendance() {
    if (attLoading) return;
    setAttLoading(true);
    setAttMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const [r1, r2] = await Promise.all([
        fetch("/api/admin/attendance/online-now", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/attendance/expected-now", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const j1 = await safeJson(r1);
      const j2 = await safeJson(r2);

      if (!j1?._ok || !j1?.ok) throw new Error(j1?.error || `HTTP ${j1?._status}`);
      if (!j2?._ok || !j2?.ok) throw new Error(j2?.error || `HTTP ${j2?._status}`);

      setAttOnline(j1.rows || j1.online || []);
      setAttExpected(j2.expected || j2.rows || []);

      const incRes = await fetch(`/api/admin/incidents/list?month=${encodeURIComponent(month)}&kind=attendance`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);

      if (incRes) {
        const incJ = await safeJson(incRes);
        if (incJ?._ok && incJ?.ok) setAttIncidents(incJ.incidents || []);
        else setAttIncidents([]);
      } else {
        setAttIncidents([]);
      }

      setAttMsg("✅ Asistencia actualizada.");
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setAttLoading(false);
    }
  }

  async function runAttendanceEngine() {
    try {
      setAttMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/attendance/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setAttMsg(`✅ Motor ejecutado. Retrasos: ${j.created?.late ?? 0} · Faltas: ${j.created?.absence ?? 0}`);
      await loadAttendance();
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function decideIncident(incident_id: string, status: "justified" | "unjustified") {
    try {
      setAttMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/incidents/decide", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id, status, note: attNote }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setAttMsg(status === "justified" ? "✅ Marcada como JUSTIFICADA." : "✅ Marcada como NO justificada.");
      setAttNote("");
      await loadAttendance();
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadStats(silent = false) {
    if (stLoading && !silent) return;
    if (!silent) {
      setStLoading(true);
      setStMsg("");
    }
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const qp = new URLSearchParams();
      if (stWorkerId.trim()) qp.set("worker_id", stWorkerId.trim());
      qp.set("group", stGroup);
      if (stFrom.trim()) qp.set("from", stFrom.trim());
      if (stTo.trim()) qp.set("to", stTo.trim());

      const r = await fetch(`/api/admin/attendance/stats?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setStRows(j.rows || []);
      if (!silent) setStMsg(`✅ Stats cargadas: ${(j.rows || []).length}`);
      if (!silent) setTimeout(() => setStMsg(""), 1200);
    } catch (e: any) {
      setStRows([]);
      if (!silent) setStMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setStLoading(false);
    }
  }

  async function loadStaff(silent = false) {
    if (staffLoading && !silent) return;
    if (!silent) {
      setStaffLoading(true);
      setStaffMsg("");
    }
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setStaffWorkers(j.workers || []);
      setStaffSchedules(j.schedules || []);
      if (!silent) setStaffMsg("✅ Plantilla y horarios cargados.");
    } catch (e: any) {
      if (!silent) setStaffMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setStaffLoading(false);
    }
  }

  async function createWorker() {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_worker",
          display_name: newWorkerName,
          role: newWorkerRole,
          team: newWorkerTeam,
          email: newWorkerEmail,
          tarotista_level: newWorkerLevel,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setNewWorkerName("");
      setNewWorkerRole("tarotista");
      setNewWorkerTeam("");
      setNewWorkerEmail("");
      setNewWorkerLevel(1);
      await loadStaff(true);
      setStaffMsg("✅ Trabajador creado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function updateWorker() {
    if (!editingWorkerId) return;
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_worker",
          worker_id: editingWorkerId,
          display_name: editingWorkerName,
          role: editingWorkerRole,
          team: editingWorkerTeam,
          email: editingWorkerEmail,
          tarotista_level: editingWorkerLevel,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Trabajador actualizado.");
      setEditingWorkerId("");
      setEditingWorkerName("");
      setEditingWorkerRole("tarotista");
      setEditingWorkerTeam("");
      setEditingWorkerEmail("");
      setEditingWorkerLevel(1);
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  function startEditWorker(worker: any) {
    setEditingWorkerId(String(worker.id || ""));
    setEditingWorkerName(String(worker.display_name || ""));
    setEditingWorkerRole((worker.role || "tarotista") as any);
    setEditingWorkerTeam(String(worker.team || ""));
    setEditingWorkerEmail(String(worker.email || ""));
    setEditingWorkerLevel(Number(worker.tarotista_level || 1) === 2 ? 2 : 1);
  }

  function cancelEditWorker() {
    setEditingWorkerId("");
    setEditingWorkerName("");
    setEditingWorkerRole("tarotista");
    setEditingWorkerTeam("");
    setEditingWorkerEmail("");
    setEditingWorkerLevel(1);
  }

  function prepareScheduleForWorker(worker: any) {
    setScheduleWorkerId(String(worker.id || ""));
  }

  async function toggleWorker(worker: any, enable: boolean) {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: enable ? "enable_worker" : "disable_worker",
          worker_id: worker.id,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg(enable ? "✅ Trabajador activado." : "✅ Trabajador desactivado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function changeWorkerPassword() {
    if (!passwordWorkerId || passwordValue.length < 6) {
      setStaffMsg("⚠️ Selecciona trabajador y una contraseña de mínimo 6 caracteres.");
      return;
    }

    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          worker_id: passwordWorkerId,
          password: passwordValue,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setPasswordValue("");
      setStaffMsg("✅ Contraseña actualizada.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function createSchedule() {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_schedule",
          worker_id: scheduleWorkerId,
          day_of_week: Number(scheduleDay),
          start_time: scheduleStart,
          end_time: scheduleEnd,
          timezone: scheduleTimezone,
          is_active: true,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Horario creado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function updateSchedule(schedule_id: string, patch: any) {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_schedule",
          schedule_id,
          ...patch,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Horario actualizado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function deleteSchedule(schedule_id: string) {
    if (!confirm("¿Borrar este horario?")) return;
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_schedule",
          schedule_id,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Horario borrado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  useEffect(() => {
    if (!ok || tab !== "facturas") return;
    listInvoices(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, month]);

  useEffect(() => {
    if (!ok) return;

    if (lastMonthRef.current !== month) {
      lastMonthRef.current = month;
    }

    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(() => {
      if (tab === "facturas") listInvoices(true);
    }, 180000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month, selId]);

  useEffect(() => {
    if (!ok || tab !== "editor" || !String(selId || "").startsWith("collaborator:")) return;
    const [, collaboratorId, reportMonth] = String(selId).split(":");
    if (!collaboratorId || reportMonth === month) return;
    const nextId = `collaborator:${collaboratorId}:${month}`;
    setSelId(nextId);
    void loadCollaboratorReport(nextId, false).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month, selId]);

  useEffect(() => {
    const collaboratorOpen = tab === "editor" && String(selId || "").startsWith("collaborator:");
    if (!ok || (tab !== "facturas" && !collaboratorOpen)) return;

    let active = true;
    const selectedMonths = new Set([month, previousMonthKey(month)]);

    const eventBelongsToInvoicePeriod = (table: string, payload: any) => {
      if (["workers", "billing_collaborators", "billing_collaborator_report_exclusions", "crm_cliente_etiquetas", "invoice_lines"].includes(table)) return true;
      const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old || {};
      if (table === "invoices") return selectedMonths.has(String(row?.month_key || ""));
      const rawDate = String(row?.issue_date || row?.fecha_hora || row?.fecha || row?.created_at || row?.updated_at || "");
      if (!rawDate) return true;
      return Array.from(selectedMonths).some((key) => rawDate.startsWith(key));
    };

    const scheduleInvoiceRefresh = (table: string, payload: any) => {
      if (!active || !eventBelongsToInvoicePeriod(table, payload)) return;
      if (invoiceRealtimeTimerRef.current !== null) {
        window.clearTimeout(invoiceRealtimeTimerRef.current);
        invoiceRealtimeTimerRef.current = null;
      }
      invoiceRealtimeTimerRef.current = window.setTimeout(() => {
        invoiceRealtimeTimerRef.current = null;
        if (!active) return;
        void listInvoices(true);
        if (collaboratorOpen && selId) {
          const [, collaboratorId] = String(selId).split(":");
          const liveId = collaboratorId ? `collaborator:${collaboratorId}:${month}` : selId;
          void loadCollaboratorReport(liveId, true).catch(() => undefined);
        }
      }, 700);
    };

    const automaticChannel = sb
      .channel(`admin-invoices-live-${month}-${collaboratorOpen ? "detail" : "list"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, (payload: any) => scheduleInvoiceRefresh("invoices", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_lines" }, (payload: any) => scheduleInvoiceRefresh("invoice_lines", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, (payload: any) => scheduleInvoiceRefresh("workers", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "billing_collaborators" }, (payload: any) => scheduleInvoiceRefresh("billing_collaborators", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "billing_collaborator_report_exclusions" }, (payload: any) => scheduleInvoiceRefresh("billing_collaborator_report_exclusions", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_etiquetas" }, (payload: any) => scheduleInvoiceRefresh("crm_cliente_etiquetas", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cliente_pagos" }, (payload: any) => scheduleInvoiceRefresh("crm_cliente_pagos", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, (payload: any) => scheduleInvoiceRefresh("rendimiento_llamadas", payload))
      .subscribe();

    // La tabla manual usa un canal independiente: si su publicación Realtime no está
    // disponible, nunca debe bloquear la sincronización de las facturas automáticas.
    const manualChannel = sb
      .channel(`admin-manual-invoices-live-${month}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "manual_invoices" }, (payload: any) => scheduleInvoiceRefresh("manual_invoices", payload))
      .subscribe();

    return () => {
      active = false;
      if (invoiceRealtimeTimerRef.current !== null) {
        window.clearTimeout(invoiceRealtimeTimerRef.current);
        invoiceRealtimeTimerRef.current = null;
      }
      void sb.removeChannel(automaticChannel);
      void sb.removeChannel(manualChannel);
    };
    // Un único canal para la lista o el detalle de colaborador; se limpia al cambiar de vista o mes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month, selId]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "asistencia" || tab === "trabajadores") {
      if (tab === "asistencia") loadAttendance();
      loadStaff();

      if (!stFrom && !stTo) {
        const d = new Date();
        const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const d2 = new Date(d.getTime() - 6 * 86400000);
        const from = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;
        setStFrom(from);
        setStTo(to);
      }
    }
    if (tab === "estadisticas") loadAdminStats(false, "initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month]);


  useEffect(() => {
    if (!ok || tab !== "estadisticas") return;

    let active = true;
    const selectedMonths = new Set([month, previousMonthKey(month)]);
    setStatsLiveStatus("connecting");

    const eventBelongsToSelectedPeriod = (table: string, payload: any) => {
      if (table === "workers") return true;
      const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old || {};
      if (table === "invoices") return selectedMonths.has(String(row?.month_key || ""));
      const rawDate = String(row?.fecha_hora || row?.fecha || row?.created_at || "");
      if (!rawDate) return true;
      return Array.from(selectedMonths).some((key) => rawDate.startsWith(key));
    };

    const scheduleRefresh = (table: string, payload: any) => {
      if (!active || !eventBelongsToSelectedPeriod(table, payload)) return;
      setStatsLiveStatus("updating");
      if (statsRealtimeTimerRef.current !== null) {
        window.clearTimeout(statsRealtimeTimerRef.current);
        statsRealtimeTimerRef.current = null;
      }
      statsRealtimeTimerRef.current = window.setTimeout(() => {
        statsRealtimeTimerRef.current = null;
        if (active) void loadAdminStats(true, "realtime");
      }, 700);
    };

    const channel = sb
      .channel(`admin-statistics-${month}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, (payload: any) => scheduleRefresh("rendimiento_llamadas", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, (payload: any) => scheduleRefresh("invoices", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, (payload: any) => scheduleRefresh("workers", payload))
      .subscribe((status: any) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setStatsLiveStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatsLiveStatus("reconnecting");
        else if (status === "CLOSED") setStatsLiveStatus("offline");
      });

    return () => {
      active = false;
      if (statsRealtimeTimerRef.current !== null) {
        window.clearTimeout(statsRealtimeTimerRef.current);
        statsRealtimeTimerRef.current = null;
      }
      void sb.removeChannel(channel);
    };
    // La suscripción se recrea únicamente al entrar en Estadísticas o cambiar el mes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month]);

    const expectedNow = useMemo(() => {
    return (attExpected || []).map((x: any) => ({
      ...x,
      is_online: typeof x.online === "boolean" ? !!x.online : !!x.is_online,
      status: String(x.status || "working"),
    }));
  }, [attExpected]);

  const statsInvoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const inv of invoices || []) {
      map.set(String(inv.worker_id), inv);
    }
    return map;
  }, [invoices]);

  const statsMergedRows = useMemo(() => {
    return (statsRows || []).map((r: any) => {
      const inv = statsInvoiceMap.get(String(r.worker_id));
      return {
        ...r,
        invoice_total: Number(inv?.total || 0),
        invoice_status: inv?.status || "",
        worker_ack: inv?.worker_ack || null,
        worker_ack_note: inv?.worker_ack_note || null,
      };
    });
  }, [statsRows, statsInvoiceMap]);

  const statsComputed = useMemo(() => {
    const invoiceTotal = (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
    const accepted = (invoices || []).filter((x: any) => String(x.worker_ack || "") === "accepted").length;
    const rejected = (invoices || []).filter((x: any) => String(x.worker_ack || "") === "rejected").length;
    const review = (invoices || []).filter((x: any) => String(x.worker_ack || "") === "review").length;
    const pending = (invoices || []).filter((x: any) => !x.worker_ack || String(x.worker_ack) === "pending").length;

    const workers = statsRows.length || 0;
    const minutes = Number(statsTotals?.minutes_total || 0);
    const calls = Number(statsTotals?.calls_total || 0);
    const captadas = Number(statsTotals?.captadas_total || 0);

    return {
      invoice_total: invoiceTotal,
      accepted,
      rejected,
      review,
      pending,
      workers,
      captadas_per_worker: workers ? captadas / workers : 0,
      calls_per_worker: workers ? calls / workers : 0,
      minutes_per_worker: workers ? minutes / workers : 0,
      captadas_per_100_min: minutes ? (captadas / minutes) * 100 : 0,
      factura_media: workers ? invoiceTotal / workers : 0,
      revenue_total: Number(statsTotals?.revenue_total || 0),
      vip_count: heroVipCount,
    };
  }, [invoices, statsRows, statsTotals, heroVipCount]);

  const attSummary = useMemo(() => {
    const online = (attOnline || []).length;
    const expected = (expectedNow || []).length;
    const missing = (expectedNow || []).filter((x: any) => !x.is_online).length;
    const breakCount = (attOnline || []).filter((x: any) => String(x.status || "") === "break").length;
    const bathroomCount = (attOnline || []).filter((x: any) => String(x.status || "") === "bathroom").length;
    return {
      online,
      expected,
      missing,
      breakCount,
      bathroomCount,
      incidents: (attIncidents || []).length,
    };
  }, [attOnline, expectedNow, attIncidents]);

  const topWorkersByMinutes = useMemo(() => {
    return [...(statsMergedRows || [])]
      .sort((a: any, b: any) => {
        const bm = Number(b.minutes_total || 0);
        const am = Number(a.minutes_total || 0);
        if (bm !== am) return bm - am;
        return String(a.display_name || "").localeCompare(String(b.display_name || ""));
      })
      .slice(0, 5);
  }, [statsMergedRows]);

  const activeWorkers = useMemo(() => {
    return (staffWorkers || []).filter((w: any) => w?.is_active !== false);
  }, [staffWorkers]);

  const filteredWorkers = useMemo(() => {
    const q = staffQ.trim().toLowerCase();
    const base = activeWorkers || [];
    if (!q) return base;
    return base.filter((w: any) => {
      const text = [w.display_name || "", w.role || "", w.team || "", w.email || ""].join(" ").toLowerCase();
      return text.includes(q);
    });
  }, [activeWorkers, staffQ]);

  const staffOperationalWorkers = useMemo(() => {
    return (filteredWorkers || []).filter((w: any) => String(w.role || "") !== "admin");
  }, [filteredWorkers]);

  const schedulesByWorker = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of staffSchedules || []) {
      const wid = String(s.worker_id || "");
      if (!map.has(wid)) map.set(wid, []);
      map.get(wid)!.push(s);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const da = Number(a.day_of_week || 0);
        const db = Number(b.day_of_week || 0);
        if (da !== db) return da - db;
        return String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });
    }
    return map;
  }, [staffSchedules]);

  if (!ok) return <div style={{ padding: 40, minHeight: "100vh", display: "grid", placeItems: "center", color: "rgba(255,255,255,.92)", fontSize: 18, letterSpacing: ".02em", background: "transparent" }}>Cargando…</div>;

  return (
    <>
      <div className="tc-premium-bg" aria-hidden="true">
        <div className="tc-premium-orb tc-premium-orb-one" />
        <div className="tc-premium-orb tc-premium-orb-two" />
        <div className="tc-premium-orb tc-premium-orb-three" />
        <div className="tc-login-stars" />
        <div className="tc-login-grid" />
      </div>
      <AppHeader />
      <ReservasGlobalWatcher enabled={ok} onGoToReserva={openReservaFromPopup} />
      <PaymentMotivationWatcher mode="admin" />

      <div className={`tc-shell tc-shell-premium ${adminStyles.adminShell}`}>
        <aside className={`tc-sidebar ${adminStyles.sidebar}`}>
          <div className={`tc-sidebar-card ${adminStyles.sidebarCard}`}>
            <div className={adminStyles.sidebarHudLine} aria-hidden="true" />
            <div className={`tc-sidebar-title ${adminStyles.sidebarTitle}`}><span>Navegación admin</span><small>Centro de mando</small></div>
            <div className="tc-sidebar-nav">
              {ADMIN_NAV.map((item) => {
                const Icon = item.icon;
                const rankGroup = item.key === "rangos-clientes";
                const active = rankGroup ? (tab === "rangos-clientes" || tab === "clientes-web") : tab === item.key;
                return (
                  <div key={item.key} style={{ display: "grid", gap: 6 }}>
                    <button
                      className={`tc-sidebtn ${adminStyles.navItem} ${active ? `tc-sidebtn-active ${adminStyles.navItemActive}` : ""}`}
                      data-tone={item.tone}
                      onClick={() => {
                        setTab(item.key as TabKey);
                        if (rankGroup) setRanksMenuOpen(true);
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <div className={`tc-chip ${adminStyles.navIcon}`}><Icon size={17} /></div>
                        <div style={{ minWidth: 0 }}>
                          <div className="tc-sidebtn-main">{item.label}</div>
                          <div className="tc-sidebtn-kicker">{item.kicker}</div>
                        </div>
                      </div>
                      {rankGroup ? (
                        <span
                          onClick={(event) => { event.stopPropagation(); setRanksMenuOpen((value) => !value); }}
                          className={`${adminStyles.navChevron} ${ranksMenuOpen ? adminStyles.navChevronOpen : ""}`}
                          aria-label="Desplegar Rangos de clientes"
                        >
                          <ChevronDown size={15} />
                        </span>
                      ) : <span className={`tc-sidebtn-dot ${adminStyles.navDot}`} />}
                    </button>
                    {rankGroup && ranksMenuOpen ? (
                      <div className={adminStyles.submenu}>
                        <button className={`tc-sidebtn ${adminStyles.submenuItem} ${tab === "rangos-clientes" ? `tc-sidebtn-active ${adminStyles.submenuItemActive}` : ""}`} onClick={() => setTab("rangos-clientes")}>
                          <div className={adminStyles.submenuCopy}><div className="tc-sidebtn-main">Gestión de rangos</div><div className="tc-sidebtn-kicker">Automático y temporal</div></div><span className={`tc-sidebtn-dot ${adminStyles.navDot}`} />
                        </button>
                        <button className={`tc-sidebtn ${adminStyles.submenuItem} ${tab === "clientes-web" ? `tc-sidebtn-active ${adminStyles.submenuItemActive}` : ""}`} onClick={() => setTab("clientes-web")}>
                          <div className={adminStyles.submenuCopy}><div className="tc-sidebtn-main">Clientes web</div><div className="tc-sidebtn-kicker">Accesos y cuentas</div></div><span className={`tc-sidebtn-dot ${adminStyles.navDot}`} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <main className={`tc-main ${adminStyles.main}`}>
          <section className={`tc-admin-toolbar ${adminStyles.toolbar}`}>
            <div className={adminStyles.toolbarCopy}>
              <div className={adminStyles.toolbarEyebrow}><LayoutDashboard size={13} /> Centro de mando · Administración</div>
              <div className="tc-admin-toolbar-title">Panel admin</div>
              <div className="tc-sub">Control operativo, facturación y métricas en una vista limpia.</div>
            </div>
            <div className={`tc-row ${adminStyles.toolbarActions}`}>
              <span className={`tc-chip ${adminStyles.monthBadge}`}>Mes</span>
              <input className="tc-input" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="2026-02" style={{ width: 120 }} />
              <button className="tc-btn tc-btn-purple" onClick={() => listInvoices()} disabled={listLoading}>
                {listLoading ? "Cargando…" : "Refrescar"}
              </button>
            </div>
          </section>

          <div className={`tc-main-content ${adminStyles.mainContent}`}>
{tab === "dashboard" && <DashboardPanel month={month} />}

          {tab === "panel" && <OperatorPanel mode="admin" />}

          {tab === "facturas" && (
            <div className="tc-invoice-game">
              <section className="tc-invoice-hero-card">
                <div className="tc-invoice-hero-glow" aria-hidden="true" />
                <div className="tc-invoice-hero-content">
                  <div>
                    <div className="tc-invoice-eyebrow">Centro de recompensas · {month}</div>
                    <div className="tc-invoice-title-row">
                      <div className="tc-invoice-title-icon">✦</div>
                      <div>
                        <h2>Facturas del mes</h2>
                        <p>Genera, compara y revisa las facturas reales del equipo.</p>
                      </div>
                    </div>
                  </div>

                  <div className="tc-invoice-actions">
                    <button className="tc-btn tc-invoice-btn-primary" onClick={() => { setManualInvoiceId(null); setManualInvoiceOpen(true); }}>
                      <span>＋</span>Crear factura manual
                    </button>
                    <button className="tc-btn tc-invoice-btn-primary" onClick={generateInvoices} disabled={genLoading}>
                      <span>⚡</span>{genLoading ? "Generando…" : "Generar facturas"}
                    </button>
                    <button className="tc-btn tc-invoice-btn-secondary" onClick={() => listInvoices()} disabled={listLoading}>
                      <span>◈</span>{listLoading ? "Cargando…" : "Actualizar resumen"}
                    </button>
                  </div>
                </div>

                <div className="tc-invoice-system-message">
                  <span className="tc-invoice-system-dot" />
                  {genMsg || listMsg || "Datos conectados con las facturas reales del mes seleccionado."}
                </div>
              </section>

              <section className="tc-invoice-kpi-grid" aria-label="Resumen de facturación">
                <article className="tc-invoice-kpi-card tc-invoice-kpi-gold">
                  <span className="tc-invoice-kpi-icon">€</span>
                  <div>
                    <small>Total del mes</small>
                    <strong>{eur(totalSum)}</strong>
                    <span>Importe real acumulado</span>
                  </div>
                </article>
                <article className="tc-invoice-kpi-card tc-invoice-kpi-purple">
                  <span className="tc-invoice-kpi-icon">▦</span>
                  <div>
                    <small>Registros activos</small>
                    <strong>{invoiceSummary.count}</strong>
                    <span>Equipo y colaboradores</span>
                  </div>
                </article>
                <article className="tc-invoice-kpi-card tc-invoice-kpi-green">
                  <span className="tc-invoice-kpi-icon">✓</span>
                  <div>
                    <small>Aceptadas</small>
                    <strong>{invoiceSummary.accepted}</strong>
                    <span>{invoiceSummary.pending} pendientes</span>
                  </div>
                </article>
                <article className="tc-invoice-kpi-card tc-invoice-kpi-blue">
                  <span className="tc-invoice-kpi-icon">↗</span>
                  <div>
                    <small>Mejoran en minutos</small>
                    <strong>{invoiceSummary.rising}</strong>
                    <span>Respecto al mes anterior</span>
                  </div>
                </article>
              </section>

              <section className="tc-invoice-table-card">
                <div className="tc-invoice-table-heading">
                  <div>
                    <span className="tc-invoice-table-kicker">Clasificación mensual</span>
                    <h3>Resumen individual</h3>
                  </div>
                  <div className="tc-invoice-live-badge"><span /> Sincronizado</div>
                </div>

                <div className="tc-invoice-table-scroll">
                  <table className="tc-table tc-invoice-table">
                    <thead>
                      <tr>
                        <th>Trabajador</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Aceptación</th>
                        <th>Comparación anterior mes</th>
                        <th>Total y tendencia</th>
                        <th>PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(invoices || []).map((x: any, index: number) => (
                        <tr
                          key={x.invoice_id}
                          className={`tc-click ${selId === x.invoice_id ? "tc-invoice-row-selected" : ""}`}
                          onClick={() => {
                            if (x.is_manual) {
                              setManualInvoiceId(String(x.manual_id || String(x.invoice_id).replace("manual:", "")));
                              setManualInvoiceOpen(true);
                            } else {
                              loadInvoice(x.invoice_id);
                            }
                          }}
                        >
                          <td>
                            <div className="tc-invoice-worker-cell">
                              <span className="tc-invoice-rank">{String(index + 1).padStart(2, "0")}</span>
                              <span className="tc-invoice-avatar">{String(x.display_name || "?").trim().charAt(0).toUpperCase()}</span>
                              <div>
                                <b>{x.display_name}</b>
                                <small>{x.is_manual ? `${x.invoice_number || "Factura manual"} · Factura manual` : x.is_collaborator ? `${x.tag_name || "Etiqueta vinculada"} · En vivo` : `Factura ${x.month_key || month}`}</small>
                              </div>
                            </div>
                          </td>
                          <td><span className="tc-invoice-role-badge">{x.role}</span></td>
                          <td><span className={`tc-invoice-status tc-invoice-status-${String(x.status || "draft").toLowerCase()}`}>{x.status}</span></td>
                          <td>
                            <span
                              className="tc-chip tc-invoice-ack"
                              style={ackStyle(x.worker_ack)}
                              title={x.worker_ack_note || ""}
                            >
                              {ackLabel(x.worker_ack)}
                            </span>
                          </td>
                          <td><PreviousMonthComparison invoice={x} /></td>
                          <td>
                            <div className="tc-invoice-total-cell">
                              <strong>{x.is_collaborator ? storedCurrencyBreakdown(x.generated_by_currency) : eur(x.total || 0)}</strong>
                              {x.is_collaborator ? <small style={{ color: "#aaa1b6" }}>{x.remuneration_configured ? `Pago: ${eur(x.payable_total || 0)}` : "Pago a Mario: sin fórmula"}</small> : null}
                              <InvoiceMiniTrend invoice={x} />
                            </div>
                          </td>
                          <td>
                            <button
                              className="tc-btn tc-invoice-pdf-btn"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadInvoicePdf(x.invoice_id);
                              }}
                            >
                              <span>⇩</span> Descargar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(!invoices || invoices.length === 0) && (
                        <tr>
                          <td colSpan={7}>
                            <div className="tc-invoice-empty">
                              <span>◇</span>
                              <strong>No hay facturas cargadas</strong>
                              <small>Pulsa «Actualizar resumen» o genera las facturas del mes.</small>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="tc-invoice-table-footnote">
                  <span>ⓘ</span> La mini gráfica compara minutos reales. En centrales se muestra estado neutro; en colaboradores el total visible es facturación generada y no remuneración.
                </div>
              </section>
            </div>
          )}

          {tab === "editor" && (
            selCollaboratorReport ? (
              <CollaboratorBillingReport
                report={selCollaboratorReport}
                loading={selLoading}
                message={selMsg}
                onRefresh={() => {
                  if (selId) void loadCollaboratorReport(selId, false);
                }}
                onDownload={() => {
                  if (selId) void downloadInvoicePdf(selId);
                }}
                onDeleteRecord={deleteCollaboratorReportRecord}
                onBack={() => setTab("facturas")}
              />
            ) : (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title">✏️ Editor de factura</div>
                  <div className="tc-sub">Líneas con desglose automático (minutos x tarifa)</div>
                </div>

                {selId && (
                  <div className="tc-row">
                    <button className="tc-btn tc-btn-gold" onClick={() => loadInvoice(selId)}>Recargar</button>
                    <button className="tc-btn tc-btn-gold" onClick={() => downloadInvoicePdf(selId)}>Descargar PDF</button>
                    <button className="tc-btn" onClick={() => setStatus("draft")}>Draft</button>
                    <button className="tc-btn tc-btn-ok" onClick={() => setStatus("final")}>Finalizar</button>
                  </div>
                )}
              </div>

              {!selId ? (
                <div className="tc-sub" style={{ marginTop: 10 }}>Selecciona una factura desde <b>Facturas</b>.</div>
              ) : selLoading ? (
                <div className="tc-sub" style={{ marginTop: 10 }}>Cargando…</div>
              ) : (
                <>
                  <div style={{ marginTop: 10 }} className="tc-sub">
                    <b>{selWorker?.display_name}</b> · {selWorker?.role} · Mes <b>{selInvoice?.month_key}</b>
                    <br />
                    Total: <b>{eur(selInvoice?.total || 0)}</b> · Estado: <b>{selInvoice?.status}</b>
                    <br />
                    Aceptación:{" "}
                    <span className="tc-chip" style={{ ...ackStyle(selInvoice?.worker_ack), padding: "4px 10px" }}>
                      {ackLabel(selInvoice?.worker_ack)}
                    </span>
                    {selInvoice?.worker_ack_note ? (
                      <>
                        {" "}· Nota: <b>{selInvoice.worker_ack_note}</b>
                      </>
                    ) : null}
                  </div>

                  <div className="tc-hr" />

                  {(selLines || []).some((line: any) => String(line?.kind || "") === "salary_base") && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 10,
                        padding: 14,
                        marginBottom: 12,
                        borderRadius: 16,
                        background: "linear-gradient(135deg, rgba(181,156,255,.14), rgba(255,215,130,.08))",
                        border: "1px solid rgba(181,156,255,.28)",
                      }}
                    >
                      <div>
                        <div className="tc-sub">Sueldo fijo protegido</div>
                        <div className="tc-title" style={{ marginTop: 4 }}>
                          {eur((selLines || []).find((line: any) => String(line?.kind || "") === "salary_base")?.amount || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="tc-sub">Bonus opcional</div>
                        <div className="tc-title" style={{ marginTop: 4 }}>
                          {eur((selLines || []).find((line: any) => String(line?.kind || "") === "salary_bonus")?.amount || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="tc-sub">Total de la factura</div>
                        <div className="tc-title" style={{ marginTop: 4 }}>
                          {eur(selInvoice?.total || 0)}
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "grid", gap: 10 }}>
                    {(selLines || []).map((l: any) => (
                      <LineEditor
                        key={l.id}
                        line={l}
                        onSave={(payload) => updateLine(l.id, payload)}
                        onDelete={() => deleteLine(l.id)}
                      />
                    ))}
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-title" style={{ fontSize: 14 }}>➕ Añadir línea</div>

                  <div className="tc-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                    <select className="tc-select" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                      <option value="adjustment">adjustment</option>
                      <option value="incident">incident</option>
                      <option value="bonus_ranking">bonus_ranking</option>
                      <option value="bonus_captadas">bonus_captadas</option>
                      <option value="minutes_free">minutes_free</option>
                      <option value="minutes_rueda">minutes_rueda</option>
                      <option value="minutes_cliente">minutes_cliente</option>
                      <option value="minutes_repite">minutes_repite</option>
                      <option value="salary_base">salary_base</option>
                      <option value="salary_bonus">salary_bonus</option>
                    </select>

                    <input className="tc-input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ width: 240 }} />
                    <input className="tc-input" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ width: 140 }} />

                    <button className="tc-btn tc-btn-gold" onClick={addLine}>Añadir</button>
                  </div>

                  <div style={{ marginTop: 10 }} className="tc-sub">{selMsg || " "}</div>
                </>
              )}
            </div>
            )
          )}

          {tab === "estadisticas" && (
            <StatisticsPanel
              month={month}
              loading={statsLoading}
              message={statsMsg}
              liveStatus={statsLiveStatus}
              totals={statsTotals}
              previousTotals={statsPreviousTotals}
              rows={statsRows}
              previousRows={statsPreviousRows}
              top={statsTop}
              teams={statsTeams}
              invoices={invoices}
              previousInvoiceSummary={statsPreviousInvoiceSummary}
              onRefresh={() => void loadAdminStats(false, "manual")}
            />
          )}


          {tab === "trabajadores" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">👥 Trabajadores</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Gestiona roles, nivel de tarotista, estado y contraseñas. {staffMsg ? "· " + staffMsg : ""}
                    </div>
                  </div>
                  <button className="tc-btn tc-btn-gold" onClick={() => loadStaff(false)} disabled={staffLoading}>
                    {staffLoading ? "Cargando…" : "Recargar"}
                  </button>
                </div>
                <div className="tc-hr" />
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <input className="tc-input" value={staffQ} onChange={(e) => setStaffQ(e.target.value)} placeholder="Buscar por nombre, rol, equipo o email…" style={{ width: 340, maxWidth: "100%" }} />
                  <div className="tc-sub">Total: <b>{filteredWorkers.length}</b></div>
                </div>
                <div className="tc-hr" />
                <div style={{ overflowX: "auto" }}>
                  <table className="tc-table">
                    <thead><tr><th>Nombre</th><th>Rol</th><th>Nivel tarotista</th><th>Equipo</th><th>Email</th><th>Estado</th><th>Acciones</th></tr></thead>
                    <tbody>
                      {(filteredWorkers || []).map((w: any) => (
                        <tr key={w.id}>
                          <td><b>{w.display_name || "—"}</b></td>
                          <td>{w.role || "—"}</td>
                          <td>{String(w.role || "") === "tarotista" ? <span className="tc-chip">Nivel {Number(w.tarotista_level || 1) === 2 ? "2 · sin euros" : "1 · completo"}</span> : <span className="tc-muted">—</span>}</td>
                          <td>{w.team || "—"}</td>
                          <td>{w.email || "—"}</td>
                          <td><span className="tc-chip">{w.is_active ? "Activo" : "Inactivo"}</span></td>
                          <td><div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <button className="tc-btn" onClick={() => startEditWorker(w)}>Editar</button>
                            <button className="tc-btn tc-btn-gold" onClick={() => setPasswordWorkerId(String(w.id || ""))}>Contraseña</button>
                            <button className="tc-btn tc-btn-danger" onClick={() => toggleWorker(w, false)}>Dar de baja</button>
                          </div></td>
                        </tr>
                      ))}
                      {(!filteredWorkers || filteredWorkers.length === 0) && <tr><td colSpan={7} className="tc-muted">No hay trabajadores.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="tc-grid-2">
                <div className="tc-card"><div className="tc-title" style={{ fontSize: 14 }}>➕ Crear trabajador</div><div className="tc-hr" />
                  <div style={{ display: "grid", gap: 10 }}>
                    <input className="tc-input" value={newWorkerName} onChange={(e) => setNewWorkerName(e.target.value)} placeholder="Nombre" />
                    <select className="tc-select" value={newWorkerRole} onChange={(e) => setNewWorkerRole(e.target.value as any)}><option value="tarotista">tarotista</option><option value="central">central</option><option value="admin">admin</option></select>
                    {newWorkerRole === "tarotista" && <select className="tc-select" value={newWorkerLevel} onChange={(e) => setNewWorkerLevel(Number(e.target.value) === 2 ? 2 : 1)}><option value={1}>Nivel 1 · ve ganancias y euros</option><option value={2}>Nivel 2 · solo minutos y rankings</option></select>}
                    <input className="tc-input" value={newWorkerTeam} onChange={(e) => setNewWorkerTeam(e.target.value)} placeholder="Equipo" />
                    <input className="tc-input" value={newWorkerEmail} onChange={(e) => setNewWorkerEmail(e.target.value)} placeholder="Email" />
                    <button className="tc-btn tc-btn-ok" onClick={createWorker}>Crear trabajador</button>
                  </div></div>
                <div className="tc-card"><div className="tc-title" style={{ fontSize: 14 }}>🔐 Cambiar contraseña</div><div className="tc-hr" />
                  <div style={{ display: "grid", gap: 10 }}>
                    <select className="tc-select" value={passwordWorkerId} onChange={(e) => setPasswordWorkerId(e.target.value)}><option value="">Selecciona trabajador</option>{(filteredWorkers || []).map((w: any) => <option key={w.id} value={w.id}>{w.display_name || w.email || w.id}</option>)}</select>
                    <input className="tc-input" type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} placeholder="Nueva contraseña · mínimo 6 caracteres" />
                    <button className="tc-btn tc-btn-gold" onClick={changeWorkerPassword}>Actualizar contraseña</button>
                    <div className="tc-sub">Necesita que el trabajador tenga <b>user_id</b> asociado en Supabase Auth.</div>
                  </div></div>
              </div>
              {editingWorkerId ? <div className="tc-card"><div className="tc-title" style={{ fontSize: 14 }}>✏️ Editar trabajador</div><div className="tc-hr" />
                <div className="tc-grid-4">
                  <input className="tc-input" value={editingWorkerName} onChange={(e) => setEditingWorkerName(e.target.value)} placeholder="Nombre" />
                  <select className="tc-select" value={editingWorkerRole} onChange={(e) => setEditingWorkerRole(e.target.value as any)}><option value="tarotista">tarotista</option><option value="central">central</option><option value="admin">admin</option></select>
                  <select className="tc-select" value={editingWorkerLevel} onChange={(e) => setEditingWorkerLevel(Number(e.target.value) === 2 ? 2 : 1)} disabled={editingWorkerRole !== "tarotista"}><option value={1}>Nivel 1 · completo</option><option value={2}>Nivel 2 · sin euros</option></select>
                  <input className="tc-input" value={editingWorkerTeam} onChange={(e) => setEditingWorkerTeam(e.target.value)} placeholder="Equipo" />
                  <input className="tc-input" value={editingWorkerEmail} onChange={(e) => setEditingWorkerEmail(e.target.value)} placeholder="Email" />
                </div><div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}><button className="tc-btn" onClick={cancelEditWorker}>Cancelar</button><button className="tc-btn tc-btn-ok" onClick={updateWorker}>Guardar cambios</button></div></div> : null}
            </div>
          )}
          {tab === "asistencia" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">🟢 Asistencia (en vivo)</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Vista operativa del turno actual y del control horario
                      {attMsg ? ` · ${attMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={loadAttendance} disabled={attLoading}>
                      {attLoading ? "Cargando…" : "Actualizar"}
                    </button>
                    <button className="tc-btn tc-btn-danger" onClick={runAttendanceEngine}>
                      Ejecutar motor
                    </button>
                  </div>
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-4">
                  <KpiBox label="Conectados ahora" value={String(attSummary.online)} />
                  <KpiBox label="Deberían estar" value={String(attSummary.expected)} />
                  <KpiBox label="Faltando ahora" value={String(attSummary.missing)} />
                  <KpiBox label="Incidencias del mes" value={String(attSummary.incidents)} />
                  <KpiBox label="En descanso" value={String(attSummary.breakCount)} />
                  <KpiBox label="En baño" value={String(attSummary.bathroomCount)} />
                  <KpiBox label="Penalización retraso" value="1,00 €" />
                  <KpiBox label="Penalización falta" value="12,00 €" />
                </div>
              </div>

              <div className="tc-grid-2">
                <div className="tc-card">
                  <div className="tc-title" style={{ fontSize: 14 }}>🟢 Conectados ahora</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Estado real según control horario
                  </div>
                  <div className="tc-hr" />

                  {(attOnline || []).length === 0 ? (
                    <div className="tc-sub">Nadie conectado ahora mismo.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {(attOnline || []).map((o: any) => (
                        <div
                          key={o.worker_id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(120,255,190,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 900 }}>{o.display_name}</div>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                {o.role}
                                {o.team ? ` · ${o.team}` : ""}
                                {o.status ? <> · Estado: <b>{o.status}</b></> : null}
                              </div>
                            </div>
                            <div className="tc-sub">
                              Último evento: <b>{o.last_event_at ? new Date(o.last_event_at).toLocaleTimeString("es-ES") : "—"}</b>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="tc-card">
                  <div className="tc-title" style={{ fontSize: 14 }}>🕒 Deberían estar conectados</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Comparativa entre horario activo y presencia real
                  </div>
                  <div className="tc-hr" />

                  {(expectedNow || []).length === 0 ? (
                    <div className="tc-sub">No hay horarios activos ahora mismo.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {(expectedNow || []).map((x: any) => (
                        <div
                          key={`${x.schedule_id}-${x.worker_id}`}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: x.is_online ? "rgba(120,255,190,0.08)" : "rgba(255,80,80,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 900 }}>
                                {x.worker?.display_name || x.display_name || x.worker_id}
                              </div>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                {x.worker?.role || x.role || "—"} · {x.start_time}–{x.end_time} · {x.timezone}
                              </div>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                Estado actual: <b>{x.status || "working"}</b>
                              </div>
                            </div>
                            <div
                              className="tc-chip"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                ...(x.is_online
                                  ? {
                                      background: "rgba(120,255,190,0.10)",
                                      border: "1px solid rgba(120,255,190,0.25)",
                                    }
                                  : {
                                      background: "rgba(255,80,80,0.10)",
                                      border: "1px solid rgba(255,80,80,0.25)",
                                    }),
                              }}
                            >
                              {x.is_online ? "🟢 OK" : "🔴 NO"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 14 }}>👥 Gestión de plantilla y horarios</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Tabla operativa para editar tarotistas, dar de baja y tocar horarios.
                      {staffMsg ? ` · ${staffMsg}` : ""}
                    </div>
                  </div>

                  <button className="tc-btn tc-btn-gold" onClick={() => loadStaff(false)} disabled={staffLoading}>
                    {staffLoading ? "Cargando…" : "Recargar plantilla"}
                  </button>
                </div>

                <div className="tc-hr" />

                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <input
                    className="tc-input"
                    value={staffQ}
                    onChange={(e) => setStaffQ(e.target.value)}
                    placeholder="Buscar tarotista o central…"
                    style={{ width: 320, maxWidth: "100%" }}
                  />

                  <div className="tc-sub">
                    Total visibles: <b>{staffOperationalWorkers.length}</b>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ overflowX: "auto" }}>
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Rol</th>
                        <th>Equipo</th>
                        <th>Email</th>
                        <th>Estado</th>
                        <th>Horarios</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(staffOperationalWorkers || []).map((w: any) => {
                        const schedules = schedulesByWorker.get(String(w.id)) || [];
                        return (
                          <tr key={w.id}>
                            <td><b>{w.display_name || "—"}</b></td>
                            <td>{w.role || "—"}</td>
                            <td>{w.team || "—"}</td>
                            <td>{w.email || "—"}</td>
                            <td>
                              <span className="tc-chip" style={{ padding: "4px 10px" }}>
                                {w.is_active ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td>
                              {schedules.length === 0 ? (
                                <span className="tc-muted">Sin horarios</span>
                              ) : (
                                <div style={{ display: "grid", gap: 4 }}>
                                  {schedules.slice(0, 3).map((s: any) => (
                                    <span key={s.id} className="tc-sub">
                                      {dayName(s.day_of_week)} · {s.start_time}–{s.end_time}
                                    </span>
                                  ))}
                                  {schedules.length > 3 ? (
                                    <span className="tc-sub">+ {schedules.length - 3} más</span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                <button className="tc-btn" onClick={() => startEditWorker(w)}>
                                  Editar
                                </button>
                                <button className="tc-btn tc-btn-gold" onClick={() => prepareScheduleForWorker(w)}>
                                  Cambiar horario
                                </button>
                                {w.is_active ? (
                                  <button className="tc-btn tc-btn-danger" onClick={() => toggleWorker(w, false)}>
                                    Dar de baja
                                  </button>
                                ) : (
                                  <button className="tc-btn tc-btn-ok" onClick={() => toggleWorker(w, true)}>
                                    Activar
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {(!staffOperationalWorkers || staffOperationalWorkers.length === 0) && (
                        <tr>
                          <td colSpan={7} className="tc-muted">
                            No hay trabajadores que coincidan.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {editingWorkerId ? (
                  <>
                    <div className="tc-hr" />
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="tc-title" style={{ fontSize: 14 }}>✏️ Editar trabajador</div>
                      <div className="tc-hr" />
                      <div className="tc-grid-4">
                        <div>
                          <div className="tc-sub">Nombre</div>
                          <input
                            className="tc-input"
                            value={editingWorkerName}
                            onChange={(e) => setEditingWorkerName(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </div>
                        <div>
                          <div className="tc-sub">Rol</div>
                          <select
                            className="tc-select"
                            value={editingWorkerRole}
                            onChange={(e) => setEditingWorkerRole(e.target.value as any)}
                            style={{ width: "100%", marginTop: 6 }}
                          >
                            <option value="tarotista">tarotista</option>
                            <option value="central">central</option>
                            <option value="admin">admin</option>
                          </select>
                        </div>
                        <div>
                          <div className="tc-sub">Equipo</div>
                          <input
                            className="tc-input"
                            value={editingWorkerTeam}
                            onChange={(e) => setEditingWorkerTeam(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </div>
                        <div>
                          <div className="tc-sub">Email</div>
                          <input
                            className="tc-input"
                            value={editingWorkerEmail}
                            onChange={(e) => setEditingWorkerEmail(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </div>
                      </div>

                      <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
                        <button className="tc-btn" onClick={cancelEditWorker}>
                          Cancelar
                        </button>
                        <button className="tc-btn tc-btn-ok" onClick={updateWorker}>
                          Guardar cambios
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="tc-hr" />

                <div className="tc-grid-2">
                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="tc-title" style={{ fontSize: 14 }}>➕ Añadir trabajador</div>
                    <div className="tc-hr" />
                    <div style={{ display: "grid", gap: 10 }}>
                      <input
                        className="tc-input"
                        value={newWorkerName}
                        onChange={(e) => setNewWorkerName(e.target.value)}
                        placeholder="Nombre"
                      />
                      <select className="tc-select" value={newWorkerRole} onChange={(e) => setNewWorkerRole(e.target.value as any)}>
                        <option value="tarotista">tarotista</option>
                        <option value="central">central</option>
                        <option value="admin">admin</option>
                      </select>
                      <input
                        className="tc-input"
                        value={newWorkerTeam}
                        onChange={(e) => setNewWorkerTeam(e.target.value)}
                        placeholder="Equipo (opcional)"
                      />
                      <input
                        className="tc-input"
                        value={newWorkerEmail}
                        onChange={(e) => setNewWorkerEmail(e.target.value)}
                        placeholder="Email (opcional)"
                      />
                      <div className="tc-row" style={{ justifyContent: "flex-end" }}>
                        <button className="tc-btn tc-btn-ok" onClick={createWorker}>
                          Crear trabajador
                        </button>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="tc-title" style={{ fontSize: 14 }}>🕒 Añadir o cambiar horario</div>
                    <div className="tc-hr" />
                    <div style={{ display: "grid", gap: 10 }}>
                      <select className="tc-select" value={scheduleWorkerId} onChange={(e) => setScheduleWorkerId(e.target.value)}>
                        <option value="">Selecciona trabajador</option>
                        {(staffOperationalWorkers || []).map((w: any) => (
                          <option key={w.id} value={w.id}>
                            {w.display_name} ({w.role})
                          </option>
                        ))}
                      </select>

                      <select className="tc-select" value={scheduleDay} onChange={(e) => setScheduleDay(e.target.value)}>
                        <option value="0">Domingo</option>
                        <option value="1">Lunes</option>
                        <option value="2">Martes</option>
                        <option value="3">Miércoles</option>
                        <option value="4">Jueves</option>
                        <option value="5">Viernes</option>
                        <option value="6">Sábado</option>
                      </select>

                      <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <input className="tc-input" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} placeholder="10:00:00" style={{ width: 160 }} />
                        <input className="tc-input" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} placeholder="18:00:00" style={{ width: 160 }} />
                      </div>

                      <input
                        className="tc-input"
                        value={scheduleTimezone}
                        onChange={(e) => setScheduleTimezone(e.target.value)}
                        placeholder="Europe/Madrid"
                      />

                      <div className="tc-row" style={{ justifyContent: "flex-end" }}>
                        <button className="tc-btn tc-btn-ok" onClick={createSchedule}>
                          Crear horario
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 12 }}>
                  {(staffOperationalWorkers || []).map((w: any) => {
                    const schedules = schedulesByWorker.get(String(w.id)) || [];
                    return (
                      <div
                        key={w.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: scheduleWorkerId === String(w.id) ? "rgba(181,156,255,0.07)" : "rgba(255,255,255,0.03)",
                        }}
                      >
                        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>{w.display_name}</div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              {w.role} · {w.team || "sin equipo"} · {w.email || "sin email"}
                            </div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              Estado: <b>{w.is_active ? "Activo" : "Inactivo"}</b>
                            </div>
                          </div>

                          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <button className="tc-btn" onClick={() => startEditWorker(w)}>
                              Editar ficha
                            </button>
                            <button className="tc-btn tc-btn-gold" onClick={() => prepareScheduleForWorker(w)}>
                              {scheduleWorkerId === String(w.id) ? "Horario seleccionado" : "Cambiar horario"}
                            </button>
                            {w.is_active ? (
                              <button className="tc-btn tc-btn-danger" onClick={() => toggleWorker(w, false)}>
                                Dar de baja
                              </button>
                            ) : (
                              <button className="tc-btn tc-btn-ok" onClick={() => toggleWorker(w, true)}>
                                Activar
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="tc-hr" />

                        {schedules.length === 0 ? (
                          <div className="tc-sub">Sin horarios asignados.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {schedules.map((s: any) => (
                              <ScheduleRow
                                key={s.id}
                                schedule={s}
                                onSave={(patch) => updateSchedule(s.id, patch)}
                                onDelete={() => deleteSchedule(s.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(!staffOperationalWorkers || staffOperationalWorkers.length === 0) && (
                    <div className="tc-sub">No hay trabajadores que coincidan.</div>
                  )}
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-title" style={{ fontSize: 14 }}>⚠️ Incidencias de asistencia</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Mes {month}. Aquí justificas o marcas como no justificadas.
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-2" style={{ marginBottom: 14 }}>
                  <div>
                    <div className="tc-sub">Nota para la decisión</div>
                    <input
                      className="tc-input"
                      value={attNote}
                      onChange={(e) => setAttNote(e.target.value)}
                      placeholder="Ej: justificó con captura / aviso previo…"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>
                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      alignSelf: "end",
                    }}
                  >
                    <div className="tc-sub">Resumen rápido</div>
                    <div style={{ fontWeight: 900, fontSize: 18, marginTop: 6 }}>
                      {(attIncidents || []).length} incidencia(s)
                    </div>
                  </div>
                </div>

                {(attIncidents || []).length === 0 ? (
                  <div className="tc-sub">No hay incidencias de asistencia en este mes.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {(attIncidents || []).map((i: any) => (
                      <div
                        key={i.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(255,255,255,0.03)",
                        }}
                      >
                        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>
                              {i.display_name ? `${i.display_name} · ` : ""}
                              {i.reason || "Incidencia"}
                            </div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              {i.meta?.type ? `Tipo: ${i.meta.type}` : ""}
                              {i.meta?.date ? ` · Fecha: ${i.meta.date}` : ""}
                              {i.created_at ? ` · Creada: ${new Date(i.created_at).toLocaleString("es-ES")}` : ""}
                            </div>
                            {i.evidence_note ? (
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                Nota actual: <b>{i.evidence_note}</b>
                              </div>
                            ) : null}
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 900, fontSize: 18 }}>-{eur(i.amount)}</div>
                            <div className="tc-sub">
                              Estado: <b>{String(i.status || "unjustified")}</b>
                            </div>
                          </div>
                        </div>

                        <div className="tc-row" style={{ marginTop: 10, justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                          <button className="tc-btn tc-btn-ok" onClick={() => decideIncident(i.id, "justified")}>
                            Marcar JUSTIFICADA
                          </button>
                          <button className="tc-btn tc-btn-danger" onClick={() => decideIncident(i.id, "unjustified")}>
                            Marcar NO justificada
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 14 }}>📊 Estadísticas horarias</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Worked = trabajo real · Break y baño separados · Expected = horario planificado
                      {stMsg ? ` · ${stMsg}` : ""}
                    </div>
                  </div>

                  <button className="tc-btn tc-btn-gold" onClick={() => loadStats(false)} disabled={stLoading}>
                    {stLoading ? "Cargando…" : "Cargar stats"}
                  </button>
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-4">
                  <div>
                    <div className="tc-sub">Worker</div>
                    <input
                      className="tc-input"
                      value={stWorkerId}
                      onChange={(e) => setStWorkerId(e.target.value)}
                      placeholder="worker_id (opcional)"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>

                  <div>
                    <div className="tc-sub">Agrupar</div>
                    <select
                      className="tc-select"
                      value={stGroup}
                      onChange={(e) => setStGroup(e.target.value as any)}
                      style={{ width: "100%", marginTop: 6 }}
                    >
                      <option value="day">día</option>
                      <option value="week">semana</option>
                      <option value="month">mes</option>
                    </select>
                  </div>

                  <div>
                    <div className="tc-sub">Desde</div>
                    <input
                      className="tc-input"
                      value={stFrom}
                      onChange={(e) => setStFrom(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>

                  <div>
                    <div className="tc-sub">Hasta</div>
                    <input
                      className="tc-input"
                      value={stTo}
                      onChange={(e) => setStTo(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>
                </div>

                <div className="tc-sub" style={{ marginTop: 10, opacity: 0.85 }}>
                  Tip: si quieres un desplegable global de workers, hacemos luego endpoint `/api/admin/workers/list`.
                </div>

                <div className="tc-hr" />

                <div style={{ overflowX: "auto" }}>
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Trabajador</th>
                        <th>Rol</th>
                        <th>Worked</th>
                        <th>Break</th>
                        <th>Baño</th>
                        <th>Expected</th>
                        <th>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stRows || []).map((r: any, idx: number) => {
                        const diff = Number(r.diff_minutes || 0);
                        const diffLabel = minsToHhmm(Math.abs(diff));
                        return (
                          <tr key={`${r.worker_id}-${r.group_key}-${idx}`}>
                            <td><b>{r.group_key}</b></td>
                            <td>{r.display_name || r.worker_id}</td>
                            <td className="tc-muted">{r.role || "—"}</td>
                            <td><b>{minsToHhmm(r.worked_minutes)}</b></td>
                            <td>{minsToHhmm(r.break_minutes)}</td>
                            <td>{minsToHhmm(r.bathroom_minutes)}</td>
                            <td>{minsToHhmm(r.expected_minutes)}</td>
                            <td style={{ fontWeight: 900 }}>
                              {diff >= 0 ? `+${diffLabel}` : `-${diffLabel}`}
                            </td>
                          </tr>
                        );
                      })}
                      {(!stRows || stRows.length === 0) && (
                        <tr>
                          <td colSpan={8} className="tc-muted">
                            Sin datos. Revisa el rango y el endpoint `/api/admin/attendance/stats`.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="tc-sub" style={{ marginTop: 10, opacity: 0.85 }}>
                  Nota: si quieres “Horas hechas” incluyendo descanso y baño, suma worked + break + baño.
                </div>
              </div>
            </div>
          )}


          {tab === "clientes" && (
            <AdminClientesTab onReviewClient={openAdminClienteReview} />
          )}

          {tab === "rangos-clientes" && <ClientRanksAdminPanel />}

          {tab === "clientes-web" && (
            <ClientWebAdminPanel
              onOpenCrm={(clientId) => {
                setTab("crm");
                window.setTimeout(() => window.dispatchEvent(new CustomEvent("crm-open-cliente", { detail: { id: clientId } })), 250);
              }}
              onManageRank={() => setTab("rangos-clientes")}
            />
          )}

          {tab === "crm" && (
            <CRMClientesPanel mode="admin" />
          )}

          {tab === "chat" && <AdminChatPanel />}

          {tab === "captacion" && (
            <CaptacionPanel
              onOpenClient={(clienteId) => {
                setTab("crm" as any);
                window.setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("crm-open-cliente", { detail: { id: String(clienteId) } }));
                }, 250);
              }}
            />
          )}
          {tab === "rendimiento" && <RendimientoPanel mode="admin" />}
          {tab === "reservas" && <ReservasPanel mode="admin" />}
          {tab === "diario" && <DiarioPanel />}
          <ManualInvoiceModal
            open={manualInvoiceOpen}
            invoiceId={manualInvoiceId}
            onClose={() => setManualInvoiceOpen(false)}
            onSaved={() => { void listInvoices(true); }}
          />

        </div>
      </main>
    </div>

      {crmCloseNotif && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="tc-card"
            style={{
              width: "100%",
              maxWidth: 520,
              boxShadow: "0 30px 90px rgba(0,0,0,0.48)",
              borderRadius: 24,
              background: "linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04))",
            }}
          >
            <div className="tc-title">📞 Llamada finalizada</div>
            <div className="tc-sub" style={{ marginTop: 10 }}>
              <b>{crmCloseNotif.tarotista_nombre || "Una tarotista"}</b> ha terminado la llamada
            </div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Le han sobrado en total <b>{crmCloseNotif.minutos_sobrantes_total || 0}</b> minutos
            </div>

            <div className="tc-row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                className="tc-btn"
                onClick={async () => {
                  const notifId = String(crmCloseNotif?.id || "");
                  if (notifId) setCrmDismissedIds((prev) => (prev.includes(notifId) ? prev : [...prev, notifId]));
                  await markCrmCloseNotifRead(notifId);
                  setCrmCloseNotif(null);
                }}
              >
                Cerrar
              </button>
              <button
                className="tc-btn tc-btn-gold"
                onClick={async () => {
                  const notifId = String(crmCloseNotif?.id || "");
                  if (notifId) setCrmDismissedIds((prev) => (prev.includes(notifId) ? prev : [...prev, notifId]));
                  await markCrmCloseNotifRead(notifId);
                  setTab("crm" as any);
                  setTimeout(() => {
                    window.dispatchEvent(
                      new CustomEvent("crm-open-cliente", {
                        detail: { id: crmCloseNotif.cliente_id },
                      })
                    );
                  }, 250);
                  setCrmCloseNotif(null);
                }}
              >
                Revisar
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}


function KpiBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        border: highlight ? "1px solid rgba(215,181,109,0.28)" : "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18,
        padding: 16,
        background: highlight
          ? "linear-gradient(180deg, rgba(215,181,109,0.16), rgba(255,255,255,0.03))"
          : "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))",
        boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -18px -24px auto",
          width: 92,
          height: 92,
          borderRadius: 999,
          background: highlight ? "rgba(215,181,109,0.24)" : "rgba(181,156,255,0.16)",
          filter: "blur(22px)",
          opacity: 0.55,
          pointerEvents: "none",
        }}
      />
      <div className="tc-sub" style={{ fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 26, marginTop: 8, lineHeight: 1.05 }}>{value}</div>
    </div>
  );
}


function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: 12,
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))",
        boxShadow: "0 14px 30px rgba(0,0,0,0.14)",
      }}
    >
      <div className="tc-sub" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 20, marginTop: 8, lineHeight: 1.05 }}>{value}</div>
    </div>
  );
}


function TopStatsCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div
      className="tc-card"
      style={{
        padding: 18,
        borderRadius: 20,
        background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))",
        boxShadow: "0 22px 50px rgba(0,0,0,0.18)",
      }}
    >
      <div className="tc-title" style={{ fontSize: 15 }}>{title}</div>
      <div className="tc-hr" />
      <div style={{ display: "grid", gap: 10 }}>
        {(items || []).slice(0, 3).map((t, i) => (
          <div
            key={i}
            className="tc-row"
            style={{
              justifyContent: "space-between",
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span style={{ fontWeight: 700 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {t}</span>
          </div>
        ))}
        {(!items || items.length === 0) && <div className="tc-sub">Sin datos</div>}
      </div>
    </div>
  );
}

function LineEditor({
  line,
  onSave,
  onDelete,
}: {
  line: any;
  onSave: (payload: { label: string; amount?: number; meta?: any }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState<string>(line.label || "");
  const [amount, setAmount] = useState<string>(String(line.amount ?? "0"));

  const meta = line?.meta || {};
  const hasBreakdown = meta && meta.minutes != null && meta.rate != null;
  const isProtectedSalary =
    String(line?.kind || "") === "salary_base" ||
    meta?.locked === true ||
    meta?.protected === true;
  const isSalaryBonus = String(line?.kind || "") === "salary_bonus";

  const [minutes, setMinutes] = useState<string>(String(meta.minutes ?? ""));
  const [rate, setRate] = useState<string>(String(meta.rate ?? ""));

  useEffect(() => {
    setLabel(String(line.label || ""));
    setAmount(String(line.amount ?? "0"));
    setMinutes(String(line?.meta?.minutes ?? ""));
    setRate(String(line?.meta?.rate ?? ""));
  }, [line]);

  const parsedMinutes = Number(String(minutes).replace(",", "."));
  const parsedRate = Number(String(rate).replace(",", "."));
  const calcAmount = roundMoney((isFinite(parsedMinutes) ? parsedMinutes : 0) * (isFinite(parsedRate) ? parsedRate : 0));

  const displayAmount = hasBreakdown ? calcAmount : Number(String(amount).replace(",", ".")) || 0;
  const code = String(meta.code || "").toUpperCase();

  function saveLine() {
    if (isProtectedSalary) return;

    if (hasBreakdown) {
      const nextMeta = {
        ...meta,
        minutes: isFinite(parsedMinutes) ? parsedMinutes : 0,
        rate: isFinite(parsedRate) ? parsedRate : 0,
      };

      onSave({
        label,
        meta: nextMeta,
      });
      return;
    }

    onSave({
      label,
      amount: Number(String(amount).replace(",", ".")) || 0,
      meta,
    });
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 900 }}>{label}</div>
          {hasBreakdown && (
            <div className="tc-sub" style={{ marginTop: 6 }}>
              {numES(isFinite(parsedRate) ? parsedRate : 0, 2)}€ x {numES(isFinite(parsedMinutes) ? parsedMinutes : 0, 0)} min = <b>{eur(calcAmount)}</b>
              {code ? <> · Código <b>{code}</b></> : null}
            </div>
          )}
        </div>

        <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{eur(displayAmount)}</div>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="tc-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={isProtectedSalary || isSalaryBonus}
            style={{ width: "100%", opacity: isProtectedSalary ? 0.8 : 1 }}
          />
          {isProtectedSalary && (
            <span className="tc-chip" style={{ padding: "5px 9px" }}>
              🔒 Importe fijo protegido
            </span>
          )}
          {isSalaryBonus && (
            <span className="tc-chip" style={{ padding: "5px 9px" }}>
              Bonus opcional · editable por factura
            </span>
          )}
        </div>

        {hasBreakdown ? (
          <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 0, flexWrap: "wrap" }}>
            <div style={{ minWidth: 160 }}>
              <div className="tc-sub">Minutos</div>
              <input
                className="tc-input"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                style={{ width: 160, marginTop: 6 }}
              />
            </div>

            <div style={{ minWidth: 160 }}>
              <div className="tc-sub">Tarifa €/min</div>
              <input
                className="tc-input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                style={{ width: 160, marginTop: 6 }}
              />
            </div>

            <div style={{ minWidth: 180 }}>
              <div className="tc-sub">Importe recalculado</div>
              <div className="tc-chip" style={{ marginTop: 6 }}>
                <b>{eur(calcAmount)}</b>
              </div>
            </div>

            <div className="tc-row" style={{ alignItems: "flex-end" }}>
              <button className="tc-btn tc-btn-ok" onClick={saveLine}>
                Guardar
              </button>
              <button className="tc-btn tc-btn-danger" onClick={onDelete}>
                Borrar
              </button>
            </div>
          </div>
        ) : (
          <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 0, flexWrap: "wrap" }}>
            <div>
              <div className="tc-sub">
                {isProtectedSalary ? "Sueldo fijo mensual" : isSalaryBonus ? "Cantidad de bonus" : "Importe"}
              </div>
              <input
                className="tc-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProtectedSalary}
                style={{ width: 160, marginTop: 6, opacity: isProtectedSalary ? 0.75 : 1 }}
              />
            </div>

            <div className="tc-row">
              {!isProtectedSalary && (
                <button className="tc-btn tc-btn-ok" onClick={saveLine}>
                  Guardar
                </button>
              )}
              {!isProtectedSalary && !isSalaryBonus && (
                <button className="tc-btn tc-btn-danger" onClick={onDelete}>
                  Borrar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  onSave,
  onDelete,
}: {
  schedule: any;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [day, setDay] = useState(String(schedule.day_of_week ?? 1));
  const [start, setStart] = useState(String(schedule.start_time || ""));
  const [end, setEnd] = useState(String(schedule.end_time || ""));
  const [timezone, setTimezone] = useState(String(schedule.timezone || "Europe/Madrid"));
  const [active, setActive] = useState(!!schedule.is_active);

  useEffect(() => {
    setDay(String(schedule.day_of_week ?? 1));
    setStart(String(schedule.start_time || ""));
    setEnd(String(schedule.end_time || ""));
    setTimezone(String(schedule.timezone || "Europe/Madrid"));
    setActive(!!schedule.is_active);
  }, [schedule]);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        padding: 10,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 900 }}>{dayName(day)}</div>
          <div className="tc-sub" style={{ marginTop: 4 }}>
            {start} → {end} · {timezone}
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select className="tc-select" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 130 }}>
            <option value="0">Domingo</option>
            <option value="1">Lunes</option>
            <option value="2">Martes</option>
            <option value="3">Miércoles</option>
            <option value="4">Jueves</option>
            <option value="5">Viernes</option>
            <option value="6">Sábado</option>
          </select>

          <input className="tc-input" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 120 }} />
          <input className="tc-input" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 120 }} />
          <input className="tc-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: 160 }} />

          <label className="tc-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo
          </label>

          <button
            className="tc-btn tc-btn-ok"
            onClick={() =>
              onSave({
                day_of_week: Number(day),
                start_time: start,
                end_time: end,
                timezone,
                is_active: active,
              })
            }
          >
            Guardar
          </button>

          <button className="tc-btn tc-btn-danger" onClick={onDelete}>
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Cargando…</div>}>
      <AdminPage />
    </Suspense>
  );
}

