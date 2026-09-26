"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TarotistaBonuses from "@/components/bonuses/TarotistaBonuses";
import AppHeader from "@/components/AppHeader";
import OperationalInbox from "@/components/central/OperationalInbox";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { loadPanelIdentity, panelPathForRole, redirectToLogin } from "@/lib/panel-access";
import { useAttendance } from "@/hooks/useAttendance";
import StaffDirectChatPanel from "@/components/chat/StaffDirectChatPanel";
import TarotistaInvoiceDashboard from "@/components/tarotista/TarotistaInvoiceDashboard";
import TarotistaStatusHeader from "@/components/tarotista/TarotistaStatusHeader";
import TarotistaRanksPanel from "@/components/tarotista/TarotistaRanksPanel";
import TarotistaRankingArena from "@/components/tarotista/TarotistaRankingArena";
import TeamCompetitionArena from "@/components/teams/TeamCompetitionArena";
import { Activity, AlertTriangle, ArrowRight, BadgeEuro, BellRing, CalendarDays, CheckCircle2, CircleAlert, ClipboardCheck, Clock3, Crown, Droplets, Flame, LayoutDashboard, ListChecks, MessageSquare, MessagesSquare, PhoneCall, PhoneForwarded, PhoneOff, Radio, ReceiptText, RefreshCw, Search, Send, ShieldAlert, Sparkles, Star, Trophy, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import panelStyles from "./TarotistaPanel.module.css";

const sb = supabaseBrowser();

type TabKey =
  | "resumen"
  | "notificaciones"
  | "clientes"
  | "bonos"
  | "rangos"
  | "ranking"
  | "equipos"
  | "facturas"
  | "checklist"
  | "chat";

const TAROTISTA_NAV: ReadonlyArray<{ key: TabKey; label: string; kicker: string; icon: LucideIcon }> = [
  { key: "resumen", label: "Resumen", kicker: "Centro de turno", icon: LayoutDashboard },
  { key: "notificaciones", label: "Notificaciones", kicker: "Avisos y seguimiento", icon: BellRing },
  { key: "clientes", label: "Clientes", kicker: "Listas y seguimiento", icon: Send },
  { key: "chat", label: "Chat", kicker: "Central en directo", icon: MessageSquare },
  { key: "bonos", label: "Bonos", kicker: "Captadas y tramos", icon: BadgeEuro },
  { key: "rangos", label: "Rangos", kicker: "Categoría y progreso", icon: Star },
  { key: "ranking", label: "Ranking", kicker: "Top del mes", icon: Trophy },
  { key: "equipos", label: "Equipos", kicker: "Competición", icon: Flame },
  { key: "checklist", label: "Checklist", kicker: "Turno actual", icon: ClipboardCheck },
  { key: "facturas", label: "Factura", kicker: "Resumen mensual", icon: ReceiptText },
];

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return value || "Periodo actual";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return value || "Periodo actual";
  const label = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getMonthFromUrl() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("month") || monthKeyNow();
  } catch {
    return monthKeyNow();
  }
}

function setMonthInUrl(m: string) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("month", m);
    window.history.pushState({}, "", u.toString());
  } catch {}
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function pct(n: any) {
  const x = Number(n) || 0;
  return `${x.toFixed(2)}%`;
}

function n2(n: any) {
  const x = Number(n) || 0;
  return x.toFixed(2);
}

function formatDuration(totalSeconds: number) {
  const value = Math.max(0, Math.round(totalSeconds || 0));
  const hh = Math.floor(value / 3600);
  const mm = Math.floor((value % 3600) / 60);
  const ss = value % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

type OutboundFilter = "all" | "pending" | "progress" | "done";
type OutboundTone = "violet" | "gold" | "blue" | "green" | "red";

function outboundStatusInfo(value: unknown): { label: string; group: Exclude<OutboundFilter, "all">; tone: OutboundTone; Icon: LucideIcon } {
  const status = String(value || "pending").toLowerCase();
  switch (status) {
    case "done":
      return { label: "Completada", group: "done", tone: "green", Icon: CheckCircle2 };
    case "calling":
      return { label: "En curso", group: "progress", tone: "blue", Icon: PhoneCall };
    case "answered":
      return { label: "Contestó", group: "progress", tone: "blue", Icon: PhoneCall };
    case "callback":
      return { label: "Llamar después", group: "pending", tone: "gold", Icon: PhoneForwarded };
    case "no_answer":
      return { label: "No contesta", group: "pending", tone: "red", Icon: PhoneOff };
    case "busy":
      return { label: "Ocupado", group: "pending", tone: "gold", Icon: PhoneOff };
    case "wrong_number":
      return { label: "Número incorrecto", group: "pending", tone: "red", Icon: CircleAlert };
    case "pending":
      return { label: "Pendiente", group: "pending", tone: "gold", Icon: Clock3 };
    default:
      return { label: status || "Pendiente", group: "pending", tone: "violet", Icon: Activity };
  }
}

function clientInitials(value: unknown) {
  const parts = String(value || "Cliente").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "CL").slice(0, 2);
}

function formatOutboundDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const text = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parsed);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatOutboundTime(value: unknown) {
  const parsed = value ? new Date(String(value)) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function relativeOutboundTime(value: unknown) {
  const parsed = value ? new Date(String(value)) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  const diff = Math.max(0, Date.now() - parsed.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
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


function medalForPos(pos: number | null) {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return "—";
}

function clampPct(n: number) {
  const x = Number(n) || 0;
  return Math.max(0, Math.min(100, x));
}

function getInvoiceVisibleStatus(invoice: any) {
  const ack = String(invoice?.worker_ack || "").trim().toLowerCase();
  if (ack === "accepted" || ack === "rejected" || ack === "review") return ack;
  return String(invoice?.status || "pending");
}

function attendanceStatusLabel(status: string, online: boolean) {
  if (!online) return "Desconectada";
  const value = String(status || "working").toLowerCase();
  if (value === "break") return "En descanso";
  if (value === "bathroom") return "Pausa breve";
  return "Disponible";
}

function NotificationGlyph({ id }: { id: string }) {
  if (id === "attendance") return <Radio size={21} />;
  if (id === "chat") return <MessagesSquare size={21} />;
  if (id === "checklist") return <ListChecks size={21} />;
  if (id.startsWith("client-")) return <UserRound size={21} />;
  if (id.startsWith("incident-")) return <ShieldAlert size={21} />;
  return <BellRing size={21} />;
}

async function getTokenSafe(): Promise<string | null> {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token || null;
    return token;
  } catch {
    return null;
  }
}

async function getTokenWithRetry(ms = 350, tries = 3): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const t = await getTokenSafe();
    if (t) return t;
    await new Promise((r) => setTimeout(r, ms));
  }
  return null;
}

type ChatThread = {
  id: string;
  title?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
};

type ChatMessage = {
  id: string;
  thread_id: string;
  sender_worker_id?: string | null;
  sender_display_name?: string | null;
  text?: string | null;
  created_at?: string | null;
};

