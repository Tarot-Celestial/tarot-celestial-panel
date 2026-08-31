"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, Clock3, Gift, Info, ShieldAlert, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import styles from "./CentralNotificationsCenter.module.css";

const sb = supabaseBrowser();

type NotificationPriority = "urgent" | "attention" | "info" | "success" | "reward";
type NotificationState = "pending" | "read" | "resolved";

type ClientRef = { id: string; nombre?: string | null; apellido?: string | null; telefono?: string | null };
export type CentralNotification = {
  id: string;
  business: string;
  client_id?: string | null;
  type: string;
  priority: NotificationPriority;
  title: string;
  description?: string | null;
  action_label?: string | null;
  action_path?: string | null;
  state: NotificationState;
  scheduled_at?: string | null;
  read_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  crm_clientes?: ClientRef | ClientRef[] | null;
};

export type CentralNotificationSummary = { urgent: number; risk: number; reminders: number; resolved: number; unread: number; pending?: number; information?: number; active?: number; today_pending?: number };
type FilterKey = "all" | "urgent" | "attention" | "reminders" | "resolved";

const EMPTY_SUMMARY: CentralNotificationSummary = { urgent: 0, risk: 0, reminders: 0, resolved: 0, unread: 0, pending: 0, information: 0, active: 0, today_pending: 0 };

function clientOf(notification: CentralNotification): ClientRef | null {
  const value = notification.crm_clientes;
  return Array.isArray(value) ? value[0] || null : value || null;
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });
}

function relativeDue(value: string | null | undefined, now: number) {
  if (!value) return "Sin fecha programada";
  const due = new Date(value).getTime();
  if (!Number.isFinite(due)) return "Fecha no disponible";
  const diffMinutes = Math.round((due - now) / 60_000);
  const absolute = Math.abs(diffMinutes);
  if (diffMinutes === 0) return "Ahora";
  if (diffMinutes > 0) {
    if (absolute < 60) return `Faltan ${absolute} min`;
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    return `Faltan ${hours} h${minutes ? ` ${minutes} min` : ""}`;
  }
  if (absolute < 60) return `Vencido hace ${absolute} min`;
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `Vencido hace ${hours} h${minutes ? ` ${minutes} min` : ""}`;
}

function priorityIcon(priority: NotificationPriority) {
  if (priority === "urgent") return ShieldAlert;
  if (priority === "attention") return AlertTriangle;
  if (priority === "success") return CheckCircle2;
  if (priority === "reward") return Gift;
  return Info;
}

async function authToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

export type CentralNotificationsFeed = {
  items: CentralNotification[];
  summary: CentralNotificationSummary;
  loading: boolean;
  error: string;
  now: number;
  reload: () => Promise<void>;
};

