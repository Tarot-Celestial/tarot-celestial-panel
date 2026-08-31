// src/app/panel-central/page.tsx
"use client";

export const dynamic = "force-dynamic";

import AppHeader from "@/components/AppHeader";
import CentralProgressHeader, { type CentralOperatorProfile, type CentralOperatorProgress } from "@/features/central/CentralProgressHeader";
import CentralStatsCards, { type CentralStatsData } from "@/features/central/CentralStatsCards";
import CentralDailyOverview, { type CentralDailyOverviewData, type RecentNotification, type RecentNotificationType } from "@/features/central/CentralDailyOverview";
import CentralSidebar, { type CentralNavItem } from "@/features/central/CentralSidebar";
import CentralXpPanel from "@/features/central/CentralXpPanel";
import CentralXpLevelsPanel from "@/features/central/CentralXpLevelsPanel";
import CentralXpCoinsPanel from "@/features/central/CentralXpCoinsPanel";
import CentralStorePanel from "@/features/central/CentralStorePanel";
import CentralDateSelector from "@/features/central/CentralDateSelector";
import { CentralThemeProvider } from "@/features/central/CentralTheme";
import { useCentralXpData } from "@/features/central/useCentralXpData";
import { useCentralFidelityData } from "@/features/central/useCentralFidelityData";
import MyClientsStatsCards, { type MyClientsStatsData } from "@/features/central/MyClientsStatsCards";
import MyClientsList, { type MyClientsView } from "@/features/central/MyClientsList";
import CentralNewClientModal from "@/features/central/CentralNewClientModal";
import MyClientProfile from "@/features/central/MyClientProfile";
import CentralNotificationsCenter, { useCentralNotificationsFeed, type CentralNotification } from "@/features/central/CentralNotificationsCenter";
import MyInvoicePanel, { useMyInvoice } from "@/features/central/MyInvoicePanel";
import { ChatProvider } from "@/providers/ChatProvider";
import { useChat } from "@/hooks/useChat";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { loadPanelIdentity, panelPathForRole, redirectToLogin } from "@/lib/panel-access";
import { TC_EVENTS, TC_LEGACY_EVENTS, emitTcEvent, listenTcEvent } from "@/lib/tc-events";
import { useAttendance } from "@/hooks/useAttendance";
import CRMClientesPanel from "@/components/crm/CRMClientesPanel";
import ReservasPanel from "@/components/reservas/ReservasPanel";
import HabitualesPanel from "@/components/habituales/HabitualesPanel";
import RendimientoPanel from "@/components/rendimiento/RendimientoPanel";
import CaptacionPanel from "@/components/captacion/CaptacionPanel";
import ReservasGlobalWatcher from "@/components/reservas/ReservasGlobalWatcher";
import PaymentMotivationWatcher from "@/components/motivation/PaymentMotivationWatcher";
import OperatorPanel from "@/components/panel/OperatorPanel";
import OperationalInbox from "@/components/central/OperationalInbox";
import CentralTeamLivePanel from "@/features/central/CentralTeamLivePanel";
import { BarChart3, BadgeEuro, Bell, CalendarDays, CheckSquare, Headphones, LayoutDashboard, Megaphone, ShieldCheck, ShoppingBag, Sparkles, Star, Users, UsersRound } from "lucide-react";

const sb = supabaseBrowser();

const TABS = [
  "central",
  "mis-clientas",
  "notificaciones",
  "mi-factura",
  "tu-sistema-xp",
  "tu-sistema-xp-niveles",
  "tu-sistema-xp-coins",
  "tienda",
  "panel",
  "equipo",
  "crm",
  "chat",
  "reservas",
  "diario",
  "captacion",
  "incidencias",
  "checklist",
  "llamadas",
  "rendimiento",
  "habituales",
  "ranking",
] as const;

type TabKey = typeof TABS[number];

const HIDDEN_TELEPHONIST_TABS = new Set<TabKey>(["chat", "diario", "llamadas"]);

