"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function teamLabel(t: string | null) {
  if (t === "fuego") return "Equipo Fuego (Yami)";
  if (t === "agua") return "Equipo Agua (Maria)";
  return "—";
}

export default function AppHeader() {
  const [me, setMe] = useState<any>(null);
  const [month, setMonth] = useState<string>(monthKeyNow());

  async function loadMe() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const j = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    setMe(j);
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function setState(state: string) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/work/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ state }),
    });
    await loadMe();
  }

  async function logout() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (token) await fetch("/api/work/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  const w = me?.worker;

  return (
    <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src="/tarot-celestial-logo.png" alt="Tarot Celestial" width={42} height={42} style={{ borderRadius: 12 }} />
          <div>
            <div style={{ fontWeight: 800 }}>Tarot Celestial</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {w?.display_name || "—"} · {w?.role || "—"} · {teamLabel(w?.team || null)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={w?.state || "offline"} onChange={(e) => setState(e.target.value)} style={{ padding: "8px 10px", borderRadius: 10 }}>
            <option value="online">online</option>
            <option value="offline">offline</option>
            <option value="pause">descanso</option>
            <option value="bathroom">baño</option>
          </select>

          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              // guardamos month en querystring para que luego stats/facturas lo lean
              const url = new URL(window.location.href);
              url.searchParams.set("month", e.target.value);
              window.history.replaceState({}, "", url.toString());
            }}
            style={{ padding: "8px 10px", borderRadius: 10 }}
          />

          <button onClick={logout} style={{ padding: "8px 12px", borderRadius: 10, cursor: "pointer" }}>
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
