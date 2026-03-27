"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

export default function AppHeader() {
  const [name, setName] = useState<string>("Cargando…");
  const [role, setRole] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [month, setMonth] = useState<string>(monthKeyNow());

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

          <div className="tc-row" style={{ gap: 10, flexWrap: "wrap" }}>
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
  );
}
