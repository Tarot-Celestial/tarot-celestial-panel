"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthFromUrl() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("month") || monthKeyNow();
  } catch {
    return monthKeyNow();
  }
}

export default function Tarotista() {
  const [ok, setOk] = useState(false);
  const [month, setMonth] = useState(monthKeyNow());
  const [stats, setStats] = useState<any>(null);
  const [rank, setRank] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "tarotista") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-central";
        return;
      }

      setMonth(getMonthFromUrl());
      setOk(true);
    })();
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const m = getMonthFromUrl();
      setMonth(m);

      const s = await fetch(`/api/stats/monthly?month=${encodeURIComponent(m)}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      const rnk = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(m)}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());

      setStats(s);
      setRank(rnk);
    })();
  }, [ok]);

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  const s = stats?.stats;
  return (
    <>
      <AppHeader />
      <div style={{ padding: 24, display: "grid", gap: 14 }}>
        <div style={{ opacity: 0.75, fontSize: 12 }}>Mes: {month}</div>

        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>📊 Mis estadísticas</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
            <div>Minutos: <b>{Number(s?.minutes_total || 0).toFixed(2)}</b></div>
            <div>Captadas: <b>{Number(s?.captadas_total || 0)}</b></div>
            <div>% Cliente: <b>{Number(s?.pct_cliente || 0).toFixed(2)}%</b></div>
            <div>% Repite: <b>{Number(s?.pct_repite || 0).toFixed(2)}%</b></div>
            <div>Bono Captadas: <b>{Number(s?.bonus_captadas || 0).toFixed(2)}€</b></div>
            <div>Pago Minutos: <b>{Number(s?.pay_minutes || 0).toFixed(2)}€</b></div>
          </div>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🏆 Top 3 (mes)</div>
          <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
            <div>
              <b>Captadas:</b> {(rank?.top?.captadas || []).map((x: any, i: number) => (
                <span key={x.worker_id}> #{i + 1} {x.display_name} ({x.captadas_total}) </span>
              ))}
            </div>
            <div>
              <b>Cliente:</b> {(rank?.top?.cliente || []).map((x: any, i: number) => (
                <span key={x.worker_id}> #{i + 1} {x.display_name} ({Number(x.pct_cliente).toFixed(2)}%) </span>
              ))}
            </div>
            <div>
              <b>Repite:</b> {(rank?.top?.repite || []).map((x: any, i: number) => (
                <span key={x.worker_id}> #{i + 1} {x.display_name} ({Number(x.pct_repite).toFixed(2)}%) </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🔥💧 Competición equipos</div>
          <div style={{ fontSize: 13 }}>
            Fuego → score {rank?.teams?.fuego?.score ?? 0} (cliente {rank?.teams?.fuego?.avg_cliente ?? 0}%, repite {rank?.teams?.fuego?.avg_repite ?? 0}%)
            <br />
            Agua → score {rank?.teams?.agua?.score ?? 0} (cliente {rank?.teams?.agua?.avg_cliente ?? 0}%, repite {rank?.teams?.agua?.avg_repite ?? 0}%)
            <br />
            Ganador: <b>{rank?.teams?.winner || "—"}</b>
          </div>
        </div>
      </div>
    </>
  );
}
