"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import TCToaster from "@/components/ui/TCToaster";

const sb = supabaseBrowser();

function monthLabelEs(monthKey: string) {
  const [y, m] = (monthKey || "").split("-").map((x) => Number(x));
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pathLabel(pathname: string) {
  if (!pathname) return "Panel";
  if (pathname === "/admin") return "Admin";
  if (pathname === "/panel-central") return "Centrales";
  if (pathname === "/panel-tarotista") return "Tarotista";
  return pathname.replaceAll("/", " · ").replace(/^ · /, "");
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

type HeaderNotif = {
  id: string;
  title: string;
  description: string;
  kind: "warning" | "info" | "success";
  ts?: string | null;
};

export default function AppHeader() {
  const [name, setName] = useState<string>("Cargando…");
  const [role, setRole] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [month, setMonth] = useState<string>(monthKeyNow());
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<HeaderNotif[]>([]);
  const [estado, setEstado] = useState<"online" | "offline" | "break">("offline");
  const [estadoLoading, setEstadoLoading] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const pathname = usePathname();

  // 🔹 Obtener usuario
  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });

    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

     const { data } = await sb.auth.getUser();
const user = data?.user;

if (!user) {
  window.location.href = "/login";
  return;
}

// 🔥 obtener rol desde tu tabla
const { data: worker } = await sb
  .from("workers")
  .select("role")
  .eq("user_id", user.id)
  .maybeSingle();

if (!worker) {
  window.location.href = "/login";
  return;
}

// 🔥 redirección
if (worker.role !== "admin") {
  window.location.href =
    worker.role === "central" ? "/panel-central" : "/panel-tarotista";
  return;
}

      if (me?.ok) {
        setName(me.display_name || "Usuario");
        setRole(me.role || "");
        setTeam(me.team || "");
        if (me.month_key) setMonth(me.month_key);
      }
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  // 🔥 Sync estado con attendance (igual que panel central)
  async function syncEstado() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/attendance/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json();

    if (j?.ok) {
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
    }
  }

  // cargar estado + polling
  useEffect(() => {
    syncEstado();
    const i = setInterval(syncEstado, 10000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadNotifications() {
      try {
        const { data } = await sb.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const requests = [
          fetch("/api/crm/reservas/proximas", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }).then((r) => safeJson(r)).catch(() => null),
        ];

        if (pathname === "/admin") {
          requests.push(
            fetch("/api/admin/crm/call-close-notifications/latest", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            }).then((r) => safeJson(r)).catch(() => null)
          );
        } else if (pathname === "/panel-central") {
          requests.push(
            fetch("/api/central/crm/call-close-notifications/latest", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            }).then((r) => safeJson(r)).catch(() => null)
          );
        }

        const results = await Promise.all(requests);
        const list: HeaderNotif[] = [];

        const reservasJ: any = results[0];
        const reserva = Array.isArray(reservasJ?.reservas) ? reservasJ.reservas[0] : null;
        if (reserva?.id) {
          list.push({
            id: `res-${reserva.id}`,
            title: "Reserva próxima",
            description: `${reserva?.cliente_nombre || "Cliente"} · ${reserva?.tarotista_display_name || reserva?.tarotista_nombre_manual || "Tarotista"}`,
            kind: "warning",
            ts: reserva?.fecha_reserva || null,
          });
        }

        const closeJ: any = results[1];
        const notif = closeJ?.notification || null;
        if (notif?.id) {
          list.push({
            id: `close-${notif.id}`,
            title: "Llamada cerrada",
            description: `${notif?.cliente_nombre || "Cliente"} · ${notif?.minutos_consumidos || 0} min consumidos`,
            kind: "info",
            ts: notif?.created_at || null,
          });
        }

        if (mounted) setNotifs(list);
      } catch {
        if (mounted) setNotifs([]);
      }
    }

    loadNotifications();
    const t = setInterval(loadNotifications, 15000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [pathname]);

  // 🔥 Botones sincronizados (attendance)
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
        body: JSON.stringify({
          event_type: nuevo === "break" ? "heartbeat" : nuevo,
        }),
      });

      await syncEstado();
    } catch (e) {
      console.error(e);
    } finally {
      setEstadoLoading(false);
    }
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  // ⏱ temporizador
  useEffect(() => {
    if (!startTime) return;
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, [startTime]);

  function formatTime(sec: number) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(v => String(v).padStart(2,"0")).join(":");
  }

  const roleText = useMemo(() => {
    if (role === "admin") return "Admin";
    if (role === "central") return "Central";
    if (role === "tarotista") return "Tarotista";
    return role || "Usuario";
  }, [role]);

  const teamText = useMemo(() => {
    if (!team) return "";
    if (team.toLowerCase().includes("fuego")) return "🔥 Equipo Fuego";
    if (team.toLowerCase().includes("agua")) return "💧 Equipo Agua";
    return team;
  }, [team]);

  return (
    <>
      <div style={{ position: "sticky", top: 0, zIndex: 80, backdropFilter: "blur(18px)",
        background: "linear-gradient(180deg, rgba(10,7,18,0.82), rgba(10,7,18,0.58))",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 16px 40px rgba(0,0,0,.22)" }}>
        <div className="tc-container" style={{ padding: "14px 18px" }}>
          <div className="tc-row" style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div className="tc-row" style={{ gap: 14, alignItems: "center" }}>
              <div style={{ width: 50, height: 50, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
                display: "grid", placeItems: "center", overflow: "hidden",
                boxShadow: "0 12px 28px rgba(0,0,0,.22)" }}>
                <Image src="/tarot-celestial-logo.png" alt="Tarot Celestial" width={38} height={38} />
              </div>

              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: 900, fontSize: 17 }}>Tarot Celestial</div>
                <div className="tc-sub" style={{ marginTop: 5 }}>
                  <b>{name}</b> · {roleText}{teamText ? ` · ${teamText}` : ""}
                </div>
                <div className="tc-sub" style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}>
                  {pathLabel(pathname || "")}
                </div>
              </div>
            </div>

            <div className="tc-row" style={{ gap: 10, flexWrap: "wrap", position: "relative" }}>
              <button className="tc-btn" onClick={() => setNotifOpen(v => !v)}>🔔</button>

              <div className="tc-row" style={{ gap: 6 }}>
                <button className={`tc-btn ${estado === "online" ? "tc-btn-ok" : ""}`}
                  onClick={() => cambiarEstado("online")} disabled={estadoLoading}>🟢 Conectado</button>

                <button className={`tc-btn ${estado === "break" ? "tc-btn-gold" : ""}`}
                  onClick={() => cambiarEstado("break")} disabled={estadoLoading}>⏸️ Descanso</button>

                <button className={`tc-btn ${estado === "offline" ? "tc-btn-danger" : ""}`}
                  onClick={() => cambiarEstado("offline")} disabled={estadoLoading}>🔴 Desconectado</button>
              </div>

              {estado === "online" && startTime && (
                <div className="tc-chip">⏱ {formatTime(elapsed)}</div>
              )}

              <button className="tc-btn tc-btn-gold" onClick={logout}>Salir</button>
            </div>
          </div>
        </div>
      </div>

      <TCToaster />
    </>
  );
}