const CENTRAL_NAV: CentralNavItem<TabKey>[] = [
  { key: "central", label: "Central", icon: LayoutDashboard },
  { key: "mis-clientas", label: "Mis clientas", icon: UsersRound },
  { key: "notificaciones", label: "Notificaciones", icon: Bell },
  { key: "mi-factura", label: "Mi factura", icon: BadgeEuro },
  {
    key: "tu-sistema-xp",
    label: "Tu sistema XP",
    icon: Sparkles,
    kicker: "Nivel y progreso",
    children: [
      { key: "tu-sistema-xp", label: "Mi progreso", kicker: "XP, acciones y actividad" },
      { key: "tu-sistema-xp-niveles", label: "Niveles", kicker: "Bronce → Leyenda" },
      { key: "tu-sistema-xp-coins", label: "Canjear XP por Coins", kicker: "Saldo y conversiones" },
    ],
  },
  { key: "tienda", label: "Tienda", icon: ShoppingBag, kicker: "Bóveda de recompensas" },
  { key: "panel", label: "Panel", icon: Headphones, kicker: "Extensiones y llamadas" },
  { key: "equipo", label: "Equipo", icon: Users },
  { key: "crm", label: "CRM", icon: Users },
  { key: "reservas", label: "Reservas", icon: CalendarDays },
  { key: "captacion", label: "Captación", icon: Megaphone },
  { key: "incidencias", label: "Incidencias", icon: ShieldCheck },
  { key: "checklist", label: "Checklist", icon: CheckSquare },
  { key: "rendimiento", label: "Rendimiento", icon: BarChart3 },
  { key: "habituales", label: "Habituales", icon: Star },
];

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dayKeyNow() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function madridTodayKey() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function pctAny(v: any) {
  let x = Number(v) || 0;
  if (x > 0 && x <= 1) x = x * 100;
  return x;
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

function statusLabel(s: string) {
  switch (s) {
    case "pending":
      return "⏳ Pendiente";
    case "calling":
      return "📞 Llamando";
    case "answered":
      return "✅ Contestó";
    case "no_answer":
      return "🚫 No contesta";
    case "busy":
      return "📵 Ocupado";
    case "wrong_number":
      return "❌ Número mal";
    case "callback":
      return "🔁 Llamar luego";
    case "done":
      return "✅ Hecho";
    default:
      return s || "—";
  }
}

const OUTBOUND_ACTIONS: { key: string; label: string }[] = [
  { key: "no_answer", label: "🚫 No contesta" },
  { key: "busy", label: "📵 Ocupado" },
  { key: "callback", label: "🔁 Llamar luego" },
  { key: "answered", label: "✅ Contestó" },
  { key: "wrong_number", label: "❌ Número mal" },
  { key: "done", label: "✅ Done" },
];

// --- CHAT TYPES (flexibles para tu backend) ---
type ChatThread = {
  id: string;
  title?: string | null;
  tarotist_display_name?: string | null;
  tarotist_worker_id?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
  unread_count?: number | null;
};

type ChatMessage = {
  id: string;
  thread_id: string;
  sender_worker_id?: string | null;
  sender_display_name?: string | null;
  text?: string | null;
  created_at?: string | null;
};

function recentNotificationType(item: CentralNotification): RecentNotificationType {
  const type = String(item.type || "").toLowerCase();
  if (item.priority === "urgent") return "urgent";
  if (item.priority === "attention") return "opportunity";
  if (item.priority === "reward" || ["achievement", "logro", "xp", "mission", "reward"].includes(type)) return "achievement";
  if (item.priority === "success" || ["sale", "purchase", "compra", "recompra"].includes(type)) return "sale";
  return "information";
}

function relativeNotificationTime(value?: string | null) {
  if (!value) return "Ahora";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Ahora";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} d`;
}

function toRecentNotification(item: CentralNotification): RecentNotification {
  const metadata = item.metadata || {};
  const clientName = typeof metadata.client_name === "string" ? metadata.client_name.trim() : "";
  const observations = typeof metadata.observations === "string" ? metadata.observations.trim() : "";
  const description = String(item.description || (clientName ? `${clientName}: notificación pendiente` : "Notificación pendiente"));
  return {
    id: item.id,
    type: recentNotificationType(item),
    title: item.title,
    description,
    createdAtLabel: relativeNotificationTime(item.scheduled_at || item.created_at),
    observation: observations || undefined,
    actionLabel: item.action_label || undefined,
  };
}

function CentralPage() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("panel");
  const notificationFeed = useCentralNotificationsFeed();
  const myInvoiceFeed = useMyInvoice(ok && tab === "mi-factura");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const todayKey = madridTodayKey();
  const requestedDate = String(searchParams?.get("date") || "");
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate <= todayKey ? requestedDate : todayKey;
  const needsXpData = tab === "central" || tab === "mis-clientas" || tab.startsWith("tu-sistema-xp");
  const needsFidelityData = tab === "central" || tab === "mis-clientas";
  const xpFeed = useCentralXpData(selectedDate, ok && needsXpData);
  const fidelityFeed = useCentralFidelityData(ok && needsFidelityData);
  const activeSyncStatuses = [
    ...(needsXpData ? [xpFeed.syncStatus] : []),
    ...(needsFidelityData ? [fidelityFeed.syncStatus] : []),
  ];
  const headerSyncStatus = !ok || activeSyncStatuses.includes("syncing")
    ? "syncing"
    : activeSyncStatuses.includes("error")
    ? "error"
    : "synced";
  const xpData = xpFeed.data;
  const xpProgress = xpData?.progress;
  const currentTierName = xpProgress?.tier?.name || "Sin categoría";
  const nextLevelConfig = xpData?.level_config.find((level) => level.level === xpProgress?.next_level);
  const nextTierName = xpData?.tier_config.find((tier) => tier.key === nextLevelConfig?.tier_key)?.name;
  const nextLevelName = xpProgress?.next_level
    ? `${xpProgress.next_level}${nextTierName ? ` · ${nextTierName}` : ""}`
    : "máximo";
  const notificationCount = Number(notificationFeed.summary.active ?? notificationFeed.summary.pending ?? notificationFeed.summary.unread ?? 0);
  const [myClientsView, setMyClientsView] = useState<MyClientsView>("all");
  const [newClientOpen, setNewClientOpen] = useState(false);
  const closeNewClient = useCallback(() => setNewClientOpen(false), []);
  const [myClientsRealStats, setMyClientsRealStats] = useState<{active:number;followup:number}|null>(null);
  const handleMyClientsStats = useCallback((stats:{active:number;followup:number}) => setMyClientsRealStats(stats), []);

  const centralProgress: CentralOperatorProgress = {
    totalXp: xpProgress?.total_xp || 0,
    activeStreakDays: Number(xpData?.stats.streak) || 0,
    loyaltyIndex: fidelityFeed.average,
    loyaltyClientCount: fidelityFeed.clientCount,
  };

  const centralStats: CentralStatsData = {
    totalXp: xpProgress?.total_xp || 0,
    xpToday: xpData?.daily_activity.total_xp || 0,
    xpDateLabel: selectedDate === todayKey ? "hoy" : `el ${new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`))}`,
    currentLevel: xpProgress ? `Nivel ${xpProgress.level} · ${currentTierName}` : currentTierName,
    currentLevelXp: xpProgress?.level_xp || 0,
    nextLevelXp: xpProgress?.level_span || 0,
    nextLevelName,
    xpEvolution: (xpData?.weekly || []).map((point) => Number(point.xp) || 0),
    activeClients: 24,
    activeClientsThisWeek: 5,
    notificationTotal: Number(notificationFeed.summary.pending ?? notificationFeed.summary.unread ?? 0),
    urgentNotifications: notificationFeed.summary.urgent,
    followUpNotifications: notificationFeed.summary.reminders,
    informationNotifications: Number(notificationFeed.summary.information ?? 0),
    earnedMoney: Number(myInvoiceFeed.data?.total || 0),
    earnedMoneyThisWeek: Number(myInvoiceFeed.data?.weekly_earnings || 0),
    earnedMoneyEvolution: (myInvoiceFeed.data?.evolution || []).map((point: { total: number }) => Number(point.total) || 0),
  };

  // Datos visuales provisionales para la primera fila de la pestaña Mis clientas.
  // Quedan tipados para conectarlos más adelante con XP, CRM y Coins reales.
  const myClientsStats: MyClientsStatsData = {
    currentLevel: xpProgress?.level || 1,
    currentLevelXp: xpProgress?.level_xp || 0,
    nextLevelXp: xpProgress?.level_span || 0,
    activeClients: myClientsRealStats?.active || 0,
    activeClientsThisWeek: 0,
    clientsWithoutFollowUp: myClientsRealStats?.followup || 0,
    availableCoins: xpData?.coin_exchange.coin_balance || 0,
  };

  const dailyActivity = xpData?.daily_activity;
  const realDailyActions = xpFeed.busy
    ? [{ id: "daily-loading", label: "Cargando resumen de la fecha seleccionada…", rewardXp: 0 }]
    : dailyActivity?.activities.length
    ? dailyActivity.activities.map((activity) => {
        const time = new Intl.DateTimeFormat("es-ES", {
          timeZone: dailyActivity.timezone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(activity.occurred_at));
        const amount = activity.kind === "payment"
          ? new Intl.NumberFormat("es-ES", {
              style: "currency",
              currency: activity.currency || "EUR",
            }).format(Number(activity.amount) || 0)
          : null;
        const description = activity.kind === "payment"
          ? `Cobro realizado · ${amount}`
          : activity.kind === "followup"
            ? activity.detail || "Seguimiento realizado"
            : activity.detail || (activity.kind === "capture" ? "Nueva clienta captada" : "Movimiento registrado");
        return {
          id: activity.id,
          label: activity.client_name,
          rewardXp: activity.xp,
          rewardCoins: activity.coins,
          kind: activity.kind,
          completed: true,
          detail: `${time} · ${description}${activity.origin ? ` · ${activity.origin}` : ""}`,
        };
      })
    : [{ id: "daily-empty", label: "Todavía no hay actividad registrada hoy", rewardXp: 0 }];

  const centralDailyOverview: CentralDailyOverviewData = {
    dailySummary: {
      title: selectedDate === todayKey ? "Tu resumen de hoy" : `Resumen del ${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`))}`,
      subtitle: dailyActivity ? `Actividad real del ${new Date(`${dailyActivity.date}T12:00:00`).toLocaleDateString("es-ES")} · ${dailyActivity.timezone}` : "Cargando la actividad real de hoy…",
      completed: dailyActivity?.total_actions || 0,
      target: null,
      dailyXp: dailyActivity?.total_xp || 0,
      dateLabel: selectedDate === todayKey ? "hoy" : "ese día",
      actions: realDailyActions,
    },
    missions: (xpData?.missions?.active||[]).map(mission=>({id:mission.id,name:mission.name,description:mission.description,progress:mission.progress,target:mission.target_count,rewardXp:mission.xp_reward,completed:mission.completed,claimed:mission.claimed,periodKey:mission.period_key})),
    notifications: notificationFeed.items
      .filter((item) => item.state !== "resolved")
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(toRecentNotification),
  };

  const [connectedOperator, setConnectedOperator] = useState<any>(null);
  const themeWorkerId = String(connectedOperator?.worker?.id || connectedOperator?.id || connectedOperator?.user?.id || "");

  const handleIdentityLoaded = useCallback((identity: any) => {
    setConnectedOperator(identity || null);
  }, []);

  const centralProfile: CentralOperatorProfile = useMemo(() => {
    const worker = connectedOperator?.worker || {};
    const displayName = String(
      connectedOperator?.display_name || worker?.display_name || "Telefonista"
    ).trim() || "Telefonista";

    const photoUrl =
      worker?.photo_url ||
      worker?.avatar_url ||
      connectedOperator?.photo_url ||
      connectedOperator?.avatar_url ||
      null;

    return {
      name: displayName,
      role: String(worker?.job_title || worker?.category || "Telefonista Experta"),
      level: xpProgress ? `${xpProgress.level} · ${currentTierName}` : currentTierName,
      photoUrl: photoUrl ? String(photoUrl) : null,
    };
  }, [connectedOperator, currentTierName, xpProgress]);

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

    const allowedTabs = new Set<TabKey>(TABS);
    if (allowedTabs.has(requestedTab as TabKey)) {
      const nextTab = requestedTab as TabKey;
      if (HIDDEN_TELEPHONIST_TABS.has(nextTab)) {
        setTab("central");
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("tab", "central");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        return;
      }
      setTab(nextTab);
    }
  }, [pathname, router, searchParams]);

  const handleSidebarTabChange = useCallback((nextTab: TabKey) => {
    if (HIDDEN_TELEPHONIST_TABS.has(nextTab)) {
      nextTab = "central";
    }

    setTab(nextTab);

    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("tab", nextTab);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!HIDDEN_TELEPHONIST_TABS.has(tab)) return;

    setTab("central");
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("tab", "central");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, tab]);

  useEffect(() => {
    const onOpenCrmTab = () => setTab("crm" as any);
    window.addEventListener("tc-open-crm-tab", onOpenCrmTab);
    return () => window.removeEventListener("tc-open-crm-tab", onOpenCrmTab);
  }, []);
  const [crmCloseNotif, setCrmCloseNotif] = useState<any>(null);
  const [crmDismissedIds, setCrmDismissedIds] = useState<string[]>([]);
  const crmCloseNotifInFlightRef = useRef(false);
  const [month, setMonth] = useState(monthKeyNow());

  const [rank, setRank] = useState<any>(null);
  const [rankMsg, setRankMsg] = useState("");

  const [tarotists, setTarotists] = useState<any[]>([]);
  const [tarotistsLoading, setTarotistsLoading] = useState(false);
  const [tarotistsMsg, setTarotistsMsg] = useState("");

  const [incWorkerId, setIncWorkerId] = useState("");
  const [incAmount, setIncAmount] = useState("5");
  const [incReason, setIncReason] = useState("No contesta llamada");
  const [incMsg, setIncMsg] = useState("");
  const [incLoading, setIncLoading] = useState(false);

  const [q, setQ] = useState("");

  // checklist tarotistas (turno actual)
  const [clLoading, setClLoading] = useState(false);
  const [clMsg, setClMsg] = useState("");
  const [clShiftKey, setClShiftKey] = useState<string>("");
  const [clRows, setClRows] = useState<any[]>([]);
  const [clQ, setClQ] = useState("");

  // ✅ attendance (online real) - Central (self)
  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const attendance = useAttendance();
  const attOnline = attendance.online;
  const attStatus = attendance.status;
  const attBeatRef = useRef<any>(null);

  // ✅ outbound calls (central)
  const [obDate, setObDate] = useState(dayKeyNow());
  const [obLoading, setObLoading] = useState(false);
  const [obMsg, setObMsg] = useState("");
  const [obBatches, setObBatches] = useState<any[]>([]);
  const obChannelsRef = useRef<any[]>([]);

  const batchIdsKey = useMemo(() => {
    return (obBatches || []).map((b: any) => String(b?.id || "")).filter(Boolean).join(",");
  }, [obBatches]);

  // ✅ CHAT (central/admin ve todos) - migrado a ChatProvider
  const chat = useChat();
  const chatLoading = chat.loading;
  const chatMsg = chat.message;
  const threads = chat.threads as ChatThread[];
  const selectedThreadId = chat.selectedThreadId;
  const setSelectedThreadId = chat.setSelectedThreadId;
  const messages = chat.messages as ChatMessage[];
  const [threadQ, setThreadQ] = useState("");
  const [msgText, setMsgText] = useState("");
  const msgEndRef = useRef<HTMLDivElement | null>(null);

  // ✅ NUEVO: abrir chat directamente con tarotista
  const [newChatWorkerId, setNewChatWorkerId] = useState<string>("");
  const [newChatMsg, setNewChatMsg] = useState<string>("");

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
    emitTcEvent(TC_EVENTS.activeTabChanged, { tab, surface: "central" });
  }, [tab]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await loadPanelIdentity(sb);
        if (!active) return;
        if (String(me.role).toLowerCase() !== "central") {
          window.location.replace(panelPathForRole(me.role));
          return;
        }
        setOk(true);
      } catch (error) {
        if (!active) return;
        redirectToLogin(error instanceof Error ? error.message : "session");
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ok) return;

    loadLatestCrmCloseNotif(true);

    const channel = sb
      .channel("crm-close-notifs-central")
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

    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadLatestCrmCloseNotif(true);
    };
    const timer = setInterval(refreshVisible, 120000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      sb.removeChannel(channel);
    };
  }, [ok, crmDismissedIds]);



  async function loadLatestCrmCloseNotif(silent = false) {
    if (crmCloseNotifInFlightRef.current) return;
    crmCloseNotifInFlightRef.current = true;
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const r = await fetch("/api/central/crm/call-close-notifications/latest", {
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
    finally { crmCloseNotifInFlightRef.current = false; }
  }


  async function markCrmCloseNotifRead(id: string) {
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token || !id) return;

      await fetch("/api/central/crm/call-close-notifications/mark-read", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

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
    } finally {
      if (!silent) setAttLoading(false);
    }
  }

  async function postAttendanceEvent(event_type: "online" | "offline" | "heartbeat", metaExtra: any = {}) {
    try {
      setAttMsg("");
      setAttLoading(true);

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
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

  // ✅ Heartbeat SOLO si está online real
  useEffect(() => {
    if (!ok) return;

    if (attBeatRef.current) {
      clearInterval(attBeatRef.current);
      attBeatRef.current = null;
    }

    if (!attOnline) return;

    let stopped = false;

    const start = async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const ping = async () => {
        if (stopped) return;
        await fetch("/api/attendance/event", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

  async function refreshRanking() {
    setRankMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const rnkRes = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rnk = await safeJson(rnkRes);

      if (!rnk?._ok || rnk?.ok === false) {
        setRank(null);
        setRankMsg(`⚠️ Error cargando ranking: ${rnk?.error || `HTTP ${rnk?._status}`}`);
        return;
      }

      setRank(rnk);
    } catch (e: any) {
      setRankMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadTarotists() {
    setTarotistsLoading(true);
    setTarotistsMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/tarotists", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setTarotists([]);
        setTarotistsMsg(`❌ No se pudieron cargar tarotistas: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const list = j.tarotists || [];
      setTarotists(list);
      setTarotistsMsg(list.length ? `✅ Cargadas ${list.length} tarotistas` : "⚠️ No hay tarotistas (¿workers.role='tarotista'?)");

      if (!incWorkerId && list.length) setIncWorkerId(list[0].id);

      // ✅ default selector "nuevo chat"
      if (!newChatWorkerId && list.length) setNewChatWorkerId(String(list[0].id));
    } catch (e: any) {
      setTarotists([]);
      setTarotistsMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setTarotistsLoading(false);
    }
  }

  async function loadChecklist() {
    if (clLoading) return;
    setClLoading(true);
    setClMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/checklists", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setClRows([]);
        setClShiftKey("");
        setClMsg(`❌ No se pudo cargar checklist: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      setClShiftKey(String(j.shift_key || ""));
      setClRows(j.rows || []);
      setClMsg(`✅ Checklist cargado (${(j.rows || []).length} tarotistas)`);
    } catch (e: any) {
      setClRows([]);
      setClShiftKey("");
      setClMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setClLoading(false);
    }
  }

  async function loadOutboundPending(silent = false) {
    if (obLoading && !silent) return;
    if (!silent) {
      setObLoading(true);
      setObMsg("");
    }

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch(`/api/central/outbound/pending?date=${encodeURIComponent(obDate)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setObBatches(j.batches || []);
      if (!silent) {
        setObMsg(`✅ Pendientes cargados (${(j.batches || []).length} envíos)`);
        setTimeout(() => setObMsg(""), 1200);
      }
    } catch (e: any) {
      if (!silent) setObMsg(`❌ ${e?.message || "Error"}`);
      setObBatches([]);
    } finally {
      if (!silent) setObLoading(false);
    }
  }

  async function outboundLog(item_id: string, status: string) {
    const noteInput = window.prompt("Observación (opcional). Cancelar = no guardar:", "");
    if (noteInput === null) return;
    const note = noteInput.trim() ? noteInput.trim() : null;

    const optimisticAt = new Date().toISOString();
    if (status === "done") {
      setObBatches((prev) =>
        (prev || []).map((b: any) => ({
          ...b,
          outbound_batch_items: (b.outbound_batch_items || []).filter((it: any) => String(it.id) !== String(item_id)),
        }))
      );
    } else {
      setObBatches((prev) =>
        (prev || []).map((b: any) => ({
          ...b,
          outbound_batch_items: (b.outbound_batch_items || []).map((it: any) =>
            String(it.id) === String(item_id)
              ? { ...it, current_status: status, last_note: note ?? it.last_note, last_call_at: optimisticAt }
              : it
          ),
        }))
      );
    }

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");

      const url = "/api/central/outbound/log";
      const payload = { item_id, status, note };

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        throw new Error(`${j?.error || `HTTP ${j?._status}`} · POST ${url} · body=${JSON.stringify(payload)}`);
      }

      const updated = j.item;
      if (updated?.id) {
        setObBatches((prev) =>
          (prev || []).map((b: any) => {
            let items = b.outbound_batch_items || [];
            items = items.map((it: any) => (String(it.id) === String(updated.id) ? { ...it, ...updated } : it));
            items = items.filter((it: any) => String(it.current_status) !== "done");
            return { ...b, outbound_batch_items: items };
          })
        );
      }
    } catch (e: any) {
      alert(`Error: ${e?.message || "ERR"}`);
      loadOutboundPending(true);
    }
  }

  // ---------------- CHAT helpers (migrado a ChatProvider) ----------------
  async function loadChatThreads(silent = false) {
    await chat.loadThreads(silent);
  }

  async function loadChatMessages(threadId: string, silent = false) {
    await chat.loadMessages(threadId, silent);
    if (!silent) setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function sendChatMessage() {
    const text = msgText.trim();
    if (!text || !selectedThreadId) return;

    setMsgText("");
    try {
      await chat.sendMessage(text);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) {
      setMsgText(text);
      alert(`Error: ${e?.message || "ERR"}`);
    }
  }

  // ✅ NUEVO: abrir chat con una tarotista (crea thread si no existe)
  async function openChatWithTarotist() {
    setNewChatMsg("");
    try {
      if (!newChatWorkerId) {
        setNewChatMsg("⚠️ Selecciona una tarotista.");
        return;
      }

      const tid = await chat.openThreadWithTarotist(newChatWorkerId);
      if (!tid) throw new Error("NO_THREAD_ID");

      setNewChatMsg("✅ Chat abierto");
      setTimeout(() => setNewChatMsg(""), 1200);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) {
      setNewChatMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  // ---------------- INIT LOADS ----------------
  useEffect(() => {
    if (!ok) return;
    refreshRanking();
    loadTarotists();
    loadAttendanceMe(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    refreshRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "incidencias") loadTarotists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "checklist") loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);


  useEffect(() => {
    if (!ok) return;
    if (tab === "llamadas") loadOutboundPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ok, obDate]);

  // al entrar a chat, carga threads; al seleccionar thread, carga mensajes
  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    loadChatThreads(false);
    // ✅ por si no están cargadas tarotistas (para selector "nuevo chat")
    if (!tarotists?.length) loadTarotists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab]);

  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    if (!selectedThreadId) return;
    loadChatMessages(selectedThreadId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, selectedThreadId]);

  // ✅ realtime central (UPDATE outbound_batch_items por batch_id)
  useEffect(() => {
    if (!ok) return;

    if (obChannelsRef.current?.length) {
      obChannelsRef.current.forEach((ch) => sb.removeChannel(ch));
      obChannelsRef.current = [];
    }

    const batchIds = (obBatches || []).map((b: any) => String(b.id)).filter(Boolean);
    if (!batchIds.length) return;

    const channels = batchIds.map((bid) =>
      sb
        .channel(`central-outbound-${bid}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "outbound_batch_items", filter: `batch_id=eq.${bid}` },
          (payload) => {
            const updated: any = payload.new;
            setObBatches((prev) =>
              (prev || []).map((b: any) => {
                if (String(b.id) !== bid) return b;
                let items = b.outbound_batch_items || [];
                items = items.map((it: any) => (String(it.id) === String(updated.id) ? { ...it, ...updated } : it));
                items = items.filter((it: any) => String(it.current_status) !== "done");
                return { ...b, outbound_batch_items: items };
              })
            );
          }
        )
        .subscribe()
    );

    obChannelsRef.current = channels;

    return () => {
      channels.forEach((ch) => sb.removeChannel(ch));
      obChannelsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, batchIdsKey]);

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  const tarotistsFiltered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return tarotists;
    return (tarotists || []).filter((t) => String(t.display_name || "").toLowerCase().includes(qq));
  }, [tarotists, q]);

  const selectedTarotist = useMemo(() => tarotists.find((t) => t.id === incWorkerId), [tarotists, incWorkerId]);

  const clRowsFiltered = useMemo(() => {
    const qq = clQ.trim().toLowerCase();
    const rows = clRows || [];
    if (!qq) return rows;
    return rows.filter((r) => String(r.display_name || "").toLowerCase().includes(qq));
  }, [clRows, clQ]);

  const clProgress = useMemo(() => {
    const rows = clRows || [];
    const total = rows.length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const inProg = rows.filter((r) => r.status === "in_progress").length;
    const notStarted = rows.filter((r) => r.status === "not_started").length;
    return { total, completed, inProg, notStarted };
  }, [clRows]);

  const threadsFiltered = useMemo(() => {
    const qq = threadQ.trim().toLowerCase();
    let rows = threads || [];
    if (!qq) return rows;
    return rows.filter((t) => {
      const name = String(t.tarotist_display_name || t.title || "");
      return name.toLowerCase().includes(qq);
    });
  }, [threads, threadQ]);

  async function crearIncidencia() {
    if (incLoading) return;
    setIncLoading(true);
    setIncMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const res = await fetch("/api/central/incidents", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id: incWorkerId,
          amount: Number(String(incAmount).replace(",", ".")),
          reason: incReason,
          month_key: month,
        }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setIncMsg("✅ Incidencia creada. (Para reflejarlo en factura: generar facturas del mes.)");
    } catch (e: any) {
      setIncMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setIncLoading(false);
    }
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
    setTab("reservas" as any);
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

  const centralNavItems = useMemo(
    () => CENTRAL_NAV.map((item) => item.key === "notificaciones" ? { ...item, badge: notificationCount } : item),
    [notificationCount]
  );

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <CentralThemeProvider workerId={themeWorkerId}>
      <div className="tc-premium-bg" aria-hidden="true">
        <div className="tc-premium-orb tc-premium-orb-one" />
        <div className="tc-premium-orb tc-premium-orb-two" />
        <div className="tc-premium-orb tc-premium-orb-three" />
        <div className="tc-login-stars" />
        <div className="tc-login-grid" />
      </div>
      <AppHeader onIdentityLoaded={handleIdentityLoaded} />
      <ReservasGlobalWatcher enabled={true} onGoToReserva={openReservaFromPopup} />
      <PaymentMotivationWatcher mode="central" xpData={xpData} onStateRefresh={xpFeed.load} />
      <div className="tc-shell tc-shell-premium">
        <CentralSidebar items={centralNavItems} activeTab={tab} onTabChange={handleSidebarTabChange} />

        <main className="tc-main">
          <CentralProgressHeader
            progress={centralProgress}
            profile={centralProfile}
            onSync={() => { void xpFeed.load(); void fidelityFeed.load(); window.dispatchEvent(new Event("tc-my-clients-refresh")); }}
            syncStatus={headerSyncStatus}
            lastSyncedAt={fidelityFeed.lastSyncedAt || xpFeed.lastSyncedAt}
          />
          {tab === "central" && <CentralDateSelector value={selectedDate} today={todayKey} loading={xpFeed.busy} onChange={(date) => { const params=new URLSearchParams(searchParams?.toString()||""); params.set("tab","central"); params.set("date",date); router.push(`${pathname}?${params.toString()}`,{scroll:false}); }} />}

          <div className="tc-main-content">
          {tab === "mis-clientas" && (
            <>
              <MyClientsStatsCards data={myClientsStats} clientsLoading={!myClientsRealStats} xpLoading={!xpData} onLevel={() => handleSidebarTabChange("tu-sistema-xp-niveles")} onActive={() => setMyClientsView("active")} onFollowUp={() => setMyClientsView("followup")} onCoins={() => handleSidebarTabChange("tu-sistema-xp-coins")} />
              {searchParams?.get("cliente") ? (
                <MyClientProfile
                  clientId={String(searchParams.get("cliente"))}
                  onBack={() => {
                    const params = new URLSearchParams(searchParams?.toString() || "");
                    params.set("tab", "mis-clientas");
                    params.delete("cliente");
                    router.push(`${pathname}?${params.toString()}`, { scroll: false });
                  }}
                />
              ) : (
                <MyClientsList
                  view={myClientsView}
                  onViewChange={setMyClientsView}
                  onStats={handleMyClientsStats}
                  onNewClient={() => setNewClientOpen(true)}
                  onOpenClient={(clientId) => {
                    const params = new URLSearchParams(searchParams?.toString() || "");
                    params.set("tab", "mis-clientas");
                    params.set("cliente", String(clientId));
                    router.push(`${pathname}?${params.toString()}`, { scroll: false });
                  }}
                />
              )}
            </>
          )}

          {tab === "notificaciones" && <CentralNotificationsCenter feed={notificationFeed} />}

          <CentralNewClientModal open={newClientOpen} onClose={closeNewClient} onCreated={() => { void xpFeed.load(true); }} />

          {tab === "mi-factura" && <MyInvoicePanel feed={myInvoiceFeed} />}

          {tab === "tu-sistema-xp" && <CentralXpPanel {...xpFeed} />}
          {tab === "tu-sistema-xp-niveles" && <CentralXpLevelsPanel {...xpFeed} />}
          {tab === "tu-sistema-xp-coins" && <CentralXpCoinsPanel {...xpFeed} />}
          {tab === "tienda" && <CentralStorePanel onEarnCoins={() => handleSidebarTabChange("tu-sistema-xp-coins")} />}

          {tab === "central" && (
            <>
              <CentralStatsCards
                data={centralStats}
                onViewProgress={() => handleSidebarTabChange("tu-sistema-xp")}
                onViewLevels={() => handleSidebarTabChange("tu-sistema-xp-niveles")}
                onViewClients={() => setTab("crm")}
                onViewNotifications={() => handleSidebarTabChange("notificaciones")}
                onViewEarnings={() => handleSidebarTabChange("mi-factura")}
              />
              <CentralDailyOverview
                data={centralDailyOverview}
                onViewAllMissions={() => handleSidebarTabChange("tu-sistema-xp-niveles")}
                onClaimMission={xpFeed.claimMission}
                onViewAllNotifications={() => handleSidebarTabChange("notificaciones")}
              />
            </>
          )}
{tab === "panel" && (
            <>
              <OperationalInbox
                mode="central"
                onAction={(action) => {
                  if (action === "leads") setTab("captacion");
                  if (action === "parking") setTab("panel");
                  if (action === "chat") setTab("chat");
                  if (action === "calls") setTab("llamadas");
                  if (action === "team") setTab("equipo");
                  if (action === "incidents") setTab("incidencias");
                  if (action === "crm") setTab("crm");
                }}
              />
              <OperatorPanel mode="central" />
            </>
          )}
          {tab === "chat" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">💬 Chat (Tarotistas ↔ Centrales)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Centrales ven todos los chats · Realtime: nuevos mensajes al instante
                    {chatMsg ? ` · ${chatMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={() => loadChatThreads(false)} disabled={chatLoading}>
                    {chatLoading ? "Cargando…" : "Recargar chats"}
                  </button>
                </div>
              </div>

              {/* ✅ NUEVO: abrir chat con tarotista aunque no exista */}
              <div className="tc-hr" />
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(255,255,255,0.02)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>🟢 Iniciar conversación</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Elige una tarotista y pulsa “Abrir chat”. (Crea el hilo si no existe.)
                      {newChatMsg ? ` · ${newChatMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <select
                      className="tc-select"
                      value={newChatWorkerId}
                      onChange={(e) => setNewChatWorkerId(e.target.value)}
                      style={{ minWidth: 320, maxWidth: "100%" }}
                    >
                      {(tarotists || []).map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.display_name} {t.team_key ? `(${t.team_key})` : ""}
                        </option>
                      ))}
                      {(!tarotists || tarotists.length === 0) && <option value="">(Cargando tarotistas…)</option>}
                    </select>

                    <button className="tc-btn tc-btn-ok" onClick={openChatWithTarotist} disabled={!newChatWorkerId}>
                      🟢 Abrir chat
                    </button>

                    <button className="tc-btn" onClick={loadTarotists} disabled={tarotistsLoading}>
                      {tarotistsLoading ? "…" : "Recargar lista"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="tc-hr" />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "320px 1fr",
                  gap: 12,
                  alignItems: "stretch",
                }}
              >
                {/* Left: threads */}
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
                    <input
                      className="tc-input"
                      value={threadQ}
                      onChange={(e) => setThreadQ(e.target.value)}
                      placeholder="Buscar chat…"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div className="tc-hr" style={{ margin: 0 }} />

                  <div style={{ padding: 8, display: "grid", gap: 8, overflow: "auto" }}>
                    {(threadsFiltered || []).map((t) => {
                      const active = String(t.id) === String(selectedThreadId);
                      const title = t.tarotist_display_name || t.title || `Chat ${t.id.slice(0, 6)}`;
                      const sub = t.last_message_text ? t.last_message_text : "—";
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelectedThreadId(t.id)}
                          className="tc-btn"
                          style={{
                            textAlign: "left",
                            padding: 10,
                            borderRadius: 12,
                            border: active ? "1px solid rgba(215,181,109,0.35)" : "1px solid rgba(255,255,255,0.10)",
                            background: active ? "rgba(215,181,109,0.10)" : "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {title}
                            </div>
                            {t.unread_count ? <span className="tc-chip">{t.unread_count}</span> : null}
                          </div>
                          <div
                            className="tc-sub"
                            style={{
                              marginTop: 6,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {sub}
                          </div>
                        </button>
                      );
                    })}

                    {(!threadsFiltered || threadsFiltered.length === 0) && (
                      <div className="tc-sub" style={{ padding: 10 }}>
                        No hay chats todavía.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: messages */}
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
                    <div style={{ fontWeight: 900 }}>
                      {selectedThreadId
                        ? threads.find((x) => String(x.id) === String(selectedThreadId))?.tarotist_display_name ||
                          threads.find((x) => String(x.id) === String(selectedThreadId))?.title ||
                          `Chat ${selectedThreadId.slice(0, 6)}`
                        : "Selecciona un chat"}
                    </div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      {selectedThreadId ? `Thread: ${selectedThreadId}` : "—"}
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
                    {(!messages || messages.length === 0) && <div className="tc-sub">No hay mensajes todavía en este chat.</div>}
                    <div ref={msgEndRef} />
                  </div>

                  <div className="tc-hr" style={{ margin: 0 }} />

                  <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      className="tc-input"
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder={selectedThreadId ? "Escribe un mensaje…" : "Selecciona un chat…"}
                      style={{ flex: 1, minWidth: 240 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendChatMessage();
                        }
                      }}
                      disabled={!selectedThreadId}
                    />
                    <button className="tc-btn tc-btn-gold" onClick={sendChatMessage} disabled={!selectedThreadId || !msgText.trim()}>
                      Enviar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "crm" && <CRMClientesPanel mode="central" showImportButton={false} />}
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
          {tab === "rendimiento" && <RendimientoPanel mode="central" />}
          {tab === "reservas" && <ReservasPanel mode="central" />}
          {tab === "habituales" && <HabitualesPanel mode="central" />}

          {/* ✅ OUTBOUND LLAMADAS */}
          {tab === "llamadas" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">📞 Llamadas del día</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Al marcar <b>Done</b> desaparece al instante · Realtime activado
                    {obMsg ? ` · ${obMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="tc-chip">Día</span>
                  <input
                    className="tc-input"
                    value={obDate}
                    onChange={(e) => setObDate(e.target.value)}
                    style={{ width: 140 }}
                    placeholder="YYYY-MM-DD"
                  />
                  <button className="tc-btn tc-btn-gold" onClick={() => loadOutboundPending(false)} disabled={obLoading}>
                    {obLoading ? "Cargando…" : "Actualizar"}
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 12 }}>
                {(obBatches || []).map((b: any) => {
                  const sender = b.sender || {};
                  const items = (b.outbound_batch_items || []).slice().sort((a: any, c: any) => (a.position ?? 0) - (c.position ?? 0));
                  if (!items.length) return null;

                  return (
                    <div
                      key={b.id}
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
                            {sender.display_name || "Tarotista"}{" "}
                            <span className="tc-chip" style={{ marginLeft: 8 }}>
                              {sender.team || sender.team_key || "—"}
                            </span>
                          </div>
                          {b.note ? <div className="tc-sub" style={{ marginTop: 6 }}>{b.note}</div> : null}
                        </div>
                        <div className="tc-chip">{items.length} pendientes</div>
                      </div>

                      <div className="tc-hr" style={{ margin: "12px 0" }} />

                      <div style={{ display: "grid", gap: 10 }}>
                        {items.map((it: any) => (
                          <div
                            key={it.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ minWidth: 260 }}>
                                <div style={{ fontWeight: 900 }}>
                                  {it.customer_name || "—"}{" "}
                                  <span className="tc-chip" style={{ marginLeft: 8 }}>
                                    {statusLabel(String(it.current_status || "pending"))}
                                  </span>
                                </div>
                                {it.phone ? <div className="tc-sub" style={{ marginTop: 6 }}>📱 {it.phone}</div> : null}
                                {it.last_note ? <div className="tc-sub" style={{ marginTop: 6 }}>📝 {it.last_note}</div> : null}
                              </div>

                              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                {OUTBOUND_ACTIONS.map((a) => (
                                  <button
                                    key={a.key}
                                    className={`tc-btn ${a.key === "done" ? "tc-btn-ok" : ""}`}
                                    onClick={() => outboundLog(String(it.id), a.key)}
                                  >
                                    {a.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {(!obBatches || obBatches.length === 0) && <div className="tc-sub">No hay listas para este día.</div>}
              </div>
            </div>
          )}

          {tab === "equipo" && <CentralTeamLivePanel month={month} />}

          {/* Checklist */}
          {tab === "checklist" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">✅ Checklist Tarotistas (turno actual)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Turno: <b>{clShiftKey || "—"}</b> · Completadas:{" "}
                    <b>
                      {clProgress.completed}/{clProgress.total}
                    </b>{" "}
                    · En progreso: <b>{clProgress.inProg}</b> · Sin empezar: <b>{clProgress.notStarted}</b>
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={loadChecklist} disabled={clLoading}>
                    {clLoading ? "Cargando…" : "Actualizar checklist"}
                  </button>
                </div>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {clMsg || " "}
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 10 }}>
                <input
                  className="tc-input"
                  value={clQ}
                  onChange={(e) => setClQ(e.target.value)}
                  placeholder="Buscar tarotista…"
                  style={{ width: 280, maxWidth: "100%" }}
                />
                <div className="tc-chip">
                  Nota: este checklist se <b>resetea solo</b> con el turno (shift_key).
                </div>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 10 }}>
                {(clRowsFiltered || []).map((r: any) => (
                  <div
                    key={r.worker_id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background:
                        r.status === "completed"
                          ? "rgba(120,255,190,0.10)"
                          : r.status === "in_progress"
                          ? "rgba(215,181,109,0.08)"
                          : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{r.display_name}</div>
                        <div className="tc-sub" style={{ marginTop: 6 }}>
                          Estado:{" "}
                          <b>
                            {r.status === "completed" ? "Completado ✅" : r.status === "in_progress" ? "En progreso ⏳" : "Sin empezar ⬜"}
                          </b>
                          {r.completed_at ? ` · ${new Date(r.completed_at).toLocaleString("es-ES")}` : ""}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          className="tc-chip"
                          style={{
                            borderColor:
                              r.status === "completed"
                                ? "rgba(120,255,190,0.35)"
                                : r.status === "in_progress"
                                ? "rgba(215,181,109,0.35)"
                                : "rgba(255,255,255,0.14)",
                          }}
                        >
                          {r.status === "completed" ? "OK" : r.status === "in_progress" ? "Casi" : "Pendiente"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {(!clRowsFiltered || clRowsFiltered.length === 0) && (
                  <div className="tc-sub">No hay tarotistas para este checklist. (Si eres central, solo verás tu equipo.)</div>
                )}
              </div>
            </div>
          )}

          {/* Incidencias */}
          {tab === "incidencias" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">⚠️ Incidencias</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Descuenta en la factura del mes seleccionado.
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={loadTarotists} disabled={tarotistsLoading}>
                    {tarotistsLoading ? "Cargando…" : "Recargar tarotistas"}
                  </button>
                </div>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {tarotistsMsg || " "}
                {incMsg ? ` · ${incMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <input
                  className="tc-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar tarotista…"
                  style={{ width: 260, maxWidth: "100%" }}
                />

                <select
                  className="tc-select"
                  value={incWorkerId}
                  onChange={(e) => setIncWorkerId(e.target.value)}
                  style={{ minWidth: 360, width: 520, maxWidth: "100%" }}
                >
                  {(tarotistsFiltered || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name} {t.team_key ? `(${t.team_key})` : ""}
                    </option>
                  ))}
                  {(!tarotistsFiltered || tarotistsFiltered.length === 0) && <option value="">(Sin resultados)</option>}
                </select>

                <input
                  className="tc-input"
                  value={incAmount}
                  onChange={(e) => setIncAmount(e.target.value)}
                  style={{ width: 140 }}
                  placeholder="Importe"
                />

                <input
                  className="tc-input"
                  value={incReason}
                  onChange={(e) => setIncReason(e.target.value)}
                  style={{ width: 360, maxWidth: "100%" }}
                  placeholder="Motivo"
                />

                <button className="tc-btn tc-btn-danger" onClick={crearIncidencia} disabled={incLoading || !incWorkerId}>
                  {incLoading ? "Guardando…" : "Guardar incidencia"}
                </button>
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Seleccionada: <b>{selectedTarotist?.display_name || "—"}</b>{" "}
                {selectedTarotist?.team_key ? (
                  <>
                    · Equipo <b>{selectedTarotist.team_key}</b>
                  </>
                ) : null}
              </div>

              <div className="tc-sub" style={{ marginTop: 8 }}>
                Nota: para que se refleje en facturas, en Admin vuelves a generar facturas del mes.
              </div>
            </div>
          )}

          {/* Ranking */}
          {tab === "ranking" && (
            <div className="tc-card">
              <div className="tc-title">🏆 Top 3 del mes</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Captadas / %Cliente / %Repite {rankMsg ? `· ${rankMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-3">
                <TopCard title="Captadas" items={topCaptadas.map((x: any) => `${x.display_name} (${Number(x.captadas_total || 0)})`)} />
                <TopCard title="Cliente" items={topCliente.map((x: any) => `${x.display_name} (${pctAny(x.pct_cliente).toFixed(2)}%)`)} />
                <TopCard title="Repite" items={topRepite.map((x: any) => `${x.display_name} (${pctAny(x.pct_repite).toFixed(2)}%)`)} />
              </div>
            </div>
          )}
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
              maxWidth: 440,
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
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
                onClick={() => {
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

    </CentralThemeProvider>
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

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Cargando…</div>}>
      <ChatProvider>
        <CentralPage />
      </ChatProvider>
    </Suspense>
  );
}