export function useCentralNotificationsFeed(): CentralNotificationsFeed {
  const [items, setItems] = useState<CentralNotification[]>([]);
  const [summary, setSummary] = useState<CentralNotificationSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const task = (async () => {
    const token = await authToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const brand = getActiveBrand();
      const params = new URLSearchParams({ business: brand, page: "1", page_size: "40" });
      const response = await fetch(`/api/central/notifications?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar las notificaciones");
      setItems(Array.isArray(json.data) ? (json.data as CentralNotification[]) : []);
      setSummary(json.summary || EMPTY_SUMMARY);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las notificaciones");
    } finally {
      setLoading(false);
    }
    })();
    inFlightRef.current = task;
    try {
      await task;
    } finally {
      if (inFlightRef.current === task) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void reload();
    const onBrand = () => void reload();
    const onFollowUp = () => void reload();
    window.addEventListener("tc-brand-changed", onBrand);
    window.addEventListener("tc-followup-changed", onFollowUp);
    const channel = sb
      .channel("central-notifications-shared")
      .on("postgres_changes", { event: "*", schema: "public", table: "central_notifications" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_followups" }, reload)
      .subscribe();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      void reload();
    }, 120_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("tc-brand-changed", onBrand);
      window.removeEventListener("tc-followup-changed", onFollowUp);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      void sb.removeChannel(channel);
    };
  }, [reload]);

  return { items, summary, loading, error, now, reload };
}

export function useCentralNotificationCount() {
  const feed = useCentralNotificationsFeed();
  return Number(feed.summary.active ?? feed.summary.pending ?? feed.summary.unread ?? 0);
}

type CentralNotificationsCenterProps = {
  feed: CentralNotificationsFeed;
};

export default function CentralNotificationsCenter({ feed }: CentralNotificationsCenterProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");
  const { items: allItems, summary, loading, error, now, reload: load } = feed;

  const items = useMemo(() => {
    if (filter === "urgent") return allItems.filter((item) => item.priority === "urgent" && item.state !== "resolved");
    if (filter === "attention") return allItems.filter((item) => item.priority === "attention" && item.state !== "resolved");
    if (filter === "reminders") return allItems.filter((item) => ["followup", "reminder", "important_date"].includes(item.type) && item.state !== "resolved");
    if (filter === "resolved") return allItems.filter((item) => item.state === "resolved");
    return allItems;
  }, [allItems, filter]);

  /* Data loading and Realtime are centralized in useCentralNotificationsFeed(). */
  /* Keep the existing rendering and actions unchanged. */

  const featured = useMemo(
    () => items.find((item) => item.state !== "resolved" && item.priority === "urgent") || null,
    [items]
  );

  async function updateState(item: CentralNotification, action: "read" | "resolve" | "reopen") {
    const token = await authToken();
    if (!token) return;
    const response = await fetch("/api/central/notifications", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, action }),
    });
    if (response.ok) await load();
  }

  async function openItem(item: CentralNotification) {
    if (item.state === "pending") await updateState(item, "read");
    const client = clientOf(item);
    const target = item.action_path || (client?.id ? `/panel-central?tab=mis-clientas&cliente=${encodeURIComponent(client.id)}` : "");
    if (target) router.push(target);
  }

  const cards: Array<{ key: FilterKey; label: string; value: number; icon: typeof Bell }> = [
    { key: "urgent", label: "Urgentes", value: summary.urgent, icon: ShieldAlert },
    { key: "attention", label: "En riesgo", value: summary.risk, icon: AlertTriangle },
    { key: "reminders", label: "Recordatorios", value: summary.reminders, icon: Clock3 },
    { key: "resolved", label: "Resueltas", value: summary.resolved, icon: CheckCircle2 },
  ];

  return (
    <section className={styles.page} aria-labelledby="notifications-title">
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}><Sparkles size={15} /> CENTRO OPERATIVO</div>
          <h1 id="notifications-title">Notificaciones</h1>
          <p>Mantente al día y cuida a tus clientas.</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
          <Bell size={17} /> {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      <div className={styles.summaryGrid}>
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button key={card.key} type="button" className={`${styles.summaryCard} ${filter === card.key ? styles.summaryCardActive : ""}`} onClick={() => setFilter(filter === card.key ? "all" : card.key)}>
              <Icon size={21} />
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </button>
          );
        })}
      </div>

      {featured ? (
        <article className={styles.featured}>
          <div className={styles.featuredIcon}><ShieldAlert size={28} /></div>
          <div className={styles.featuredBody}>
            <span className={styles.urgentLabel}>URGENTE</span>
            <h2>{featured.title}</h2>
            <p>{featured.description || "Esta alerta requiere atención prioritaria."}</p>
            <div className={styles.featuredMeta}>{formatDate(featured.scheduled_at || featured.created_at)} · {relativeDue(featured.scheduled_at, now)}</div>
          </div>
          <div className={styles.featuredActions}>
            <button type="button" onClick={() => void openItem(featured)}>{featured.action_label || "Ver clienta"}<ChevronRight size={17} /></button>
            <button type="button" className={styles.resolveButton} onClick={() => void updateState(featured, "resolve")}>Marcar seguimiento completado</button>
          </div>
        </article>
      ) : null}

      <div className={styles.listHeader}>
        <div>
          <h2>Actividad pendiente</h2>
          <p>{summary.active ?? 0} activas ahora · {summary.today_pending ?? 0} pendientes de hoy o vencidas.</p>
        </div>
        {filter !== "all" ? <button type="button" onClick={() => setFilter("all")}>Limpiar filtro</button> : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !items.length ? <div className={styles.empty}><Bell size={26} /><strong>No hay notificaciones en este filtro</strong><span>Las nuevas alertas aparecerán aquí automáticamente.</span></div> : null}

      <div className={styles.list}>
        {items.map((item) => {
          const Icon = priorityIcon(item.priority);
          const client = clientOf(item);
          return (
            <article key={item.id} className={`${styles.item} ${styles[item.priority]} ${item.state === "resolved" ? styles.resolved : ""}`}>
              <div className={styles.itemIcon}><Icon size={20} /></div>
              <div className={styles.itemBody}>
                <div className={styles.itemTop}>
                  <div>
                    <span className={styles.type}>{item.type.replaceAll("_", " ")}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <span className={styles.state}>{item.state === "pending" ? "Pendiente" : item.state === "read" ? "Leída" : "Resuelta"}</span>
                </div>
                {item.description ? <p>{item.description}</p> : null}
                <div className={styles.meta}>
                  <span>{formatDate(item.scheduled_at || item.created_at)} · {relativeDue(item.scheduled_at, now)}</span>
                  {client ? <span>{[client.nombre, client.apellido].filter(Boolean).join(" ") || "Clienta"}</span> : null}
                </div>
              </div>
              <div className={styles.itemActions}>
                {(item.action_path || client?.id) ? <button type="button" onClick={() => void openItem(item)}>{item.action_label || "Abrir"}<ChevronRight size={16} /></button> : null}
                {item.state !== "resolved" ? <button type="button" onClick={() => void updateState(item, "resolve")}>Resolver</button> : <button type="button" onClick={() => void updateState(item, "reopen")}>Reabrir</button>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
