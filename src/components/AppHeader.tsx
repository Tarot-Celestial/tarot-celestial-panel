"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import TCToaster from "@/components/ui/TCToaster";

const sb = supabaseBrowser();

type HeaderNotif = {
  id: string;
  title: string;
  message?: string | null;
  read?: boolean | null;
  created_at?: string | null;
  synthetic?: boolean | null;
};

function pathLabel(pathname: string) {
  if (!pathname) return "Panel";
  if (pathname === "/admin") return "Admin";
  if (pathname === "/panel-central") return "Centrales";
  if (pathname === "/panel-tarotista") return "Tarotista";
  return pathname.replaceAll("/", " · ").replace(/^ · /, "");
}

export default function AppHeader() {
  const pathname = usePathname();

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
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  async function syncEstado() {
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/attendance/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return;

      const online = !!j.online;
      const status = j.status || (online ? "working" : "offline");

      if (!online) {
        setEstado("offline");
        setStartTime(null);
        return;
      }

      if (status === "break") {
        setEstado("break");
        setStartTime(null);
        return;
      }

      setEstado("online");
      if (j.last_event_at) {
        setStartTime(new Date(j.last_event_at).getTime());
      }
    } catch {
      // noop
    }
  }

  useEffect(() => {
    syncEstado();
    const i = setInterval(syncEstado, 10000);
    return () => clearInterval(i);
  }, []);

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
    } catch {
      setNotifications([]);
    }
  }

  useEffect(() => {
    if (!notifUserId) return;
    loadNotifications();
    const i = setInterval(loadNotifications, 15000);
    return () => clearInterval(i);
  }, [notifUserId]);

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

      await syncEstado();
    } finally {
      setEstadoLoading(false);
    }
  }

  async function logout() {
    await sb.auth.signOut();
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
        <div className="tc-container" style={{ padding: "14px 18px" }}>
          <div className="tc-row" style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div className="tc-row" style={{ gap: 14, alignItems: "center" }}>
              <div
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
                <Image src="/tarot-celestial-logo.png" alt="Tarot Celestial" width={38} height={38} />
              </div>

              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: 900, fontSize: 17 }}>Tarot Celestial</div>
                <div className="tc-sub" style={{ marginTop: 5 }}>
                  <b>{name}</b> · {roleText}
                  {teamText ? ` · ${teamText}` : ""}
                </div>
                <div className="tc-sub" style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}>
                  {pathLabel(pathname || "")}
                </div>
              </div>
            </div>

            <div className="tc-row" style={{ gap: 10, flexWrap: "wrap", position: "relative" }}>
              <div style={{ position: "relative" }}>
                <button className="tc-btn" onClick={() => setNotifOpen((v) => !v)}>
                  🔔
                  {unreadCount > 0 ? <span style={{ marginLeft: 6 }}>({unreadCount})</span> : null}
                </button>

                {notifOpen ? (
                  <div
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
                        onClick={() => markAsRead(String(n.id))}
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

              <div className="tc-row" style={{ gap: 6 }}>
                <button className={`tc-btn ${estado === "online" ? "tc-btn-ok" : ""}`} onClick={() => cambiarEstado("online")} disabled={estadoLoading}>
                  🟢 Conectado
                </button>
                <button className={`tc-btn ${estado === "break" ? "tc-btn-gold" : ""}`} onClick={() => cambiarEstado("break")} disabled={estadoLoading}>
                  ⏸️ Descanso
                </button>
                <button className={`tc-btn ${estado === "offline" ? "tc-btn-danger" : ""}`} onClick={() => cambiarEstado("offline")} disabled={estadoLoading}>
                  🔴 Desconectado
                </button>
              </div>

              {estado === "online" && startTime ? <div className="tc-chip">⏱ {formatTime(elapsed)}</div> : null}

              <button className="tc-btn tc-btn-gold" onClick={logout}>Salir</button>
            </div>
          </div>
        </div>
      </div>

      <TCToaster />
    </>
  );
}
