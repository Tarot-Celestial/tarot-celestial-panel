"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
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

export default function AppHeader() {
  const [name, setName] = useState<string>("Cargando…");
  const [role, setRole] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [month, setMonth] = useState<string>(monthKeyNow());

  const pathname = usePathname();

  useEffect(() => {
    // Si realmente se pierde la sesión, ahí sí mandamos a login
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });

    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return; // IMPORTANT: no redirects aquí

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

  function roleLabel(r: string) {
    if (r === "admin") return "admin";
    if (r === "central") return "central";
    if (r === "tarotista") return "tarotista";
    return r || "usuario";
  }

  function teamLabel(t: string) {
    if (!t) return "";
    if (t.toLowerCase().includes("fuego")) return "🔥 Equipo Fuego";
    if (t.toLowerCase().includes("agua")) return "💧 Equipo Agua";
    return t;
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(10px)",
        background: "rgba(11,7,20,0.55)",
        borderBottom: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <div className="tc-container" style={{ padding: "12px 16px" }}>
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          {/* IZQUIERDA */}
          <div className="tc-row" style={{ gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
              }}
            >
              <Image src="/tarot-celestial-logo.png" alt="Tarot Celestial" width={36} height={36} />
            </div>

            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>Tarot Celestial</div>
              <div className="tc-sub">
                <b>{name}</b> · {roleLabel(role)}
                {team ? ` · ${teamLabel(team)}` : ""}
                {pathname ? ` · ${pathname}` : ""}
              </div>
            </div>
          </div>

          {/* DERECHA */}
          <div className="tc-row" style={{ gap: 10 }}>
            <input
              className="tc-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ width: 140 }}
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
