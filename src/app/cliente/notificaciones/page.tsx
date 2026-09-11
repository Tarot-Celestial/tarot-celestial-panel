"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Check, CheckCheck, Coins, RefreshCw, ShoppingBag, Sparkles, TicketCheck, Trophy } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./Notifications.module.css";

const sb = supabaseClienteBrowser();

type NotificationItem = {
  id: string;
  titulo?: string | null;
  mensaje?: string | null;
  tipo?: string | null;
  leida?: boolean | null;
  created_at?: string | null;
  meta?: Record<string, unknown> | null;
};

type NotificationPresentation = {
  label: string;
  href: string | null;
  action: string | null;
  tone: "gold" | "violet" | "green" | "rose";
  icon: typeof BellRing;
};

function formatDate(value?: string | null) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function presentation(item: NotificationItem): NotificationPresentation {
  const content = `${item.tipo || ""} ${item.titulo || ""} ${item.mensaje || ""}`.toLowerCase();
  if (content.includes("sorteo") || content.includes("premiad")) {
    return { label: "Sorteo", href: "/cliente/sorteo", action: "Ver premio", tone: "green", icon: Trophy };
  }
  if (content.includes("compra") || content.includes("pago")) {
    return { label: "Compra", href: "/cliente/precios-ofertas", action: "Ver compras", tone: "gold", icon: ShoppingBag };
  }
  if (content.includes("ruleta") || content.includes("giro")) {
    return { label: "Ruleta", href: "/cliente/ruleta", action: "Abrir ruleta", tone: "violet", icon: TicketCheck };
  }
  if (content.includes("coin") || content.includes("obsequio") || content.includes("regalo")) {
    return { label: "Recompensa", href: "/cliente/dashboard#saldo-coins", action: "Ver saldo", tone: "gold", icon: Coins };
  }
  if (content.includes("oráculo") || content.includes("oraculo") || content.includes("tirada")) {
    return { label: "Oráculo", href: "/cliente/oraculo", action: "Abrir Oráculo", tone: "violet", icon: Sparkles };
  }
  return { label: "Aviso", href: null, action: null, tone: "rose", icon: BellRing };
}

export default function ClienteNotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/cliente/login";
        return;
      }
      const response = await fetch("/api/cliente/notificaciones?limit=100", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No hemos podido cargar tus notificaciones.");
      setItems(Array.isArray(json.data) ? json.data : []);
      setUnreadCount(Number(json.unread_count || 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No hemos podido cargar tus notificaciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const visibleItems = useMemo(
    () => (filter === "unread" ? items.filter((item) => !item.leida) : items),
    [filter, items],
  );

  async function markRead(id?: string) {
    try {
      setBusy(id || "all");
      setError("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Tu sesión ha caducado.");
      const response = await fetch("/api/cliente/notificaciones/read", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo actualizar la notificación.");
      setItems((current) => current.map((item) => (!id || item.id === id ? { ...item, leida: true } : item)));
      setUnreadCount((current) => (id ? Math.max(0, current - (items.find((item) => item.id === id && !item.leida) ? 1 : 0)) : 0));
      window.dispatchEvent(new Event("tc-client-notifications-change"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la notificación.");
    } finally {
      setBusy("");
    }
  }

  return (
    <ClienteLayout
      title="Notificaciones"
      subtitle="Aquí encontrarás tus compras, Coins, giros, premios y avisos importantes."
      summaryItems={[
        { label: "Sin leer", value: String(unreadCount), meta: unreadCount ? "Novedades pendientes" : "Todo está al día", tone: "alerts" },
        { label: "Total reciente", value: String(items.length), meta: "Actividad guardada en tu cuenta" },
      ]}
    >
      <main className={styles.shell}>
        <section className={styles.toolbar} aria-labelledby="notifications-heading">
          <div>
            <span className={styles.eyrow}><Sparkles size={15} /> CENTRO DE NOVEDADES</span>
            <h1 id="notifications-heading">Todo lo importante, en un solo lugar</h1>
            <p>Los avisos se generan con movimientos reales de tu cuenta.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={() => void load()} disabled={loading || busy !== ""}>
              <RefreshCw size={16} /> Actualizar
            </button>
            {unreadCount > 0 ? (
              <button className={styles.primaryAction} type="button" onClick={() => void markRead()} disabled={busy !== ""}>
                <CheckCheck size={16} /> {busy === "all" ? "Marcando…" : "Marcar todo leído"}
              </button>
            ) : null}
          </div>
        </section>

        <div className={styles.filters} role="group" aria-label="Filtrar notificaciones">
          <button type="button" aria-pressed={filter === "all"} data-active={filter === "all"} onClick={() => setFilter("all")}>
            Todas <span>{items.length}</span>
          </button>
          <button type="button" aria-pressed={filter === "unread"} data-active={filter === "unread"} onClick={() => setFilter("unread")}>
            No leídas <span>{unreadCount}</span>
          </button>
        </div>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {loading ? <div className={styles.empty}>Cargando tus notificaciones…</div> : null}
        {!loading && visibleItems.length === 0 ? (
          <div className={styles.empty}>
            <span><CheckCheck size={27} /></span>
            <strong>{filter === "unread" ? "No tienes avisos pendientes" : "Todavía no hay notificaciones"}</strong>
            <p>{filter === "unread" ? "Has revisado todas tus novedades." : "Tus compras, giros y premios aparecerán aquí."}</p>
          </div>
        ) : null}

        <section className={styles.list} aria-label="Listado de notificaciones">
          {visibleItems.map((item) => {
            const view = presentation(item);
            const Icon = view.icon;
            return (
              <article key={item.id} className={styles.card} data-read={item.leida ? "true" : "false"} data-tone={view.tone}>
                <div className={styles.icon}><Icon size={22} /></div>
                <div className={styles.content}>
                  <div className={styles.cardTop}>
                    <span className={styles.category}>{view.label}</span>
                    <time dateTime={item.created_at || undefined}>{formatDate(item.created_at)}</time>
                  </div>
                  <h2>{item.titulo || "Notificación de Tarot Celestial"}</h2>
                  <p>{item.mensaje || "Tienes una novedad en tu cuenta."}</p>
                  <div className={styles.cardActions}>
                    {view.href ? <Link href={view.href}>{view.action}</Link> : null}
                    {!item.leida ? (
                      <button type="button" onClick={() => void markRead(item.id)} disabled={busy !== ""}>
                        <Check size={15} /> {busy === item.id ? "Marcando…" : "Marcar como leída"}
                      </button>
                    ) : <span className={styles.readState}><CheckCheck size={14} /> Leída</span>}
                  </div>
                </div>
                {!item.leida ? <span className={styles.unreadDot} aria-label="No leída" /> : null}
              </article>
            );
          })}
        </section>
      </main>
    </ClienteLayout>
  );
}