export default function Tarotista() {
  const attendance = useAttendance();
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("resumen");

  const [month, setMonth] = useState(monthKeyNow());
  const [stats, setStats] = useState<any>(null);
  const [rank, setRank] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");
  const [dataRefreshing, setDataRefreshing] = useState(false);
  const [rankingRefreshing, setRankingRefreshing] = useState(false);

  const [incidents, setIncidents] = useState<any[]>([]);
  const [invoice, setInvoice] = useState<any>(null);
  const [invoiceLines, setInvoiceLines] = useState<any[]>([]);
  const [invoiceInsights, setInvoiceInsights] = useState<any>(null);
  const [ackNote, setAckNote] = useState<string>("");

  const [myWorkerId, setMyWorkerId] = useState<string>("");
  const [tarotistaLevel, setTarotistaLevel] = useState<1 | 2>(1);

  const [clLoading, setClLoading] = useState(false);
  const [clMsg, setClMsg] = useState("");
  const [clShiftKey, setClShiftKey] = useState<string>("");
  const [clRows, setClRows] = useState<any[]>([]);
  const [clQ, setClQ] = useState("");

  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const [attOnline, setAttOnline] = useState(false);
  const [attStatus, setAttStatus] = useState<string>("offline");
  const attBeatRef = useRef<any>(null);

  const [obDate, setObDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [obLoading, setObLoading] = useState(false);
  const [obMsg, setObMsg] = useState("");
  const [obBatch, setObBatch] = useState<any>(null);
  const [obItems, setObItems] = useState<any[]>([]);
  const obChannelRef = useRef<any>(null);
  const [obDraft, setObDraft] = useState<string>("");
  const [obSending, setObSending] = useState(false);
  const [obSearch, setObSearch] = useState("");
  const [obFilter, setObFilter] = useState<OutboundFilter>("all");

  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const [chatUnread, setChatUnread] = useState(0);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    const update = (event: Event) => setChatUnread(Math.max(0, Number((event as CustomEvent<{ count?: number }>).detail?.count || 0)));
    window.addEventListener("tc-chat-unread", update as EventListener);
    return () => window.removeEventListener("tc-chat-unread", update as EventListener);
  }, []);
  const [msgText, setMsgText] = useState("");
  const msgEndRef = useRef<HTMLDivElement | null>(null);
  const chatChannelRef = useRef<any>(null);
  const popupChannelRef = useRef<any>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string>("");
  const [incomingPopup, setIncomingPopup] = useState<any>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupBusy, setPopupBusy] = useState(false);
  const [activeCall, setActiveCall] = useState<any>(null);
  const [closeFreeUsed, setCloseFreeUsed] = useState("0");
  const [closeNormalesUsed, setCloseNormalesUsed] = useState("0");
  const [closeLoading, setCloseLoading] = useState(false);
  const [activeCallElapsed, setActiveCallElapsed] = useState(0);
  const [closeManualOverride, setCloseManualOverride] = useState(false);
  const [closeMsg, setCloseMsg] = useState("");

 const incidenciasLive = useMemo(() => {
  return (incidents || []).reduce((a, x) => a + Number(x.amount || 0), 0);
}, [incidents]);

  const s = stats?.stats || {};
  const captadas = Number(s?.captadas_total || 0);
  const tier = s?.capture_tier || { label: "Sin tramo activo", nextAt: null };
  const prog = s?.capture_progress || { pct: 0, text: "Consulta tus tramos en Bonos" };

  const payMinutes = Number(s?.pay_minutes || 0);
  const bonusCaptadas = Number(s?.bonus_captadas || 0);
  const myPublicRangeRaw = String(s?.tarotista_rango || "B").toUpperCase();
  const myPublicRange = (["C", "B", "A", "S"] as const).includes(myPublicRangeRaw as any) ? myPublicRangeRaw : "B";

  const bonusRanking = Number(s?.bonus_ranking || 0);
  const br = s?.bonus_ranking_breakdown || {};
  const brCaptadas = Number(br?.captadas || 0);
  const brCliente = Number(br?.cliente || 0);
  const brRepite = Number(br?.repite || 0);

  const bonusTotal = bonusCaptadas + bonusRanking;
  const totalPreview = payMinutes + bonusTotal - incidenciasLive;
  const canSeeMoney = tarotistaLevel !== 2;
  const money = (n: any) => (canSeeMoney ? eur(n) : "Oculto nivel 2");

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  const posCaptadas: number | null = useMemo(() => {
    const i = (topCaptadas || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topCaptadas, myWorkerId]);

  const posCliente: number | null = useMemo(() => {
    const i = (topCliente || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topCliente, myWorkerId]);

  const posRepite: number | null = useMemo(() => {
    const i = (topRepite || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topRepite, myWorkerId]);

  const clFiltered = useMemo(() => {
    const qq = clQ.trim().toLowerCase();
    if (!qq) return clRows || [];
    return (clRows || []).filter((it: any) =>
      String(it.title || it.label || it.item_key || "").toLowerCase().includes(qq)
    );
  }, [clRows, clQ]);

  const clProgress = useMemo(() => {
    const rows = clRows || [];
    const total = rows.length;
    const completed = rows.filter((r: any) => !!r.done || r.status === "completed" || r.completed === true).length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pct };
  }, [clRows]);

  const pendingChecklist = Math.max(0, clProgress.total - clProgress.completed);
  const outboundPending = (obItems || []).filter((it: any) => String(it.current_status || "pending").toLowerCase() !== "done").length;

  const outboundDashboard = useMemo(() => {
    const rows = obItems || [];
    const total = rows.length;
    const completed = rows.filter((it: any) => outboundStatusInfo(it.current_status).group === "done").length;
    const inProgress = rows.filter((it: any) => outboundStatusInfo(it.current_status).group === "progress").length;
    const pending = Math.max(0, total - completed - inProgress);
    const progress = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, pending, progress };
  }, [obItems]);

  const outboundVisibleItems = useMemo(() => {
    const query = obSearch.trim().toLowerCase();
    return (obItems || []).filter((it: any) => {
      const info = outboundStatusInfo(it.current_status);
      if (obFilter !== "all" && info.group !== obFilter) return false;
      if (!query) return true;
      return [it.customer_name, it.phone, it.last_note, info.label]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(query));
    });
  }, [obItems, obSearch, obFilter]);

  const outboundRecentActivity = useMemo(() => {
    return (obItems || [])
      .filter((it: any) => !!it.last_call_at)
      .slice()
      .sort((a: any, b: any) => new Date(String(b.last_call_at)).getTime() - new Date(String(a.last_call_at)).getTime())
      .slice(0, 5);
  }, [obItems]);

  const summaryFocus: Array<{
    id: string;
    label: string;
    value: string;
    hint: string;
    tone: "violet" | "gold" | "red";
    actionTab: TabKey;
  }> = [
    { id: "notif-incidents", label: "Avisos pendientes", value: String(incidents.length || 0), hint: incidents.length ? "Revisa la incidencia" : "Sin avisos críticos", tone: "red", actionTab: "notificaciones" },
    { id: "notif-checklist", label: "Tareas del checklist", value: String(pendingChecklist), hint: pendingChecklist ? "Aún abiertas" : "Todo al día", tone: "gold", actionTab: "checklist" },
    { id: "notif-clients", label: "Seguimiento clientes", value: String(outboundPending), hint: outboundPending ? "Casos por revisar" : "Sin casos pendientes", tone: "violet", actionTab: "clientes" },
  ];

  const notificationItems = useMemo(() => {
    const rows: Array<{
      id: string;
      tone: "gold" | "violet" | "blue" | "red" | "green";
      section: string;
      title: string;
      detail: string;
      actionLabel: string;
      actionTab: TabKey;
      meta?: string;
    }> = [];

    rows.push({
      id: "attendance",
      tone: attOnline ? "green" : "gold",
      section: "Estado del turno",
      title: attOnline ? "Estás lista para recibir actividad" : "Conéctate para recibir actividad",
      detail: attOnline ? `Estado actual: ${String(attStatus || "connected")}.` : "Si no te conectas, no podrás recibir llamadas ni seguimiento de central.",
      actionLabel: "Ver resumen",
      actionTab: "resumen",
      meta: attOnline ? "Operativa activa" : "Acción recomendada",
    });

    if (chatUnread > 0) {
      rows.push({
        id: "chat",
        tone: "blue",
        section: "Comunicación",
        title: `Tienes ${chatUnread} mensaje${chatUnread === 1 ? "" : "s"} sin leer`,
        detail: "Revisa el chat con Central para no perder instrucciones o cambios.",
        actionLabel: "Abrir chat",
        actionTab: "chat",
        meta: "En tiempo real",
      });
    }

    if (pendingChecklist > 0) {
      rows.push({
        id: "checklist",
        tone: "gold",
        section: "Checklist",
        title: `${pendingChecklist} tarea${pendingChecklist === 1 ? "" : "s"} del turno pendiente${pendingChecklist === 1 ? "" : "s"}`,
        detail: "Completa el checklist para llevar el control del turno sin olvidos.",
        actionLabel: "Ir al checklist",
        actionTab: "checklist",
        meta: `${clProgress.completed}/${clProgress.total} completadas`,
      });
    }

    (obItems || []).slice(0, 4).forEach((it: any, idx: number) => {
      const name = String(it.customer_name || "Cliente");
      const status = String(it.current_status || "pending");
      const note = String(it.last_note || "").trim();
      rows.push({
        id: `client-${it.id || idx}`,
        tone: note ? "violet" : "blue",
        section: "Seguimiento cliente",
        title: `${name} · ${status}`,
        detail: note || "Todavía no hay apunte del central. Revisa si necesitas hacer seguimiento.",
        actionLabel: "Abrir clientes",
        actionTab: "clientes",
        meta: it.phone ? `📱 ${it.phone}` : "Lista del día",
      });
    });

    (incidents || []).slice(0, 3).forEach((inc: any, idx: number) => {
      rows.push({
        id: `incident-${inc.id || idx}`,
        tone: String(inc.kind || "") === "attendance_jornada" ? (Number(inc.meta?.pending_minutes || 0) > 0 ? "gold" : "green") : "red",
        section: String(inc.kind || "") === "attendance_jornada" ? "Jornada" : "Incidencias",
        title: String(inc.title || inc.reason || "Incidencia del mes"),
        detail: String(inc.kind || "") === "attendance_jornada" ? `${inc.reason || "Incidencia de jornada"} · ${Number(inc.meta?.pending_minutes || 0)} min pendientes` : String(inc.reason || "Revisión recomendada desde el resumen de factura."),
        actionLabel: "Ver incidencias",
        actionTab: "facturas",
        meta: String(inc.kind || "") === "attendance_jornada" ? `${Number(inc.meta?.recovered_minutes || 0)} min recuperados · sin impacto económico automático` : canSeeMoney ? `Impacto ${eur(Number(inc.amount || 0))}` : "Impacto oculto",
      });
    });

    if (!rows.length) {
      rows.push({
        id: "all-clear",
        tone: "green",
        section: "Todo bajo control",
        title: "No tienes avisos urgentes ahora mismo",
        detail: "Tu panel está limpio. Puedes dedicarte a atender y revisar objetivos del mes.",
        actionLabel: "Volver al resumen",
        actionTab: "resumen",
        meta: "Panel tranquilo",
      });
    }

    return rows;
  }, [attOnline, attStatus, chatUnread, pendingChecklist, clProgress.completed, clProgress.total, obItems, incidents, canSeeMoney]);

  const notificationsCount = notificationItems.filter((item) => item.id !== "attendance" && item.id !== "all-clear").length + (attOnline ? 0 : 1);
  const urgentNotificationsCount = notificationItems.filter((item) => item.tone === "red" || item.tone === "gold").length;
  const notificationMainItems = notificationItems
    .filter((item) => item.id !== "attendance" && item.id !== "all-clear")
    .slice()
    .sort((a, b) => {
      const weight = { red: 0, gold: 1, violet: 2, blue: 3, green: 4 } as const;
      return weight[a.tone] - weight[b.tone];
    });

  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onPop = () => setMonth(getMonthFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await loadPanelIdentity(sb);
        if (!active) return;
        if (String(me.role).toLowerCase() !== "tarotista") {
          window.location.replace(panelPathForRole(me.role));
          return;
        }
        setMonth(getMonthFromUrl());
        setOk(true);
      } catch (error) {
        if (!active) return;
        redirectToLogin(error instanceof Error ? error.message : "session");
      }
    })();
    return () => { active = false; };
  }, []);

  async function loadAttendanceMe(silent = false) {
    if (attLoading && !silent) return;
    if (!silent) {
      setAttLoading(true);
      setAttMsg("");
    }
    try {
      attendance.refreshAttendance();
      if (!silent) setAttMsg("");
    } catch (e: any) {
      if (!silent) setAttMsg(`❌ Estado: ${e?.message || "Error"}`);
      setAttOnline(false);
      setAttStatus("offline");
    } finally {
      if (!silent) setAttLoading(false);
    }
  }

  useEffect(() => {
    setAttOnline(attendance.online);
    setAttStatus(String(attendance.status || (attendance.online ? "working" : "offline")));
  }, [attendance.online, attendance.status]);

  async function postAttendanceEvent(event_type: "online" | "offline" | "heartbeat", metaExtra: any = {}) {
    try {
      setAttMsg("");
      setAttLoading(true);

      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/attendance/event", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type,
          meta: { path: window.location.pathname, ...metaExtra },
        }),
      });

      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        const err = String(j?.error || `HTTP ${j?._status}`);
        if (err === "OUTSIDE_SHIFT") setAttMsg("⛔ Estás fuera de tu turno. No puedes conectarte ahora.");
        else setAttMsg(`❌ ${err}`);
        await loadAttendanceMe(true);
        return;
      }

      if (event_type === "online") {
        await fetch("/api/attendance/event", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "heartbeat",
            meta: { path: window.location.pathname, immediate: true },
          }),
        }).catch(() => {});
      }

      await loadAttendanceMe(true);
      setAttMsg("✅ Listo");
      setTimeout(() => setAttMsg(""), 1000);
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setAttLoading(false);
    }
  }

  async function loadChecklist() {
    if (clLoading) return;
    setClLoading(true);
    setClMsg("");
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/checklists/my", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setClShiftKey("");
        setClRows([]);
        setClMsg(`❌ Checklist: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      setClShiftKey(String(j.shift_key || ""));
      setClRows(j.items || j.rows || []);
      setClMsg(`✅ Checklist cargado (${(j.items || j.rows || []).length} items)`);
    } catch (e: any) {
      setClShiftKey("");
      setClRows([]);
      setClMsg(`❌ Checklist: ${e?.message || "Error"}`);
    } finally {
      setClLoading(false);
    }
  }

  async function toggleChecklistItem(item: any) {
    const item_key = String(item?.item_key || item?.key || item?.id || "");
    if (!item_key) return;

    try {
      setClMsg("");
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/checklists/toggle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_key }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadChecklist();
    } catch (e: any) {
      setClMsg(`❌ No se pudo marcar: ${e?.message || "Error"}`);
    }
  }

  async function refresh(forMonth?: string) {
    try {
      setDataRefreshing(true);
      setMsg("");
      const token = await getTokenSafe();
      if (!token) return;

      const m = forMonth || month;
      setMonth(m);

      const sRes = await fetch(`/api/stats/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rRes = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const incRes = await fetch(`/api/incidents/my?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const invRes = await fetch(`/api/invoices/my?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const sJ = await safeJson(sRes);
      const rnkJ = await safeJson(rRes);
      const incJ = await safeJson(incRes);
      const invJ = await safeJson(invRes);

      setStats(sJ);
      setRank(rnkJ);

      const wid = sJ?.worker?.id ? String(sJ.worker.id) : "";
      if (wid) setMyWorkerId(wid);
      setTarotistaLevel(Number(sJ?.worker?.tarotista_level || 1) === 2 ? 2 : 1);

      if (incJ?._ok && incJ?.ok) setIncidents(incJ.incidents || []);
      else setIncidents([]);

      if (invJ?._ok && invJ?.ok) {
        setInvoice(invJ.invoice || null);
        setInvoiceLines(invJ.lines || []);
        setInvoiceInsights(invJ.insights || null);
      } else {
        setInvoice(null);
        setInvoiceLines([]);
        setInvoiceInsights(null);
      }

      if ((sJ && sJ.ok === false) || (rnkJ && rnkJ.ok === false))
        setMsg("⚠️ Hay un error cargando datos (mira consola / endpoint).");
      if (incJ && incJ.ok === false) setMsg((p) => `${p ? p + " · " : ""}⚠️ Incidencias: ${incJ.error || "error"}`);
      if (invJ && invJ.ok === false) setMsg((p) => `${p ? p + " · " : ""}⚠️ Factura: ${invJ.error || "error"}`);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setDataRefreshing(false);
    }
  }

  async function refreshRanking(forMonth?: string, silent = false) {
    if (!silent) setRankingRefreshing(true);
    try {
      const token = await getTokenSafe();
      if (!token) return;
      const m = forMonth || month;
      const res = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) {
        if (!silent) setMsg(`⚠️ Ranking: ${json?.error || `HTTP ${json?._status}`}`);
        return;
      }
      setRank(json);
    } catch (error: any) {
      if (!silent) setMsg(`⚠️ Ranking: ${error?.message || "Error al actualizar"}`);
    } finally {
      if (!silent) setRankingRefreshing(false);
    }
  }

  async function changeAttendanceStatus(action: "connected" | "break" | "bathroom" | "offline") {
    if (action === "offline") {
      await postAttendanceEvent("offline", { action: "check_out" });
      return;
    }
    if (action === "break") {
      await postAttendanceEvent("online", { action: "break", phase: "start" });
      return;
    }
    if (action === "bathroom") {
      await postAttendanceEvent("online", { action: "bathroom", phase: "start" });
      return;
    }
    if (attStatus === "break") {
      await postAttendanceEvent("online", { action: "break", phase: "end" });
      return;
    }
    if (attStatus === "bathroom") {
      await postAttendanceEvent("online", { action: "bathroom", phase: "end" });
      return;
    }
    await postAttendanceEvent("online", { action: "check_in" });
  }

  async function refreshInvoiceOnly() {
    try {
      setMsg("");
      const token = await getTokenSafe();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const [statsResponse, invoiceResponse, incidentsResponse] = await Promise.all([
        fetch(`/api/stats/monthly?month=${encodeURIComponent(month)}`, { headers }),
        fetch(`/api/invoices/my?month=${encodeURIComponent(month)}`, { headers }),
        fetch(`/api/incidents/my?month=${encodeURIComponent(month)}`, { headers }),
      ]);
      const [statsJson, invoiceJson, incidentsJson] = await Promise.all([safeJson(statsResponse), safeJson(invoiceResponse), safeJson(incidentsResponse)]);
      if (!statsJson?._ok || !statsJson?.ok) throw new Error(statsJson?.error || "No se pudieron actualizar las métricas");
      if (!invoiceJson?._ok || !invoiceJson?.ok) throw new Error(invoiceJson?.error || "No se pudo actualizar la factura");
      setStats(statsJson);
      setInvoice(invoiceJson.invoice || null);
      setInvoiceLines(invoiceJson.lines || []);
      setInvoiceInsights(invoiceJson.insights || null);
      if (incidentsJson?._ok && incidentsJson?.ok) setIncidents(incidentsJson.incidents || []);
    } catch (error: any) {
      setMsg(`⚠️ Factura: ${error?.message || "Error"}`);
    }
  }

  async function loadMyOutbound(silent = false) {
    if (obLoading && !silent) return;
    if (!silent) {
      setObLoading(true);
      setObMsg("");
    }

    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch(`/api/me/outbound?date=${encodeURIComponent(obDate)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setObBatch(j.batch || null);
      const items = (j.batch?.outbound_batch_items || [])
        .slice()
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
      setObItems(items);

      if (!silent) {
        setObMsg(j.batch ? `✅ Lista cargada (${items.length})` : "ℹ️ Hoy no has enviado lista.");
        setTimeout(() => setObMsg(""), 1200);
      }
    } catch (e: any) {
      if (!silent) setObMsg(`❌ ${e?.message || "Error"}`);
      setObBatch(null);
      setObItems([]);
    } finally {
      if (!silent) setObLoading(false);
    }
  }

  async function submitOutboundDraft() {
    if (obSending) return;
    setObSending(true);
    setObMsg("");
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const names = obDraft
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!names.length) {
        setObMsg("⚠️ Escribe al menos un nombre (1 por línea).");
        return;
      }

      const items = names.map((customer_name, idx) => ({ customer_name, position: idx + 1, priority: 0 }));

      const res = await fetch("/api/tarot/outbound/submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batch_date: obDate, items }),
      });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        if (j?.error === "BATCH_ALREADY_EXISTS") {
          setObMsg("⚠️ Ya enviaste lista hoy. Recargando…");
          await loadMyOutbound(true);
          return;
        }
        throw new Error(j?.error || `HTTP ${j?._status}`);
      }

      setObDraft("");
      setObMsg("✅ Lista enviada");
      await loadMyOutbound(true);
    } catch (e: any) {
      setObMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setObSending(false);
    }
  }

  async function loadMyChatThread(silent = false) {
    if (!silent) {
      setChatLoading(true);
      setChatMsg("");
    }
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/tarot/chat/thread", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setThread(null);
        setSelectedThreadId("");
        if (!silent) setChatMsg(`⚠️ Chat no disponible: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const t = j.thread || j.row || j.data || null;
      if (!t?.id) {
        setThread(null);
        setSelectedThreadId("");
        if (!silent) setChatMsg("ℹ️ Aún no tienes chat abierto. Pulsa “Abrir chat”.");
        return;
      }

      const normalized: ChatThread = {
        id: String(t.id),
        title: t.title != null ? String(t.title) : null,
        last_message_text: t.last_message_text != null ? String(t.last_message_text) : null,
        last_message_at: t.last_message_at != null ? String(t.last_message_at) : null,
      };

      setThread(normalized);
      setSelectedThreadId(String(t.id));
      if (!silent) setChatMsg("✅ Chat cargado");
      if (!silent) setTimeout(() => setChatMsg(""), 900);
    } catch (e: any) {
      setThread(null);
      setSelectedThreadId("");
      if (!silent) setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setChatLoading(false);
    }
  }

  async function openMyChat() {
    setChatMsg("");
    setChatLoading(true);
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/tarot/chat/open", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const t = j.thread || j.row || j.data || null;
      if (!t?.id) throw new Error("NO_THREAD");

      setThread({ id: String(t.id), title: t.title != null ? String(t.title) : null });
      setSelectedThreadId(String(t.id));
      setChatMsg("✅ Chat abierto");
      setTimeout(() => setChatMsg(""), 900);
    } catch (e: any) {
      setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setChatLoading(false);
    }
  }

  async function loadChatMessages(threadId: string, silent = false) {
    if (!threadId) return;
    if (!silent) {
      setChatLoading(true);
      setChatMsg("");
    }
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch(`/api/tarot/chat/messages?thread_id=${encodeURIComponent(threadId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const list: ChatMessage[] = (j.messages || j.rows || []).map((m: any) => ({
        id: String(m.id),
        thread_id: String(m.thread_id || threadId),
        sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
        sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
        text: m.text != null ? String(m.text) : m.body != null ? String(m.body) : "",
        created_at: m.created_at != null ? String(m.created_at) : null,
      }));

      list.sort((a, b) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return at - bt;
      });

      setMessages(list);
      if (!silent) setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) {
      setMessages([]);
      if (!silent) setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setChatLoading(false);
    }
  }

  async function sendChatMessage() {
    const text = msgText.trim();
    if (!text) return;

    const tid = selectedThreadId || thread?.id || "";
    if (!tid) return;

    const tmpId = `tmp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tmpId,
      thread_id: tid,
      text,
      created_at: new Date().toISOString(),
      sender_worker_id: "me",
      sender_display_name: "Yo",
    };
    setMessages((prev) => [...(prev || []), optimistic]);
    setMsgText("");
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const token = await getTokenSafe();
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch("/api/tarot/chat/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: tid, text }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const saved = j.message || j.item || null;
      if (saved?.id) {
        const normalized: ChatMessage = {
          id: String(saved.id),
          thread_id: String(saved.thread_id || tid),
          sender_worker_id: saved.sender_worker_id != null ? String(saved.sender_worker_id) : null,
          sender_display_name: saved.sender_display_name != null ? String(saved.sender_display_name) : null,
          text: saved.text != null ? String(saved.text) : saved.body != null ? String(saved.body) : text,
          created_at: saved.created_at != null ? String(saved.created_at) : new Date().toISOString(),
        };
        setMessages((prev) => (prev || []).map((m) => (m.id === tmpId ? normalized : m)));
      } else {
        loadChatMessages(tid, true);
      }
    } catch (e: any) {
      setMessages((prev) => (prev || []).filter((m) => m.id !== tmpId));
      alert(`Error: ${e?.message || "ERR"}`);
    }
  }

  useEffect(() => {
    if (!ok) return;

    if (chatChannelRef.current) {
      sb.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
    }

    const threadId = (selectedThreadId || thread?.id) ? String(selectedThreadId || thread?.id) : "";
    if (!threadId) return;

    const ch = sb
      .channel(`tarot-chat-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const m: any = payload.new;
          setMessages((prev) => {
            const exists = (prev || []).some((x: any) => String(x.id) === String(m.id));
            if (exists) return prev;

            const msg: ChatMessage = {
              id: String(m.id),
              thread_id: String(m.thread_id),
              sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
              sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
              text: m.text != null ? String(m.text) : m.body != null ? String(m.body) : "",
              created_at: m.created_at != null ? String(m.created_at) : null,
            };
            return [...(prev || []), msg];
          });

          setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      )
      .subscribe();

    chatChannelRef.current = ch;

    return () => {
      sb.removeChannel(ch);
      chatChannelRef.current = null;
    };
  }, [ok, thread?.id, selectedThreadId]);

  useEffect(() => {
    if (!ok) return;
    refresh();
    loadChecklist();
    loadAttendanceMe(true);
    loadMyOutbound(true);
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "checklist" || tab === "notificaciones") loadChecklist();
  }, [tab, ok]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "clientes" || tab === "notificaciones") loadMyOutbound(false);
  }, [tab, ok, obDate]);

  useEffect(() => {
    if (!ok || tab !== "rangos") return;
    void refresh(month);
    const onFocus = () => void refresh(month);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ok, tab, month]);

  useEffect(() => {
    if (!ok || tab !== "ranking") return;
    void refreshRanking(month, true);
    const onFocus = () => void refreshRanking(month, true);
    const intervalId = window.setInterval(() => void refreshRanking(month, true), 45_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [ok, tab, month]);

  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    loadMyChatThread(false);
  }, [ok, tab]);

  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    const tid = selectedThreadId || thread?.id || "";
    if (!tid) return;
    loadChatMessages(tid, false);
  }, [ok, tab, thread?.id, selectedThreadId]);

  useEffect(() => {
    if (!ok) return;

    if (obChannelRef.current) {
      sb.removeChannel(obChannelRef.current);
      obChannelRef.current = null;
    }

    const bid = obBatch?.id ? String(obBatch.id) : "";
    if (!bid) return;

    const ch = sb
      .channel(`tarot-outbound-${bid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outbound_batch_items", filter: `batch_id=eq.${bid}` },
        (payload) => {
          const updated: any = payload.new;
          setObItems((prev) =>
            (prev || []).map((it: any) => (String(it.id) === String(updated.id) ? { ...it, ...updated } : it))
          );
        }
      )
      .subscribe();

    obChannelRef.current = ch;

    return () => {
      sb.removeChannel(ch);
      obChannelRef.current = null;
    };
  }, [ok, obBatch?.id]);

  useEffect(() => {
    if (!ok) return;

    if (attBeatRef.current) {
      clearInterval(attBeatRef.current);
      attBeatRef.current = null;
    }

    if (!attOnline) return;

    let stopped = false;

    const start = async () => {
      const token = await getTokenSafe();
      if (!token) return;

      const ping = async () => {
        if (stopped) return;

        const token2 = await getTokenSafe();
        if (!token2) return;

        await fetch("/api/attendance/event", {
          method: "POST",
          headers: { Authorization: `Bearer ${token2}`, "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "heartbeat", meta: { path: window.location.pathname } }),
        }).catch(() => {});
      };

      await ping();
      attBeatRef.current = setInterval(ping, 30_000);
    };

    start();

    return () => {
      stopped = true;
      if (attBeatRef.current) clearInterval(attBeatRef.current);
      attBeatRef.current = null;
    };
  }, [ok, attOnline]);

  useEffect(() => {
    if (!ok || !myWorkerId) return;

    loadPendingCallPopup(myWorkerId);
    loadActiveCall(myWorkerId);

    if (popupChannelRef.current) {
      sb.removeChannel(popupChannelRef.current);
      popupChannelRef.current = null;
    }

    const ch = sb
      .channel(`crm-call-popup-${myWorkerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_call_popups",
          filter: `tarotista_worker_id=eq.${myWorkerId}`,
        },
        (payload) => {
          const row: any = payload.new;
          if (!row || row.visible === false) return;
          setIncomingPopup(row);
          setPopupOpen(true);
        }
      )
      .subscribe();

    popupChannelRef.current = ch;

    return () => {
      sb.removeChannel(ch);
      popupChannelRef.current = null;
    };
  }, [ok, myWorkerId]);

  async function loadActiveCall(workerId?: string) {
    const wid = String(workerId || myWorkerId || "").trim();
    if (!wid) return;

    try {
      const { data, error } = await sb
        .from("crm_call_popups")
        .select("*")
        .eq("tarotista_worker_id", wid)
        .eq("accepted", true)
        .eq("closed", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setActiveCall(data);
        setCloseManualOverride(false);
        setCloseFreeUsed(String(data?.minutos_free_pendientes ?? 0));
        setCloseNormalesUsed(String(data?.minutos_normales_pendientes ?? 0));
      } else {
        setActiveCall(null);
      }
    } catch (e) {
      console.error("ERROR CARGANDO LLAMADA ACTIVA CRM", e);
    }
  }

  useEffect(() => {
    if (!activeCall?.accepted_at) {
      setActiveCallElapsed(0);
      setCloseManualOverride(false);
      return;
    }

    const sync = () => {
      const started = new Date(String(activeCall.accepted_at)).getTime();
      if (!Number.isFinite(started)) {
        setActiveCallElapsed(0);
        return;
      }
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setActiveCallElapsed(elapsedSeconds);
      if (!closeManualOverride) {
        const elapsedMinutes = Math.ceil(elapsedSeconds / 60);
        const maxFree = Number(activeCall?.minutos_free_pendientes || 0) || 0;
        const maxNormal = Number(activeCall?.minutos_normales_pendientes || 0) || 0;
        const autoFree = Math.min(maxFree, elapsedMinutes);
        const remaining = Math.max(elapsedMinutes - autoFree, 0);
        const autoNormal = Math.min(maxNormal, remaining);
        setCloseFreeUsed(String(autoFree));
        setCloseNormalesUsed(String(autoNormal));
      }
    };

    sync();
    const id = window.setInterval(sync, 1000);
    return () => window.clearInterval(id);
  }, [activeCall?.id, activeCall?.accepted_at, activeCall?.minutos_free_pendientes, activeCall?.minutos_normales_pendientes, closeManualOverride]);

  async function acceptIncomingPopup() {
    const popupId = incomingPopup?.id;
    if (!popupId) return;

    try {
      setPopupBusy(true);
      setCloseMsg("");

      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/crm/call/accept", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ popup_id: popupId }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const popup = j.popup || incomingPopup;
      setPopupOpen(false);
      setIncomingPopup(null);
      setActiveCall(popup);
      setCloseManualOverride(false);
      setCloseFreeUsed(String(popup?.minutos_free_pendientes ?? 0));
      setCloseNormalesUsed(String(popup?.minutos_normales_pendientes ?? 0));
      setCloseMsg("✅ Llamada aceptada");
      setTimeout(() => setCloseMsg(""), 1200);
    } catch (e: any) {
      console.error("ERROR ACEPTANDO POPUP CRM", e);
      setCloseMsg(`❌ ${e?.message || "Error aceptando llamada"}`);
    } finally {
      setPopupBusy(false);
    }
  }

  async function closeActiveCall() {
    const popupId = activeCall?.id;
    if (!popupId) return;

    try {
      setCloseLoading(true);
      setCloseMsg("");

      const token = await getTokenSafe();
      if (!token) return;

      const consumidos_free =
        Number(String(closeFreeUsed).replace(",", ".")) || 0;
      const consumidos_normales =
        Number(String(closeNormalesUsed).replace(",", ".")) || 0;

      const res = await fetch("/api/crm/call/close", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          popup_id: popupId,
          consumidos_free,
          consumidos_normales,
        }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setActiveCall(null);
      setActiveCallElapsed(0);
      setCloseManualOverride(false);
      setCloseFreeUsed("0");
      setCloseNormalesUsed("0");
      setCloseMsg(
        `✅ Llamada cerrada · Devueltos ${Number(j?.restantes_free || 0)} free y ${Number(
          j?.restantes_normales || 0
        )} normales`
      );
    } catch (e: any) {
      setCloseMsg(`❌ ${e?.message || "Error cerrando llamada"}`);
    } finally {
      setCloseLoading(false);
    }
  }

  async function loadPendingCallPopup(workerId?: string) {
    const wid = String(workerId || myWorkerId || "").trim();
    if (!wid) return;

    try {
      const { data, error } = await sb
        .from("crm_call_popups")
        .select("*")
        .eq("tarotista_worker_id", wid)
        .eq("visible", true)
        .eq("accepted", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setIncomingPopup(data);
        setPopupOpen(true);
      }
    } catch (e) {
      console.error("ERROR CARGANDO POPUP CRM", e);
    }
  }

  async function closeIncomingPopup(markAccepted = false) {
    if (markAccepted) {
      await acceptIncomingPopup();
      return;
    }

    const popupId = incomingPopup?.id;
    if (!popupId) {
      setPopupOpen(false);
      setIncomingPopup(null);
      return;
    }

    try {
      setPopupBusy(true);

      const { error } = await sb
        .from("crm_call_popups")
        .update({ visible: false })
        .eq("id", popupId);

      if (error) throw error;

      setPopupOpen(false);
      setIncomingPopup(null);
    } catch (e) {
      console.error("ERROR CERRANDO POPUP CRM", e);
    } finally {
      setPopupBusy(false);
    }
  }

  async function respondInvoice(action: "accepted" | "rejected") {
    try {
      setMsg("");
      const token = await getTokenSafe();
      if (!token) return;

      const r = await fetch("/api/invoices/respond", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice?.id || "",
          month,
          status: action,
          workerNote: ackNote,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setMsg(action === "accepted" ? "✅ Factura aceptada" : "✅ Factura rechazada");
      await refresh();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

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

      {popupOpen && incomingPopup ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(8, 6, 16, 0.76)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="tc-card"
            style={{
              width: "100%",
              maxWidth: 560,
              border: "1px solid rgba(215,181,109,0.35)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}
          >
            <div className="tc-title" style={{ fontSize: 20 }}>
              📞 Llamada entrante
            </div>
            <div className="tc-hr" />

            <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.15 }}>
              {[incomingPopup?.nombre, incomingPopup?.apellido].filter(Boolean).join(" ") || "Cliente"}
            </div>

            <div className="tc-sub" style={{ marginTop: 12, fontSize: 16 }}>
              <b>{Number(incomingPopup?.minutos_free_pendientes || 0)}</b> minutos free · <b>{Number(incomingPopup?.minutos_normales_pendientes || 0)}</b> minutos cliente
            </div>

            <div className="tc-row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button className="tc-btn" onClick={() => closeIncomingPopup(false)} disabled={popupBusy}>
                {popupBusy ? "…" : "Cerrar"}
              </button>
              <button className="tc-btn tc-btn-ok" onClick={() => closeIncomingPopup(true)} disabled={popupBusy}>
                {popupBusy ? "…" : "Aceptar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeCall ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 900,
            width: "min(520px, calc(100vw - 32px))",
          }}
        >
          <div className="tc-card" style={{ border: "1px solid rgba(120,255,190,0.25)", boxShadow: "0 18px 48px rgba(0,0,0,0.38)" }}>
            <div className="tc-title" style={{ fontSize: 18 }}>☎️ Llamada en curso</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              {[activeCall?.nombre, activeCall?.apellido].filter(Boolean).join(" ") || "Cliente"}
            </div>
            <div className="tc-sub" style={{ marginTop: 8 }}>
              Tiempo tarificado desde que aceptaste la transferencia: <b>{formatDuration(activeCallElapsed)}</b>
            </div>

            <div className="tc-hr" />

            <div className="tc-grid-2">
              <div>
                <div className="tc-sub">Free enviados</div>
                <div style={{ fontWeight: 900, fontSize: 22, marginTop: 6 }}>
                  {Number(activeCall?.minutos_free_pendientes || 0)}
                </div>
              </div>
              <div>
                <div className="tc-sub">Normales enviados</div>
                <div style={{ fontWeight: 900, fontSize: 22, marginTop: 6 }}>
                  {Number(activeCall?.minutos_normales_pendientes || 0)}
                </div>
              </div>
            </div>

            <div className="tc-hr" />

            <div className="tc-grid-2">
              <div>
                <div className="tc-sub">Minutos free reales</div>
                <input
                  className="tc-input"
                  value={closeFreeUsed}
                  onChange={(e) => { setCloseManualOverride(true); setCloseFreeUsed(e.target.value); }}
                  placeholder="0"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
              <div>
                <div className="tc-sub">Minutos normales reales</div>
                <input
                  className="tc-input"
                  value={closeNormalesUsed}
                  onChange={(e) => { setCloseManualOverride(true); setCloseNormalesUsed(e.target.value); }}
                  placeholder="0"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
            </div>

            <div className="tc-sub" style={{ marginTop: 12 }}>
              Al cerrar, el sistema devolverá automáticamente a la ficha del cliente los minutos no consumidos.
            </div>

            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button
                className="tc-btn"
                onClick={() => {
                  setCloseManualOverride(false);
                  const elapsedMinutes = Math.ceil(activeCallElapsed / 60);
                  const maxFree = Number(activeCall?.minutos_free_pendientes || 0) || 0;
                  const maxNormal = Number(activeCall?.minutos_normales_pendientes || 0) || 0;
                  const autoFree = Math.min(maxFree, elapsedMinutes);
                  const remaining = Math.max(elapsedMinutes - autoFree, 0);
                  const autoNormal = Math.min(maxNormal, remaining);
                  setCloseFreeUsed(String(autoFree));
                  setCloseNormalesUsed(String(autoNormal));
                }}
                disabled={!activeCall}
              >
                Usar tiempo transcurrido
              </button>

              <div className="tc-row" style={{ justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <button className="tc-btn tc-btn-danger" onClick={closeActiveCall} disabled={closeLoading}>
                  {closeLoading ? "Cerrando..." : "Finalizar llamada"}
                </button>
              </div>
            </div>

            <div className="tc-sub" style={{ marginTop: 10 }}>{closeMsg || " "}</div>
          </div>
        </div>
      ) : null}

      {!ok ? (
        <div className={panelStyles.loadingShell} aria-label="Cargando panel">
          <div className={panelStyles.loadingPulse} />
        </div>
      ) : (
        <div className="tc-shell tc-shell-premium">
          <aside className="tc-sidebar">
            <div className="tc-sidebar-card">
              <div className="tc-sidebar-title">Panel tarotista</div>
              <div className="tc-sidebar-nav">
                {TAROTISTA_NAV.map((item) => {
                  const Icon = item.icon;
                  const badge = item.key === "chat"
                    ? chatUnread
                    : item.key === "notificaciones"
                      ? notificationsCount
                      : item.key === "checklist"
                        ? Math.max(0, clProgress.total - clProgress.completed)
                        : item.key === "facturas" ? incidents.length : 0;
                  return (
                    <button key={item.key} className={`tc-sidebtn ${tab === item.key ? "tc-sidebtn-active" : ""}`} onClick={() => setTab(item.key)}>
                      <div className={panelStyles.navMain}>
                        <span className={panelStyles.navIcon}><Icon size={17} /></span>
                        <div className={panelStyles.navCopy}>
                          <div className="tc-sidebtn-main">{item.label}</div>
                          <div className="tc-sidebtn-kicker">{item.kicker}</div>
                        </div>
                      </div>
                      {badge > 0 ? <span className={panelStyles.navBadge} data-tone={item.key === "checklist" ? "amber" : "red"}>{badge > 99 ? "99+" : badge}</span> : <span className="tc-sidebtn-dot" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="tc-main">
            <div className="tc-container">
              <TarotistaStatusHeader
                workerName={stats?.worker?.display_name || "Tarotista"}
                team={stats?.worker?.team}
                month={month}
                online={attOnline}
                status={attStatus}
                loading={attLoading || dataRefreshing}
                message={attMsg || msg}
                onMonthChange={(value) => {
                  const nextMonth = value || monthKeyNow();
                  setMonth(nextMonth);
                  setMonthInUrl(nextMonth);
                  void refresh(nextMonth);
                }}
                onRefresh={() => void refresh()}
                onStatusChange={(action) => void changeAttendanceStatus(action)}
              />

            {tab === "chat" && <StaffDirectChatPanel />}
            {false && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">💬 Chat con Central</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Mensajes en tiempo real {chatMsg ? `· ${chatMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={() => loadMyChatThread(false)} disabled={chatLoading}>
                      {chatLoading ? "Cargando…" : "Recargar"}
                    </button>
                    {!thread?.id ? (
                      <button className="tc-btn tc-btn-ok" onClick={openMyChat} disabled={chatLoading}>
                        🟢 Abrir chat
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="tc-hr" />

                {!thread?.id ? (
                  <div className="tc-sub">
                    Aún no tienes chat abierto. Pulsa <b>“Abrir chat”</b>.
                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      (Si ya tienes endpoints con otro nombre, cambia estas rutas: <b>/api/tarot/chat/thread</b>,{" "}
                      <b>/api/tarot/chat/open</b>, <b>/api/tarot/chat/messages</b>, <b>/api/tarot/chat/send</b>)
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.03)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 520,
                    }}
                  >
                    <div style={{ padding: 12 }}>
                      <div style={{ fontWeight: 900 }}>{thread?.title || "Chat con Central"}</div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Thread: {selectedThreadId || thread?.id}
                      </div>
                    </div>

                    <div className="tc-hr" style={{ margin: 0 }} />

                    <div style={{ padding: 12, overflow: "auto", flex: 1, display: "grid", gap: 10 }}>
                      {(messages || []).map((m) => {
                        const who = m.sender_display_name || m.sender_worker_id || "—";
                        const when = m.created_at ? new Date(m.created_at).toLocaleString("es-ES") : "";
                        return (
                          <div
                            key={m.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 10,
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 900 }}>{who}</div>
                              <div className="tc-sub">{when}</div>
                            </div>
                            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{m.text || ""}</div>
                          </div>
                        );
                      })}
                      {(!messages || messages.length === 0) && <div className="tc-sub">No hay mensajes todavía.</div>}
                      <div ref={msgEndRef} />
                    </div>

                    <div className="tc-hr" style={{ margin: 0 }} />

                    <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        className="tc-input"
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        placeholder="Escribe un mensaje…"
                        style={{ flex: 1, minWidth: 240 }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendChatMessage();
                          }
                        }}
                      />
                      <button className="tc-btn tc-btn-gold" onClick={sendChatMessage} disabled={!msgText.trim()}>
                        Enviar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "resumen" && (
              <div className={panelStyles.summaryPage}>
                <section className={panelStyles.summaryHero}>
                  <div className={panelStyles.summaryHeroGlow} aria-hidden="true" />
                  <div className={panelStyles.summaryHeroCopy}>
                    <div className={panelStyles.summaryEyebrow}>
                      <span className={panelStyles.summaryHeroIcon}><Sparkles size={17} /></span>
                      Centro operativo · tarotista
                    </div>
                    <h2>Hola, {String(stats?.worker?.display_name || "Tarotista").trim().split(/\s+/)[0] || "Tarotista"}</h2>
                    <h3>Tu centro de control</h3>
                    <p>Todo lo importante de tu turno, en un solo lugar.</p>
                  </div>
                  <div className={panelStyles.summaryPeriod}>
                    <CalendarDays size={17} />
                    <div>
                      <small>Periodo seleccionado</small>
                      <strong>{formatMonthLabel(month)}</strong>
                    </div>
                  </div>
                </section>

                <section className={panelStyles.summaryKpis} aria-label="Indicadores esenciales del turno">
                  <article className={panelStyles.summaryKpi} data-tone={!attOnline ? "red" : (attStatus === "break" || attStatus === "bathroom") ? "blue" : "green"}>
                    <div className={panelStyles.summaryKpiTop}>
                      <span className={panelStyles.summaryKpiIcon}><Radio size={20} /></span>
                      <span className={panelStyles.summaryKpiLabel}>Estado</span>
                    </div>
                    <strong>{attendanceStatusLabel(attStatus, attOnline)}</strong>
                    <small>{attOnline ? "Estado real del turno" : "Conéctate cuando empieces"}</small>
                    {!attOnline ? (
                      <button className={panelStyles.summaryKpiAction} type="button" onClick={() => void changeAttendanceStatus("connected")}>Conectarme</button>
                    ) : null}
                  </article>

                  <article className={panelStyles.summaryKpi} data-tone="blue">
                    <div className={panelStyles.summaryKpiTop}>
                      <span className={panelStyles.summaryKpiIcon}><PhoneCall size={20} /></span>
                      <span className={panelStyles.summaryKpiLabel}>Llamadas</span>
                    </div>
                    <strong>{Number(s?.calls_total || 0)}</strong>
                    <small>Total real del mes registrado</small>
                  </article>

                  <article className={panelStyles.summaryKpi} data-tone="violet">
                    <div className={panelStyles.summaryKpiTop}>
                      <span className={panelStyles.summaryKpiIcon}><Clock3 size={20} /></span>
                      <span className={panelStyles.summaryKpiLabel}>Minutos</span>
                    </div>
                    <strong>{n2(s?.minutes_total || 0)}</strong>
                    <small>Minutos acumulados del periodo</small>
                  </article>

                  <article className={panelStyles.summaryKpi} data-tone="teal">
                    <div className={panelStyles.summaryKpiTop}>
                      <span className={panelStyles.summaryKpiIcon}><UserRound size={20} /></span>
                      <span className={panelStyles.summaryKpiLabel}>Captadas</span>
                    </div>
                    <strong>{captadas}</strong>
                    <small>{tier.label}</small>
                  </article>
                </section>

                <div className={panelStyles.summaryWorkspace}>
                  <div className={panelStyles.coreBoard}>
                    <OperationalInbox
                      mode="tarotista"
                      compact
                      showSections={false}
                      externalChatUnread={chatUnread}
                      onAction={(action) => {
                        if (action === "chat") setTab("chat");
                        if (action === "calls") setTab("clientes");
                        if (action === "incidents") setTab("notificaciones");
                        if (action === "attendance") void changeAttendanceStatus("connected");
                      }}
                    />
                  </div>

                  <aside className={panelStyles.summaryRail} aria-label="Resumen operativo">
                    <section className={panelStyles.focusCard}>
                      <div className={panelStyles.heroKicker}>Radar operativo</div>
                      <h3>Lo siguiente que debes mirar</h3>
                      <p className={panelStyles.focusIntro}>Solo lo que requiere tu atención ahora.</p>
                      <div className={panelStyles.focusList}>
                        {summaryFocus.map((item) => (
                          <button key={item.id} type="button" className={panelStyles.focusItem} data-tone={item.tone} onClick={() => setTab(item.actionTab)}>
                            <div>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                            <small>{item.hint}</small>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className={panelStyles.railCard}>
                      <div className={panelStyles.railKicker}>Rendimiento real · {month}</div>
                      <h3>Tu mes, de un vistazo</h3>
                      <p>Todo resumido para entenderlo sin esfuerzo.</p>
                      <div className={panelStyles.statGrid}>
                        <div className={panelStyles.stat}><span>Llamadas</span><strong>{Number(s?.calls_total || 0)}</strong></div>
                        <div className={panelStyles.stat}><span>Minutos</span><strong>{n2(s?.minutes_total || 0)}</strong></div>
                        <div className={panelStyles.stat}><span>Captadas</span><strong>{captadas}</strong></div>
                        <div className={panelStyles.stat}><span>Rango</span><strong>{myPublicRange}</strong></div>
                      </div>
                      <div className={panelStyles.progressRow}>
                        <div className={panelStyles.progressMeta}><span>Cliente</span><strong>{pct(s?.pct_cliente || 0)}</strong></div>
                        <div className={panelStyles.track}><span style={{ width: `${clampPct(Number(s?.pct_cliente || 0))}%` }} /></div>
                      </div>
                      <div className={panelStyles.progressRow}>
                        <div className={panelStyles.progressMeta}><span>Repite</span><strong>{pct(s?.pct_repite || 0)}</strong></div>
                        <div className={panelStyles.track}><span style={{ width: `${clampPct(Number(s?.pct_repite || 0))}%` }} /></div>
                      </div>
                      <button className={panelStyles.railButton} type="button" onClick={() => setTab("ranking")}>Ver estadísticas completas</button>
                    </section>
                  </aside>
                </div>
              </div>
            )}

            {tab === "notificaciones" && (
              <div className={panelStyles.notificationsPage}>
                <section className={panelStyles.notificationsHero}>
                  <div className={panelStyles.notificationsHeroGlow} aria-hidden="true" />
                  <div className={panelStyles.notificationsHeroCopy}>
                    <div className={panelStyles.notificationsEyebrow}>
                      <span className={panelStyles.notificationsHeroIcon}><BellRing size={17} /></span>
                      Centro de avisos
                    </div>
                    <h2>Notificaciones y recordatorios</h2>
                    <p>Todo lo importante del turno reunido en un solo lugar, fácil de entender y priorizar.</p>
                  </div>

                  <div className={panelStyles.notificationStats}>
                    <div className={panelStyles.notificationStat} data-tone="violet">
                      <span className={panelStyles.notificationStatIcon}><BellRing size={16} /></span>
                      <div><small>Total</small><strong>{notificationsCount}</strong></div>
                    </div>
                    <div className={panelStyles.notificationStat} data-tone="red">
                      <span className={panelStyles.notificationStatIcon}><AlertTriangle size={16} /></span>
                      <div><small>Prioridad</small><strong>{urgentNotificationsCount}</strong></div>
                    </div>
                    <div className={panelStyles.notificationStat} data-tone="blue">
                      <span className={panelStyles.notificationStatIcon}><UsersRound size={16} /></span>
                      <div><small>Clientes</small><strong>{outboundPending}</strong></div>
                    </div>
                  </div>
                </section>

                <div className={panelStyles.notificationsGrid}>
                  <section className={panelStyles.notificationsMain}>
                    <article className={panelStyles.turnStatusCard} data-tone={attOnline ? "green" : "gold"}>
                      <div className={panelStyles.turnStatusIcon}><Radio size={25} /></div>
                      <div className={panelStyles.turnStatusCopy}>
                        <div className={panelStyles.turnStatusTopline}>
                          <span>Estado del turno</span>
                          <strong><i /> {attOnline ? "Operativa activa" : "Acción recomendada"}</strong>
                        </div>
                        <h3>{attOnline ? "Estás lista para recibir actividad" : "Conéctate para recibir actividad"}</h3>
                        <p>Estado actual: <b>{attendanceStatusLabel(attStatus, attOnline)}</b></p>
                      </div>
                      <button type="button" className={panelStyles.turnStatusAction} onClick={() => setTab("resumen")}>
                        Ver resumen <ArrowRight size={15} />
                      </button>
                    </article>

                    <div className={panelStyles.notificationsSectionHead}>
                      <div>
                        <span>Actividad importante</span>
                        <h3>{notificationMainItems.length ? "Tus avisos del turno" : "Todo bajo control"}</h3>
                      </div>
                      <strong>{notificationMainItems.length} pendiente{notificationMainItems.length === 1 ? "" : "s"}</strong>
                    </div>

                    {notificationMainItems.length ? (
                      <div className={panelStyles.notificationsList}>
                        {notificationMainItems.map((item) => {
                          const isChecklist = item.id === "checklist";
                          const isIncident = item.id.startsWith("incident-");
                          return (
                            <article key={item.id} className={panelStyles.notificationCard} data-tone={item.tone}>
                              <div className={panelStyles.notificationCardAccent} aria-hidden="true" />
                              <div className={panelStyles.notificationCardIcon}><NotificationGlyph id={item.id} /></div>
                              <div className={panelStyles.notificationCardBody}>
                                <div className={panelStyles.notificationMeta}>
                                  <span>{item.section}</span>
                                  {item.meta ? <strong>{item.meta}</strong> : null}
                                </div>
                                <h3>{item.title}</h3>
                                <p>{item.detail}</p>
                                {isChecklist ? (
                                  <div className={panelStyles.notificationProgress}>
                                    <div><span>Progreso del turno</span><strong>{clProgress.completed}/{clProgress.total}</strong></div>
                                    <div className={panelStyles.notificationProgressTrack}><i style={{ width: `${clProgress.pct}%` }} /></div>
                                  </div>
                                ) : null}
                                {isIncident ? (
                                  <div className={panelStyles.notificationSignal}><AlertTriangle size={14} /> Revisión recomendada</div>
                                ) : null}
                              </div>
                              <button type="button" className={panelStyles.notificationAction} onClick={() => setTab(item.actionTab)}>
                                {item.actionLabel} <ArrowRight size={15} />
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={panelStyles.notificationsEmpty}>
                        <span><CheckCircle2 size={30} /></span>
                        <div>
                          <strong>Todo bajo control</strong>
                          <p>No tienes avisos pendientes. Puedes continuar con tu turno con tranquilidad.</p>
                        </div>
                      </div>
                    )}
                  </section>

                  <aside className={panelStyles.notificationsAside}>
                    <section className={panelStyles.missionCard}>
                      <div className={panelStyles.sideCardHeading}>
                        <span className={panelStyles.sideCardIcon} data-tone="gold"><Sparkles size={18} /></span>
                        <div><small>Cómo usar este panel</small><h3>Orden recomendado</h3></div>
                      </div>
                      <div className={panelStyles.missionPath}>
                        <button type="button" onClick={() => setTab("notificaciones")} className={panelStyles.missionStep} data-state="current">
                          <span>1</span><div><strong>Revisar avisos</strong><small>Ahora</small></div>
                        </button>
                        <button type="button" onClick={() => setTab("clientes")} className={panelStyles.missionStep}>
                          <span>2</span><div><strong>Seguir clientes</strong><small>Después</small></div>
                        </button>
                        <button type="button" onClick={() => setTab("checklist")} className={panelStyles.missionStep}>
                          <span>3</span><div><strong>Completar checklist</strong><small>Antes de cerrar</small></div>
                        </button>
                      </div>
                    </section>

                    <section className={panelStyles.quickActionsCard}>
                      <div className={panelStyles.sideCardHeading}>
                        <span className={panelStyles.sideCardIcon} data-tone="violet"><Sparkles size={18} /></span>
                        <div><small>Acciones rápidas</small><h3>Accesos directos</h3></div>
                      </div>
                      <div className={panelStyles.quickActionGrid}>
                        <button type="button" onClick={() => setTab("clientes")} className={panelStyles.quickAction}>
                          <span data-tone="violet"><UsersRound size={18} /></span>
                          <div><strong>Clientes</strong><small>Gestionar seguimientos</small></div>
                          <ArrowRight size={15} />
                        </button>
                        <button type="button" onClick={() => setTab("chat")} className={panelStyles.quickAction}>
                          <span data-tone="blue"><MessageSquare size={18} /></span>
                          <div><strong>Chat</strong><small>Central en directo</small></div>
                          <ArrowRight size={15} />
                        </button>
                        <button type="button" onClick={() => setTab("checklist")} className={panelStyles.quickAction}>
                          <span data-tone="gold"><ClipboardCheck size={18} /></span>
                          <div><strong>Checklist</strong><small>{clProgress.total ? `${clProgress.completed}/${clProgress.total} completadas` : "Sin tareas"}</small></div>
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </section>

                    <section className={panelStyles.shiftPulseCard}>
                      <div className={panelStyles.shiftPulseTop}>
                        <span><Clock3 size={17} /> Turno actual</span>
                        <strong>{pendingChecklist ? `${pendingChecklist} tareas` : "En orden"}</strong>
                      </div>
                      <div className={panelStyles.shiftPulseTrack}><i style={{ width: `${clProgress.pct}%` }} /></div>
                      <p>{clProgress.total ? `${clProgress.completed} de ${clProgress.total} tareas completadas.` : "No hay tareas de checklist asignadas."}</p>
                    </section>
                  </aside>
                </div>
              </div>
            )}

            {tab === "clientes" && (
              <div className={panelStyles.clientsHub}>
                <section className={panelStyles.clientsHero}>
                  <div className={panelStyles.clientsHeroCopy}>
                    <span className={panelStyles.clientsHeroIcon}><UsersRound size={24} /></span>
                    <div>
                      <small>Centro operativo · seguimiento diario</small>
                      <h2>Clientes · Centro de seguimiento</h2>
                      <p>Organiza, envía y controla las clientas de tu jornada desde una única vista.</p>
                    </div>
                  </div>

                  <div className={panelStyles.clientsHeroControls}>
                    <label className={panelStyles.clientsDateControl}>
                      <span><CalendarDays size={15} /> Día de trabajo</span>
                      <input type="date" value={obDate} onChange={(e) => setObDate(e.target.value)} />
                    </label>
                    <button type="button" className={panelStyles.clientsRefreshButton} onClick={() => loadMyOutbound(false)} disabled={obLoading}>
                      <RefreshCw size={16} className={obLoading ? panelStyles.spin : ""} />
                      {obLoading ? "Actualizando" : "Actualizar"}
                    </button>
                    {obBatch?.id ? (
                      <div className={panelStyles.clientsSyncBadge} title="Los cambios de Central se reciben mediante Supabase Realtime">
                        <Radio size={14} />
                        <div><strong>Sincronizado</strong><small>Actualización en vivo</small></div>
                      </div>
                    ) : null}
                  </div>
                </section>

                {obMsg ? <div className={panelStyles.clientsMessage}>{obMsg}</div> : null}

                <section className={panelStyles.clientsKpis} aria-label="Resumen de seguimiento">
                  <article className={panelStyles.clientsKpi} data-tone="violet">
                    <span><UsersRound size={20} /></span>
                    <div><small>Clientas del día</small><strong>{outboundDashboard.total}</strong><p>{formatOutboundDate(obDate)}</p></div>
                  </article>
                  <article className={panelStyles.clientsKpi} data-tone="gold">
                    <span><Clock3 size={20} /></span>
                    <div><small>Pendientes</small><strong>{outboundDashboard.pending}</strong><p>Requieren seguimiento</p></div>
                  </article>
                  <article className={panelStyles.clientsKpi} data-tone="blue">
                    <span><Activity size={20} /></span>
                    <div><small>En curso</small><strong>{outboundDashboard.inProgress}</strong><p>Gestión activa</p></div>
                  </article>
                  <article className={panelStyles.clientsKpi} data-tone="green">
                    <span><CheckCircle2 size={20} /></span>
                    <div><small>Completadas</small><strong>{outboundDashboard.completed}</strong><p>Marcadas como Done</p></div>
                  </article>
                </section>

                <section className={panelStyles.clientsProgressCard}>
                  <div className={panelStyles.clientsProgressTop}>
                    <div>
                      <small>Progreso del día</small>
                      <h3>{outboundDashboard.completed} de {outboundDashboard.total} clientas completadas</h3>
                    </div>
                    <strong>{outboundDashboard.progress}%</strong>
                  </div>
                  <div className={panelStyles.clientsProgressTrack} aria-label={`${outboundDashboard.progress}% completado`}>
                    <span style={{ width: `${outboundDashboard.progress}%` }} />
                  </div>
                  <p>{outboundDashboard.total ? `${Math.max(0, outboundDashboard.total - outboundDashboard.completed)} clientas siguen abiertas en la jornada.` : "Cuando envíes una lista, aquí verás el avance real del día."}</p>
                </section>

                <div className={panelStyles.clientsWorkspace}>
                  <main className={panelStyles.clientsMainColumn}>
                    <section className={panelStyles.clientsListCard}>
                      <header className={panelStyles.clientsSectionHeader}>
                        <div>
                          <small>Seguimiento operativo</small>
                          <h3>Clientas de hoy</h3>
                          <p>{obBatch?.note ? `Nota del envío: ${obBatch.note}` : "Estados y apuntes actualizados por Central."}</p>
                        </div>
                        <span className={panelStyles.clientsCountChip}>{outboundDashboard.total} total</span>
                      </header>

                      <div className={panelStyles.clientsToolbar}>
                        <label className={panelStyles.clientsSearch}>
                          <Search size={17} />
                          <input
                            value={obSearch}
                            onChange={(e) => setObSearch(e.target.value)}
                            placeholder="Buscar por nombre, teléfono, estado o apunte..."
                            aria-label="Buscar clientas"
                          />
                        </label>
                        <div className={panelStyles.clientsFilters} aria-label="Filtrar clientas">
                          {([
                            ["all", "Todas"],
                            ["pending", "Pendientes"],
                            ["progress", "En curso"],
                            ["done", "Completadas"],
                          ] as Array<[OutboundFilter, string]>).map(([key, label]) => (
                            <button
                              type="button"
                              key={key}
                              className={obFilter === key ? panelStyles.clientsFilterActive : ""}
                              onClick={() => setObFilter(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {obLoading && !obBatch ? (
                        <div className={panelStyles.clientsSkeletonList} aria-label="Cargando clientas">
                          {[0, 1, 2].map((item) => <span key={item} />)}
                        </div>
                      ) : !obBatch ? (
                        <div className={panelStyles.clientsEmptyState}>
                          <span><UsersRound size={30} /></span>
                          <div><strong>No hay clientas asignadas este día</strong><p>Cuando envíes una nueva lista aparecerá aquí y sus cambios se actualizarán automáticamente.</p></div>
                        </div>
                      ) : outboundVisibleItems.length === 0 ? (
                        <div className={panelStyles.clientsEmptyState}>
                          <span><Search size={28} /></span>
                          <div><strong>No hay resultados con este filtro</strong><p>Cambia el filtro o la búsqueda para volver a ver la lista.</p></div>
                        </div>
                      ) : (
                        <div className={panelStyles.clientsCards}>
                          {outboundVisibleItems.map((it: any) => {
                            const info = outboundStatusInfo(it.current_status);
                            const StatusIcon = info.Icon;
                            const eventTime = it.last_call_at || obBatch?.created_at || null;
                            return (
                              <article key={it.id} className={panelStyles.clientCard} data-tone={info.tone}>
                                <div className={panelStyles.clientStatusRail} />
                                <div className={panelStyles.clientAvatar} data-tone={info.tone}>{clientInitials(it.customer_name)}</div>
                                <div className={panelStyles.clientCardBody}>
                                  <div className={panelStyles.clientCardTop}>
                                    <div>
                                      <h4>{it.customer_name || "Clienta sin nombre"}</h4>
                                      {it.phone ? <span className={panelStyles.clientPhone}>📱 {it.phone}</span> : <span className={panelStyles.clientMuted}>Sin teléfono registrado</span>}
                                    </div>
                                    <span className={panelStyles.clientStatus} data-tone={info.tone}><StatusIcon size={14} /> {info.label}</span>
                                  </div>

                                  <div className={panelStyles.clientMetaRow}>
                                    {eventTime ? <span><Clock3 size={13} /> {formatOutboundTime(eventTime)} {relativeOutboundTime(eventTime) ? `· ${relativeOutboundTime(eventTime)}` : ""}</span> : null}
                                    {it.last_called_by?.display_name ? <span><UserRound size={13} /> {it.last_called_by.display_name}</span> : null}
                                  </div>

                                  {it.last_note ? (
                                    <div className={panelStyles.clientNote}><MessageSquare size={15} /><div><small>Apunte de Central</small><p>{it.last_note}</p></div></div>
                                  ) : (
                                    <div className={panelStyles.clientNoteMuted}><MessageSquare size={14} /> Aún sin apunte de Central.</div>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </main>

                  <aside className={panelStyles.clientsSideColumn}>
                    <section className={panelStyles.clientsAddCard}>
                      <div className={panelStyles.clientsSideHeading}>
                        <span data-tone="violet"><Send size={18} /></span>
                        <div><small>Herramienta secundaria</small><h3>Añadir clientas</h3></div>
                      </div>

                      {!obBatch ? (
                        <>
                          <p>Escribe una lista de nombres, uno por línea, para enviarla al seguimiento de <strong>{formatOutboundDate(obDate)}</strong>.</p>
                          <textarea
                            value={obDraft}
                            onChange={(e) => setObDraft(e.target.value)}
                            placeholder={"Ana Pérez\nLuis Gómez\nMaría Sánchez"}
                            aria-label="Lista de clientas"
                          />
                          <button type="button" className={panelStyles.clientsSendButton} onClick={submitOutboundDraft} disabled={obSending}>
                            <Send size={16} /> {obSending ? "Enviando…" : "Enviar lista"}
                          </button>
                        </>
                      ) : (
                        <div className={panelStyles.clientsListSent}>
                          <span><CheckCircle2 size={22} /></span>
                          <div><strong>Lista del día enviada</strong><p>La lista ya está activa. Para conservar el flujo actual, el envío queda bloqueado una vez creada.</p></div>
                          <small>Estado: {String(obBatch.status || "submitted")}</small>
                        </div>
                      )}
                    </section>

                    <section className={panelStyles.clientsActivityCard}>
                      <div className={panelStyles.clientsSideHeading}>
                        <span data-tone="blue"><Activity size={18} /></span>
                        <div><small>Últimos cambios reales</small><h3>Actividad reciente</h3></div>
                      </div>

                      {outboundRecentActivity.length ? (
                        <div className={panelStyles.clientsTimeline}>
                          {outboundRecentActivity.map((it: any) => {
                            const info = outboundStatusInfo(it.current_status);
                            const StatusIcon = info.Icon;
                            return (
                              <div key={`activity-${it.id}`} className={panelStyles.clientsTimelineItem} data-tone={info.tone}>
                                <span><StatusIcon size={13} /></span>
                                <div>
                                  <strong>{it.customer_name || "Clienta"}</strong>
                                  <p>{info.label}{it.last_note ? ` · ${it.last_note}` : ""}</p>
                                  <small>{formatOutboundTime(it.last_call_at)} · {relativeOutboundTime(it.last_call_at)}</small>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={panelStyles.clientsActivityEmpty}>Aún no hay actividad registrada por Central para este día.</div>
                      )}
                    </section>

                    <div className={panelStyles.clientsAmbientLine}>Conecta · acompaña · haz seguimiento</div>
                  </aside>
                </div>
              </div>
            )}

            {tab === "bonos" && <TarotistaBonuses month={month} />}

            {tab === "rangos" && (
              <TarotistaRanksPanel
                stats={s}
                month={month}
                onOpenRanking={() => setTab("ranking")}
              />
            )}

            {tab === "ranking" && (
              <TarotistaRankingArena
                data={rank}
                month={month}
                myWorkerId={myWorkerId}
                refreshing={rankingRefreshing}
                onRefresh={() => void refreshRanking(month)}
              />
            )}

            {tab === "equipos" && <TeamCompetitionArena month={month} mode="tarotista" />}

            {tab === "checklist" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">✅ Checklist del turno</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Turno: <b>{clShiftKey || "—"}</b> · Completadas: <b>{clProgress.completed}/{clProgress.total}</b>
                      {clMsg ? ` · ${clMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={loadChecklist} disabled={clLoading}>
                      {clLoading ? "Cargando…" : "Actualizar checklist"}
                    </button>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <input
                      className="tc-input"
                      value={clQ}
                      onChange={(e) => setClQ(e.target.value)}
                      placeholder="Buscar en checklist…"
                      style={{ width: 320, maxWidth: "100%" }}
                    />

                    <div style={{ minWidth: 240, flex: 1 }}>
                      <div
                        style={{
                          height: 12,
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.10)",
                          overflow: "hidden",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${clampPct(clProgress.pct)}%`,
                            background: "linear-gradient(90deg, rgba(181,156,255,0.95), rgba(215,181,109,0.95))",
                          }}
                        />
                      </div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Progreso: <b>{clProgress.pct}%</b>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
                    {(clFiltered || []).map((it: any) => {
                      const title = String(it.title || it.label || it.item_key || "Checklist item");
                      const done = !!it.done || it.status === "completed" || it.completed === true;
                      const desc = String(it.description || it.desc || "");
                      const doneAt = it.completed_at || it.done_at || it.updated_at || null;

                      return (
                        <div
                          key={String(it.item_key || it.key || it.id || title)}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: done ? "rgba(120,255,190,0.10)" : "rgba(255,255,255,0.03)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 240 }}>
                              <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ opacity: done ? 1 : 0.9 }}>{done ? "✅" : "⬜"}</span>
                                <span>{title}</span>
                              </div>
                              {desc ? <div className="tc-sub" style={{ marginTop: 6 }}>{desc}</div> : null}
                              {done && doneAt ? (
                                <div className="tc-sub" style={{ marginTop: 6, opacity: 0.85 }}>
                                  Completado: <b>{new Date(doneAt).toLocaleString("es-ES")}</b>
                                </div>
                              ) : null}
                            </div>

                            <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                                {done ? "Completado" : "Pendiente"}
                              </span>

                              <button
                                className="tc-btn tc-btn-purple"
                                onClick={() => toggleChecklistItem(it)}
                                disabled={clLoading}
                                style={{ minWidth: 160 }}
                              >
                                {done ? "Marcar como pendiente" : "Marcar como hecho"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {(!clFiltered || clFiltered.length === 0) && (
                      <div className="tc-sub">No hay items en tu checklist (o no coinciden con la búsqueda).</div>
                    )}
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-sub">
                    Nota: el checklist se reinicia automáticamente con el <b>turno</b> (shift_key). Si cambia el turno, recarga.
                  </div>
                </div>
              </div>
            )}

            {tab === "facturas" && (
              <TarotistaInvoiceDashboard
                month={month}
                invoice={invoice}
                lines={invoiceLines}
                insights={invoiceInsights}
                liveStats={s}
                incidents={incidents}
                canSeeMoney={canSeeMoney}
                ackNote={ackNote}
                onAckNoteChange={setAckNote}
                onRespond={respondInvoice}
                onReload={refreshInvoiceOnly}
              />
            )}

            {false && tab === "facturas" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="tc-title">🧾 Mi factura</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Aquí está la factura oficial (líneas por códigos + bonos + incidencias).
                    </div>
                  </div>
                  <button className="tc-btn tc-btn-gold" onClick={() => refresh()}>
                    Recargar
                  </button>
                </div>

                <div className="tc-hr" />

                {!invoice ? (
                  <div className="tc-sub">Aún no hay factura generada para este mes. (La genera Admin)</div>
                ) : (
                  <>
                    <div className="tc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div className="tc-sub">
                          Estado: <b>{getInvoiceVisibleStatus(invoice)}</b> · Aceptación: <b>{invoice.worker_ack || "pending"}</b>
                        </div>
                        <div style={{ fontWeight: 900, fontSize: 22, marginTop: 6 }}>{money(invoice.total || 0)}</div>
                        {invoice.worker_ack_note ? (
                          <div className="tc-sub" style={{ marginTop: 6 }}>
                            Nota enviada: <b>{invoice.worker_ack_note}</b>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ minWidth: 320, maxWidth: "100%" }}>
                        <div className="tc-sub">Nota (opcional, sobre todo si rechazas)</div>
                        <input
                          className="tc-input"
                          value={ackNote}
                          onChange={(e) => setAckNote(e.target.value)}
                          placeholder="Ej: Falta revisar una incidencia…"
                          style={{ width: "100%", marginTop: 6 }}
                        />

                        <div className="tc-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                          <button className="tc-btn tc-btn-ok" onClick={() => respondInvoice("accepted")}>
                            Aceptar
                          </button>
                          <button className="tc-btn tc-btn-danger" onClick={() => respondInvoice("rejected")}>
                            Rechazar
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="tc-hr" />

                    <div className="tc-title" style={{ fontSize: 14 }}>
                      📌 Líneas
                    </div>

                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="tc-table">
                        <thead>
                          <tr>
                            <th>Concepto</th>
                            <th>Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invoiceLines || []).map((l: any) => {
                            const meta = l?.meta || {};
                            const hasBreakdown = meta && meta.minutes != null && meta.rate != null;
                            const minutes = Number(meta.minutes || 0);
                            const rate = Number(meta.rate || 0);
                            const calc = minutes * rate;
                            const bonusDetail = meta.bonus_mode === "units"
                              ? `${Number(meta.quantity || 0)} × ${canSeeMoney ? eur(meta.unit_rate || 0) : "unidad"}`
                              : String(meta.description || "");

                            return (
                              <tr key={l.id}>
                                <td>
                                  <b>{l.label}</b>
                                  {hasBreakdown ? (
                                    <div className="tc-sub" style={{ marginTop: 6 }}>
                                      {String(meta.code || "").toUpperCase()} · {minutes} min
{canSeeMoney ? <> × {eur(rate)} = <b>{eur(calc)}</b></> : null}
                                    </div>
                                  ) : bonusDetail ? <div className="tc-sub" style={{ marginTop: 6 }}>{bonusDetail}{meta.description && meta.bonus_mode === "units" ? ` · ${meta.description}` : ""}</div> : null}
                                </td>
                                <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{canSeeMoney ? eur(l.amount) : (hasBreakdown ? `${minutes} min` : "Oculto nivel 2")}</td>
                              </tr>
                            );
                          })}
                          {(!invoiceLines || invoiceLines.length === 0) && (
                            <tr>
                              <td colSpan={2} className="tc-muted">
                                No hay líneas (aún). Si esto pasa, regeneramos factura del mes en Admin.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="tc-hr" />

                    <div className="tc-title" style={{ fontSize: 14 }}>
                      ⚠️ Incidencias del mes
                    </div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Esto se actualiza en vivo (aunque la factura no se regenere).
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      {!incidents || incidents.length === 0 ? (
                        <div className="tc-sub">No tienes incidencias este mes.</div>
                      ) : (
                        (incidents || []).map((i: any) => (
                          <div
                            key={i.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,80,80,0.06)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between" }}>
                              <div style={{ fontWeight: 900 }}>{i.title || i.reason || "Incidencia"}</div>
                              <div style={{ fontWeight: 900 }}>{canSeeMoney ? `-${eur(i.amount)}` : "Oculto nivel 2"}</div>
                            </div>
                            {i.reason ? <div className="tc-sub" style={{ marginTop: 6 }}>{i.reason}</div> : null}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          </main>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: highlight ? "rgba(215,181,109,0.10)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, fontSize: 18, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function TopCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>
        🏆 {title}
      </div>
      <div className="tc-hr" />
      <div style={{ display: "grid", gap: 8 }}>
        {(items || []).slice(0, 3).map((t, i) => (
          <div key={i} className="tc-row" style={{ justifyContent: "space-between" }}>
            <span>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {t}
            </span>
          </div>
        ))}
        {(!items || items.length === 0) && <div className="tc-sub">Sin datos</div>}
      </div>
    </div>
  );
}

function TeamCard({
  title,
  tone,
  score,
  avgCliente,
  avgRepite,
  scoreRatio,
  isWinner,
}: {
  title: string;
  tone: "fuego" | "agua";
  score: any;
  avgCliente: any;
  avgRepite: any;
  scoreRatio: number;
  isWinner: boolean;
}) {
  const s = Number(score || 0);
  const toneLabel = tone === "fuego" ? "fuego" : "agua";
  const ToneIcon = tone === "fuego" ? Flame : Droplets;
  return (
    <article className={panelStyles.teamBattleCard} data-tone={toneLabel} data-winner={isWinner ? "true" : "false"}>
      <div className={panelStyles.teamBattleHead}>
        <div className={panelStyles.teamBattleTitleWrap}>
          <span className={panelStyles.teamBattleBadge}><ToneIcon size={18} /></span>
          <div>
            <small>{isWinner ? "Marcando el ritmo" : "En persecución"}</small>
            <h3>{title}</h3>
          </div>
        </div>
        {isWinner ? <span className={panelStyles.teamLeaderPill}>Líder</span> : <span className={panelStyles.teamLeaderPill} data-passive="true">Objetivo</span>}
      </div>

      <div className={panelStyles.teamScoreRow}>
        <div>
          <small>Score total</small>
          <strong>{s.toFixed(2)}</strong>
        </div>
        <div className={panelStyles.teamAuraRing} data-tone={toneLabel}>
          <ToneIcon size={22} />
        </div>
      </div>

      <div className={panelStyles.teamProgressWrap}>
        <div className={panelStyles.teamProgressMeta}>
          <span>Poder del equipo</span>
          <b>{Math.max(0, Math.min(100, Number(scoreRatio || 0))).toFixed(0)}%</b>
        </div>
        <div className={panelStyles.teamProgressTrack}>
          <span style={{ width: `${Math.max(6, Math.min(100, Number(scoreRatio || 0)))}%` }} data-tone={toneLabel} />
        </div>
      </div>

      <div className={panelStyles.teamStatsGrid}>
        <div className={panelStyles.teamMetricTile}>
          <small>Cliente</small>
          <strong>{Number(avgCliente || 0).toFixed(2)}%</strong>
        </div>
        <div className={panelStyles.teamMetricTile}>
          <small>Repite</small>
          <strong>{Number(avgRepite || 0).toFixed(2)}%</strong>
        </div>
      </div>
    </article>
  );
}

