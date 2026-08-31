"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import TCToaster from "@/components/ui/TCToaster";
import BrandSwitcher from "@/components/global/BrandSwitcher";
import { tcToast } from "@/lib/tc-toast";
import { useAttendance } from "@/hooks/useAttendance";
import styles from "./AppHeader.module.css";

const sb = supabaseBrowser();

type HeaderNotif = {
  id: string;
  title: string;
  message?: string | null;
  read?: boolean | null;
  created_at?: string | null;
  synthetic?: boolean | null;
  kind?: string | null;
  client_id?: string | null;
};

function pathLabel(pathname: string) {
  if (!pathname) return "Panel";
  if (pathname === "/admin") return "Admin";
  if (pathname === "/panel-central") return "Centrales";
  if (pathname === "/panel-tarotista") return "Tarotista";
  return pathname.replaceAll("/", " · ").replace(/^ · /, "");
}

type AppHeaderIdentity = {
  display_name?: string | null;
  role?: string | null;
  team?: string | null;
  worker?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
};

type AppHeaderProps = {
  onIdentityLoaded?: (identity: AppHeaderIdentity) => void;
};

export default function AppHeader({ onIdentityLoaded }: AppHeaderProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const attendance = useAttendance();

  const [name, setName] = useState("Cargando…");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotif[]>([]);
  const [notifUserId, setNotifUserId] = useState<string>("");
  const [estado, setEstado] = useState<"online" | "offline" | "break">("offline");
  const [estadoLoading, setEstadoLoading] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const lastLeadToastIdRef = useRef("");
  const [leadPopup, setLeadPopup] = useState<HeaderNotif | null>(null);

  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });

    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const me = await meRes.json().catch(() => null);
      if (!me?.ok) return;

      setName(me.display_name || "Usuario");
      setRole(me.role || "");
      setTeam(me.team || "");
      setNotifUserId(String(me?.user?.id || me?.id || ""));
      onIdentityLoaded?.(me);
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!attendance.online) {
      setEstado("offline");
      setStartTime(null);
      return;
    }
    const status = String(attendance.status || "working").toLowerCase();
    if (["break", "bathroom", "paused"].includes(status)) {
      setEstado("break");
      setStartTime(null);
      return;
    }
    setEstado("online");
    setStartTime(attendance.lastEventAt ? new Date(attendance.lastEventAt).getTime() : Date.now());
  }, [attendance.lastEventAt, attendance.online, attendance.status]);

  async function loadNotifications() {
    if (!notifUserId) return;
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`/api/notifications/list?user_id=${encodeURIComponent(notifUserId)}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const j = await res.json().catch(() => null);
      const notifData = Array.isArray(j?.data) ? j.data : [];
      setNotifications(notifData);

      const latestUnreadLead = notifData.find(
        (n: any) => !n?.read && (String(n?.kind || "") === "lead" || /lead de facebook/i.test(String(n?.title || "")))
      );

      if (latestUnreadLead?.id && String(latestUnreadLead.id) !== String(lastLeadToastIdRef.current || "")) {
        lastLeadToastIdRef.current = String(latestUnreadLead.id);
        tcToast({
          title: latestUnreadLead.title || "🔥 Nuevo lead",
          description: latestUnreadLead.message || "Ha entrado un lead nuevo y conviene llamarlo cuanto antes.",
          tone: "warning",
          duration: 6500,
        });
        if (["admin", "central"].includes(String(role || ""))) {
          setLeadPopup(latestUnreadLead);
        }
      }

      const latestUnreadRank = notifData.find(
        (n: any) => !n?.read && String(n?.kind || "") === "rank_upgrade"
      );
      if (latestUnreadRank?.id && String(latestUnreadRank.id) !== String((window as any).__lastRankToastId || "")) {
        (window as any).__lastRankToastId = String(latestUnreadRank.id);
        tcToast({
          title: latestUnreadRank.title || "🏅 Cambio de rango",
          description: latestUnreadRank.message || "Un cliente ha cambiado de rango.",
          tone: "success",
          duration: 7000,
        });
      }
    } catch {
      setNotifications([]);
    }
  }

  useEffect(() => {
    if (!notifUserId) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    refreshVisible();
    // Las inserciones ya llegan por Realtime; el sondeo queda como respaldo.
    const i = window.setInterval(refreshVisible, 120000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(i);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [notifUserId, role]);

  useEffect(() => {
    if (!notifUserId || !["admin", "central"].includes(String(role || ""))) return;

    const channel = sb
      .channel(`header-notifications-${notifUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${notifUserId}`,
        },
        (payload: any) => {
          const notif = payload?.new || {};
          setNotifications((prev) => [notif, ...prev].slice(0, 20));

          if (String(notif?.kind || "") === "lead" || /lead de facebook/i.test(String(notif?.title || ""))) {
            if (String(notif?.id || "") === String(lastLeadToastIdRef.current || "")) return;
            lastLeadToastIdRef.current = String(notif?.id || "");
            setLeadPopup(notif);
            tcToast({
              title: notif?.title || "🔥 Nuevo lead",
              description: notif?.message || "Ha entrado un lead nuevo y conviene llamarlo cuanto antes.",
              tone: "warning",
              duration: 6500,
            });
            return;
          }

          if (String(notif?.kind || "") === "rank_upgrade") {
            tcToast({
              title: notif?.title || "🏅 Cambio de rango",
              description: notif?.message || "Un cliente ha cambiado de rango.",
              tone: "success",
              duration: 7000,
            });
          }
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [notifUserId, role]);

  async function markAsRead(id: string) {
    try {
      if (String(id).startsWith("virtual:")) {
        setNotifications((prev) => prev.map((n) => (String(n.id) === String(id) ? { ...n, read: true } : n)));
        return;
      }
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) => prev.map((n) => (String(n.id) === String(id) ? { ...n, read: true } : n)));
    } catch {
      // noop
    }
  }

  async function cambiarEstado(nuevo: "online" | "offline" | "break") {
    try {
      setEstadoLoading(true);
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      await fetch("/api/attendance/event", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_type: nuevo === "break" ? "heartbeat" : nuevo }),
      });

      attendance.refreshAttendance();
      window.dispatchEvent(new CustomEvent("tc-attendance-changed"));
    } finally {
      setEstadoLoading(false);
    }
  }

  async function logout() {
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        await fetch("/api/attendance/event", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ event_type: "offline" }),
        }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("tc-attendance-changed"));
    } catch {
      // noop
    }

    await sb.auth.signOut();
    window.dispatchEvent(new CustomEvent("tc-attendance-changed"));
    window.location.href = "/login";
  }

  useEffect(() => {
    if (!startTime) return;
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(i);
  }, [startTime]);

  function formatTime(sec: number) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  const roleText = useMemo(() => {
    if (role === "admin") return "Admin";
    if (role === "central") return "Central";
    if (role === "tarotista") return "Tarotista";
    return role || "Usuario";
  }, [role]);

  const teamText = useMemo(() => {
    if (!team) return "";
    const low = String(team).toLowerCase();
    if (low.includes("fuego")) return "🔥 Equipo Fuego";
    if (low.includes("agua")) return "💧 Equipo Agua";
    return team;
  }, [team]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <div
        className={styles.shell}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 80,
          backdropFilter: "blur(18px)",
          background: "linear-gradient(180deg, rgba(10,7,18,0.82), rgba(10,7,18,0.58))",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 16px 40px rgba(0,0,0,.22)",
        }}
      >
        <div className={`tc-container ${styles.inner}`} style={{ padding: "14px 18px" }}>
          <div className={`tc-row ${styles.layout}`} style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div className={`tc-row ${styles.identity}`} style={{ gap: 14, alignItems: "center" }}>
              <div
                className={styles.logo}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  boxShadow: "0 12px 28px rgba(0,0,0,.22)",
                }}
              >
                <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={38} height={38} />
              </div>

              <div className={styles.identityText} style={{ lineHeight: 1.15 }}>
                <div className={styles.productName} style={{ fontWeight: 900, fontSize: 17 }}>Tarot Celestial</div>
                <div className={`${styles.operator} tc-sub`} style={{ marginTop: 5 }}>
                  <b>{name}</b> · {roleText}
                  {teamText ? ` · ${teamText}` : ""}
                </div>
                <div className={`${styles.route} tc-sub`} style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}>
                  {pathLabel(pathname || "")}
                </div>
              </div>
            </div>

            <div className={`tc-row ${styles.controls}`} style={{ gap: 10, flexWrap: "wrap", position: "relative" }}>
              <BrandSwitcher />
              <div className={styles.notificationWrap} style={{ position: "relative" }}>
                <button className={styles.holoButton} onClick={() => setNotifOpen((v) => !v)} aria-label="Abrir notificaciones" aria-expanded={notifOpen}>
                  🔔
                  {unreadCount > 0 ? <span style={{ marginLeft: 6 }}>({unreadCount})</span> : null}
                </button>

                {notifOpen ? (
                  <div
                    className={styles.notificationPanel}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 48,
                      width: 340,
                      maxHeight: 420,
                      overflowY: "auto",
                      borderRadius: 18,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(16, 12, 28, 0.98)",
                      boxShadow: "0 24px 60px rgba(0,0,0,.38)",
                      padding: 10,
                    }}
                  >
                    <div className="tc-sub" style={{ marginBottom: 8, fontWeight: 800 }}>
                      Notificaciones
                    </div>
                    {!notifications.length ? <div className="tc-sub">No hay notificaciones</div> : null}
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          void markAsRead(String(n.id));
                          if (n.kind === "client_followup" && n.client_id) {
                            setNotifOpen(false);
                            router.push(`/panel-central?tab=mis-clientas&cliente=${encodeURIComponent(String(n.client_id))}`);
                          }
                        }}
                        style={{
                          cursor: "pointer",
                          padding: 10,
                          borderRadius: 14,
                          marginBottom: 8,
                          background: n.read ? "rgba(255,255,255,0.03)" : "rgba(181,156,255,0.10)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{n.title || "Notificación"}</div>
                        {n.message ? <div className="tc-sub" style={{ marginTop: 4 }}>{n.message}</div> : null}
                        {n.created_at ? (
                          <div className="tc-sub" style={{ marginTop: 6, opacity: 0.7 }}>
                            {new Date(n.created_at).toLocaleString("es-ES")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={`tc-row ${styles.states}`} style={{ gap: 6 }} aria-label="Estado operativo">
                <button className={`${styles.stateButton} ${styles.online} ${estado === "online" ? styles.activeOnline : ""}`} onClick={() => cambiarEstado("online")} disabled={estadoLoading} aria-pressed={estado === "online"}>
                  <span className={styles.led} aria-hidden="true" /> Conectado
                </button>
                <button className={`${styles.stateButton} ${styles.break} ${estado === "break" ? styles.activeBreak : ""}`} onClick={() => cambiarEstado("break")} disabled={estadoLoading} aria-pressed={estado === "break"}>
                  <span className={styles.led} aria-hidden="true" /> Descanso
                </button>
                <button className={`${styles.stateButton} ${styles.offline} ${estado === "offline" ? styles.activeOffline : ""}`} onClick={() => cambiarEstado("offline")} disabled={estadoLoading} aria-pressed={estado === "offline"}>
                  <span className={styles.led} aria-hidden="true" /> Desconectado
                </button>
              </div>

              {estado === "online" && startTime ? <div className={styles.timer} aria-label={`Tiempo conectado: ${formatTime(elapsed)}`}><span className={styles.timerDot} aria-hidden="true" />{formatTime(elapsed)}</div> : null}

              <button className={styles.logout} onClick={logout}>Salir</button>
            </div>
          </div>
        </div>
      </div>

      {["admin", "central"].includes(String(role || "")) && leadPopup ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.52)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div style={{ width: "min(92vw, 520px)", borderRadius: 24, border: "1px solid rgba(255,255,255,0.14)", background: "linear-gradient(180deg, rgba(28,18,44,0.98), rgba(15,10,28,0.98))", boxShadow: "0 28px 80px rgba(0,0,0,.45)", padding: 22 }}>
            <div style={{ fontSize: 28, fontWeight: 900 }}>🔥 Nuevo lead</div>
            <div className="tc-sub" style={{ marginTop: 10, fontSize: 15 }}>Ha entrado un lead nuevo en captación. Conviene llamarlo ahora mismo.</div>
            {leadPopup?.message ? <div style={{ marginTop: 14, fontWeight: 700 }}>{leadPopup.message}</div> : null}
            <div className="tc-row" style={{ marginTop: 18, gap: 10, flexWrap: "wrap" }}>
              <button className="tc-btn" onClick={() => { if (leadPopup?.id) markAsRead(String(leadPopup.id)); setLeadPopup(null); }}>Cerrar</button>
              <button className="tc-btn tc-btn-ok" onClick={() => { window.dispatchEvent(new CustomEvent("tc-open-captacion")); if (leadPopup?.id) markAsRead(String(leadPopup.id)); setLeadPopup(null); }}>Ir a captación</button>
            </div>
          </div>
        </div>
      ) : null}

      <TCToaster />
    </>
  );
}
