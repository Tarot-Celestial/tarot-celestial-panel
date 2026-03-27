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

  const pathname = usePathname();

  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });

    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const me = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());

      if (me?.ok) {
        setName(me.display_name || "Usuario");
        setRole(me.role || "");
        setTeam(me.team || "");
        if (me.month_key) setMonth(me.month_key);
      }
    })();

    return () => sub.subscription.unsubscribe();
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

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/login";
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
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 80,
          backdropFilter: "blur(18px)",
          background:
            "linear-gradient(180deg, rgba(10,7,18,0.82), rgba(10,7,18,0.58))",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 16px 40px rgba(0,0,0,.22)",
        }}
      >
        <div className="tc-container" style={{ padding: "14px 18px" }}>
          <div
            className="tc-row"
            style={{ justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}
          >
            <div className="tc-row" style={{ gap: 14, alignItems: "center" }}>
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  boxShadow: "0 12px 28px rgba(0,0,0,.22)",
                }}
              >
                <Image
                  src="/tarot-celestial-logo.png"
                  alt="Tarot Celestial"
                  width={38}
                  height={38}
                />
              </div>

              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: ".01em" }}>
                  Tarot Celestial
                </div>
                <div className="tc-sub" style={{ marginTop: 5 }}>
                  <b>{name}</b> · {roleText}
                  {teamText ? ` · ${teamText}` : ""}
                </div>
                <div
                  className="tc-sub"
                  style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}
                >
                  {pathLabel(pathname || "")}
                </div>
              </div>
            </div>

            <div className="tc-row" style={{ gap: 10, flexWrap: "wrap", position: "relative" }}>
              <button
                className="tc-btn"
                onClick={() => setNotifOpen((v) => !v)}
                style={{ position: "relative", minWidth: 48 }}
                title="Notificaciones"
              >
                🔔
                {notifs.length > 0 ? (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      minWidth: 20,
                      height: 20,
                      borderRadius: 999,
                      background: "#ff5a6a",
                      color: "white",
                      fontSize: 11,
                      display: "grid",
                      placeItems: "center",
                      border: "2px solid rgba(10,7,18,0.85)",
                      fontWeight: 900,
                    }}
                  >
                    {notifs.length}
                  </span>
                ) : null}
              </button>

              {notifOpen ? (
                <div
                  style={{
                    position: "absolute",
                    top: 56,
                    right: 0,
                    width: 360,
                    maxWidth: "calc(100vw - 24px)",
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,.10)",
                    background: "rgba(14,10,24,.96)",
                    boxShadow: "0 28px 80px rgba(0,0,0,.42)",
                    padding: 12,
                    zIndex: 90,
                  }}
                >
                  <div className="tc-title" style={{ fontSize: 16 }}>🔔 Centro de notificaciones</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>Eventos recientes e importantes del panel.</div>
                  <div className="tc-hr" />
                  <div style={{ display: "grid", gap: 10 }}>
                    {notifs.length === 0 ? (
                      <div className="tc-sub">No hay alertas activas ahora mismo.</div>
                    ) : (
                      notifs.map((n) => (
                        <div
                          key={n.id}
                          style={{
                            borderRadius: 14,
                            padding: 12,
                            border:
                              n.kind === "warning"
                                ? "1px solid rgba(215,181,109,.24)"
                                : n.kind === "success"
                                ? "1px solid rgba(105,240,177,.24)"
                                : "1px solid rgba(181,156,255,.24)",
                            background:
                              n.kind === "warning"
                                ? "rgba(215,181,109,.10)"
                                : n.kind === "success"
                                ? "rgba(105,240,177,.08)"
                                : "rgba(181,156,255,.08)",
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{n.title}</div>
                          <div className="tc-sub" style={{ marginTop: 6 }}>{n.description}</div>
                          {n.ts ? (
                            <div className="tc-sub" style={{ marginTop: 6 }}>
                              {new Date(n.ts).toLocaleString("es-ES")}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              <div
                className="tc-chip"
                title={monthLabelEs(month)}
                style={{
                  padding: "9px 12px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {monthLabelEs(month)}
              </div>

              <input
                className="tc-input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                style={{ width: 132 }}
                title={monthLabelEs(month)}
              />

              <button className="tc-btn tc-btn-gold" onClick={logout}>
                Salir
              </button>
            </div>
          </div>
        </div>
      </div>

      <TCToaster />
    </>
  );
}

