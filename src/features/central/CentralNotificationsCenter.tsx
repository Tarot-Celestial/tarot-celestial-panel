"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type Summary = { urgent: number; risk: number; reminders: number; resolved: number; unread: number };
type FilterKey = "all" | "urgent" | "attention" | "reminders" | "resolved";

const EMPTY_SUMMARY: Summary = { urgent: 0, risk: 0, reminders: 0, resolved: 0, unread: 0 };

function clientOf(notification: CentralNotification): ClientRef | null {
  const value = notification.crm_clientes;
  return Array.isArray(value) ? value[0] || null : value || null;
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
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

export function useCentralNotificationCount() {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const token = await authToken();
    if (!token) return;
    const brand = getActiveBrand();
    const response = await fetch(`/api/central/notifications?business=${brand}&page=1&page_size=10`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await response.json().catch(() => null);
    if (json?.ok) setCount(Number(json.summary?.unread || 0));
  }, []);

  useEffect(() => {
    void load();
    const onBrand = () => void load();
    window.addEventListener("tc-brand-changed", onBrand);
    const channel = sb
      .channel("central-notifications-menu-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "central_notifications" }, load)
      .subscribe();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener("tc-brand-changed", onBrand);
      window.clearInterval(timer);
      void sb.removeChannel(channel);
    };
  }, [load]);

  return count;
}

export default function CentralNotificationsCenter() {
  const router = useRouter();
  const [items, setItems] = useState<CentralNotification[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const token = await authToken();
    if (!token) return;
    setLoading(true);
    try {
      const brand = getActiveBrand();
      const params = new URLSearchParams({ business: brand, page: "1", page_size: "40" });
      if (filter === "urgent" || filter === "attention") params.set("priority", filter);
      if (filter === "resolved") params.set("state", "resolved");
      const response = await fetch(`/api/central/notifications?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar las notificaciones");
      let next = Array.isArray(json.data) ? (json.data as CentralNotification[]) : [];
      if (filter === "reminders") next = next.filter((item) => ["followup", "reminder", "important_date"].includes(item.type));
      setItems(next);
      setSummary(json.summary || EMPTY_SUMMARY);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las notificaciones");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const onBrand = () => void load();
    window.addEventListener("tc-brand-changed", onBrand);
    const channel = sb
      .channel("central-notifications-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "central_notifications" }, load)
      .subscribe();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener("tc-brand-changed", onBrand);
      window.clearInterval(timer);
      void sb.removeChannel(channel);
    };
  }, [load]);

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
            <div className={styles.featuredMeta}>{formatDate(featured.scheduled_at || featured.created_at)}</div>
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
          <p>{summary.unread} notificaciones pendientes o no leídas.</p>
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
                  <span>{formatDate(item.scheduled_at || item.created_at)}</span>
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
