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

  const roleLabel = useMemo(() => {
    if (role === "admin") return "Admin";
    if (role === "central") return "Centrales";
    if (role === "tarotista") return "Tarotista";
    return role || "Usuario";
  }, [role]);

  const teamLabel = useMemo(() => {
    if (!team) return "";
    if (team.toLowerCase().includes("fuego")) return "🔥 Equipo Fuego";
    if (team.toLowerCase().includes("agua")) return "💧 Equipo Agua";
    return team;
  }, [team]);

  return (
    <header className="tc-header">
      <div className="tc-header-inner">
        <div className="tc-header-brand">
          <div className="tc-header-logo-wrap">
            <Image src="/tarot-celestial-logo.png" alt="Tarot Celestial" width={38} height={38} />
          </div>

          <div>
            <div className="tc-header-title">Tarot Celestial</div>
            <div className="tc-header-subtitle">
              <span className="tc-header-user">{name}</span>
              <span className="tc-header-dot">•</span>
              <span>{roleLabel}</span>
              {teamLabel ? (
                <>
                  <span className="tc-header-dot">•</span>
                  <span>{teamLabel}</span>
                </>
              ) : null}
              {pathname ? (
                <>
                  <span className="tc-header-dot">•</span>
                  <span>{pathname}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="tc-header-actions">
          <div className="tc-header-month">
            <span className="tc-chip tc-chip-soft">Mes activo</span>
            <input
              className="tc-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ width: 138 }}
              title={monthLabelEs(month)}
            />
          </div>

          <button className="tc-btn tc-btn-gold" onClick={logout}>
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}

  );
}
