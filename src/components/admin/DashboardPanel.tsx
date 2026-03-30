"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { tcToast } from "@/lib/tc-toast";

const sb = supabaseBrowser();

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

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function numES(n: any, digits = 0) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

type DashboardPanelProps = {
  month: string;
};

function minsUntil(dateValue: any) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 60000);
}

export default function DashboardPanel({ month }: DashboardPanelProps) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statsRows, setStatsRows] = useState<any[]>([]);
  const [statsTotals, setStatsTotals] = useState<any>(null);
  const [reservas, setReservas] = useState<any[]>([]);
  const [diarioRows, setDiarioRows] = useState<any[]>([]);

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadDashboard(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const [invRes, statsRes, reservasRes, diarioRes] = await Promise.all([
        fetch(`/api/admin/invoices/list?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`/api/stats/monthly?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/crm/reservas/listar", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/crm/diario/listar?mode=hoy", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const invJ = await safeJson(invRes);
      const statsJ = await safeJson(statsRes);
      const reservasJ = await safeJson(reservasRes);
      const diarioJ = await safeJson(diarioRes);

      if (!invJ?._ok || !invJ?.ok) throw new Error(invJ?.error || `HTTP ${invJ?._status}`);
      if (!statsJ?._ok || !statsJ?.ok) throw new Error(statsJ?.error || `HTTP ${statsJ?._status}`);
      if (!reservasJ?._ok || !reservasJ?.ok) throw new Error(reservasJ?.error || `HTTP ${reservasJ?._status}`);
      if (!diarioJ?._ok || !diarioJ?.ok) throw new Error(diarioJ?.error || `HTTP ${diarioJ?._status}`);

      setInvoices(Array.isArray(invJ.invoices) ? invJ.invoices : []);
      setStatsRows(Array.isArray(statsJ.rows) ? statsJ.rows : []);
      setStatsTotals(statsJ.totals || null);
      setReservas(Array.isArray(reservasJ.reservas) ? reservasJ.reservas : []);
      setDiarioRows(Array.isArray(diarioJ.rows) ? diarioJ.rows : []);

      if (!silent) setMsg("✅ Dashboard actualizado");
    } catch (e: any) {
      if (!silent) {
        setMsg(`❌ ${e?.message || "Error cargando dashboard"}`);
        tcToast({ title: "Error en dashboard", description: String(e?.message || "No se pudo cargar"), tone: "error" });
      }
      setInvoices([]);
      setStatsRows([]);
      setStatsTotals(null);
      setReservas([]);
      setDiarioRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(false);
    const t = setInterval(() => loadDashboard(true), 20000);
    return () => clearInterval(t);
  }, [month]);

  const totalFacturacion = useMemo(
    () => (invoices || []).reduce((acc: number, x: any) => acc + (Number(x?.total) || 0), 0),
    [invoices]
  );

  const pendientes = useMemo(
    () => (reservas || []).filter((x: any) => String(x?.estado || "") !== "finalizada").length,
    [reservas]
  );

  const reservasProximas = useMemo(() => {
    return [...(reservas || [])]
      .filter((x: any) => String(x?.estado || "") !== "finalizada")
      .sort((a: any, b: any) => {
        const at = a?.fecha_reserva ? new Date(a.fecha_reserva).getTime() : 0;
        const bt = b?.fecha_reserva ? new Date(b.fecha_reserva).getTime() : 0;
        return at - bt;
      })
      .slice(0, 5);
  }, [reservas]);

  const alertas = useMemo(() => {
    const items: { title: string; description: string; tone: "danger" | "warning" | "success" | "info" }[] = [];

    const verySoon = reservasProximas.filter((r: any) => {
      const mins = minsUntil(r?.fecha_reserva);
      return mins !== null && mins >= -2 && mins <= 10;
    });

    if (verySoon.length > 0) {
      items.push({
        title: "Reservas inminentes",
        description: `${verySoon.length} reserva(s) en los próximos 10 minutos.`,
        tone: "danger",
      });
    }

    if ((diarioRows || []).length >= 5) {
      items.push({
        title: "Buen ritmo de compras",
        description: `Hoy han comprado ${diarioRows.length} clientes.`,
        tone: "success",
      });
    }

    if (pendientes >= 8) {
      items.push({
        title: "Carga alta en reservas",
        description: `Hay ${pendientes} reservas pendientes en cola.`,
        tone: "warning",
      });
    }

    if (items.length === 0) {
      items.push({
        title: "Panel estable",
        description: "No hay alertas críticas ahora mismo.",
        tone: "info",
      });
    }

    return items;
  }, [reservasProximas, diarioRows, pendientes]);

  const topProduccion = useMemo(() => {
    return [...(statsRows || [])]
      .sort((a: any, b: any) => (Number(b?.minutes_total) || 0) - (Number(a?.minutes_total) || 0))
      .slice(0, 5);
  }, [statsRows]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        className="tc-card"
        style={{
          padding: 24,
          borderRadius: 26,
          background:
            "radial-gradient(circle at top right, rgba(181,156,255,.18), transparent 26%), radial-gradient(circle at top left, rgba(215,181,109,.12), transparent 22%), linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03))",
        }}
      >
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title" style={{ fontSize: 26 }}>📊 Dashboard ejecutivo</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 860 }}>
              Vista rápida del negocio: facturación del mes, clientes activos hoy, reservas pendientes y tarotistas con mayor producción.
            </div>
          </div>

          <button className="tc-btn tc-btn-gold" onClick={() => loadDashboard(false)} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar dashboard"}
          </button>
        </div>

        <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>
      </div>

      <div className="tc-grid-4">
        <DashKpi label="Facturación visible" value={eur(totalFacturacion)} highlight />
        <DashKpi label="Clientes hoy" value={String(diarioRows.length)} />
        <DashKpi label="Reservas pendientes" value={String(pendientes)} />
        <DashKpi label="Tarotistas con datos" value={String(statsRows.length)} />
      </div>

      <div className="tc-card" style={{ borderRadius: 24 }}>
        <div className="tc-title" style={{ fontSize: 16 }}>🚨 Alertas inteligentes</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>
          Señales rápidas del negocio que requieren atención o indican buen rendimiento.
        </div>
        <div className="tc-hr" />
        <div className="tc-grid-3">
          {alertas.map((a, idx) => (
            <div
              key={idx}
              style={{
                borderRadius: 18,
                padding: 16,
                border:
                  a.tone === "danger"
                    ? "1px solid rgba(255,90,106,.28)"
                    : a.tone === "warning"
                    ? "1px solid rgba(215,181,109,.28)"
                    : a.tone === "success"
                    ? "1px solid rgba(105,240,177,.26)"
                    : "1px solid rgba(181,156,255,.26)",
                background:
                  a.tone === "danger"
                    ? "linear-gradient(180deg, rgba(255,90,106,.12), rgba(255,255,255,.03))"
                    : a.tone === "warning"
                    ? "linear-gradient(180deg, rgba(215,181,109,.12), rgba(255,255,255,.03))"
                    : a.tone === "success"
                    ? "linear-gradient(180deg, rgba(105,240,177,.10), rgba(255,255,255,.03))"
                    : "linear-gradient(180deg, rgba(181,156,255,.10), rgba(255,255,255,.03))",
              }}
            >
              <div style={{ fontWeight: 900 }}>{a.title}</div>
              <div className="tc-sub" style={{ marginTop: 8 }}>{a.description}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="tc-grid-2">
        <div className="tc-card">
          <div className="tc-title" style={{ fontSize: 16 }}>⚡ Actividad inmediata</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>Lo próximo que requiere atención.</div>
          <div className="tc-hr" />
          <div style={{ display: "grid", gap: 10 }}>
            {reservasProximas.length === 0 && <div className="tc-sub">No hay reservas próximas pendientes.</div>}
            {reservasProximas.map((r: any) => {
              const mins = minsUntil(r?.fecha_reserva);
              const urgent = mins !== null && mins >= -2 && mins <= 10;

              return (
                <div
                  key={r.id}
                  style={{
                    border: urgent ? "1px solid rgba(255,90,106,.26)" : "1px solid rgba(255,255,255,.08)",
                    borderRadius: 16,
                    padding: 12,
                    background: urgent ? "rgba(255,90,106,.08)" : "rgba(255,255,255,.03)",
                    boxShadow: urgent ? "0 10px 28px rgba(255,90,106,.10)" : "none",
                  }}
                >
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>
                      {r?.cliente_nombre || "Cliente"}
                    </div>
                    {urgent ? <span className="tc-chip" style={{ background: "rgba(255,90,106,.16)", border: "1px solid rgba(255,90,106,.26)" }}>Urgente</span> : null}
                  </div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    {r?.tarotista_display_name || r?.tarotista_nombre_manual || "Tarotista"} · {r?.fecha_reserva ? new Date(r.fecha_reserva).toLocaleString("es-ES") : "—"}
                  </div>
                  {mins !== null ? (
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      {mins >= 0 ? `Empieza en ${mins} min` : `Debía empezar hace ${Math.abs(mins)} min`}
                    </div>
                  ) : null}
                  {!!r?.nota && <div className="tc-sub" style={{ marginTop: 6 }}>{r.nota}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="tc-card">
          <div className="tc-title" style={{ fontSize: 16 }}>🏆 Top producción del mes</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>Tarotistas con más minutos este mes.</div>
          <div className="tc-hr" />
          <div style={{ display: "grid", gap: 10 }}>
            {topProduccion.length === 0 && <div className="tc-sub">Sin datos de producción todavía.</div>}
            {topProduccion.map((r: any, idx: number) => (
              <div
                key={r.worker_id || idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "center",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 12,
                  background: "rgba(255,255,255,.03)",
                }}
              >
                <div className="tc-chip">{idx + 1}</div>
                <div>
                  <div style={{ fontWeight: 800 }}>{r?.display_name || "Tarotista"}</div>
                  <div className="tc-sub" style={{ marginTop: 4 }}>
                    Captadas: {numES(r?.captadas_total || 0)} · Llamadas: {numES(r?.calls_total || 0)}
                  </div>
                </div>
                <div style={{ fontWeight: 900 }}>{numES(r?.minutes_total || 0)} min</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashKpi({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="tc-card"
      style={{
        padding: 18,
        borderRadius: 20,
        background: highlight
          ? "linear-gradient(180deg, rgba(215,181,109,.12), rgba(255,255,255,.03))"
          : "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.025))",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10 }}>{value}</div>
    </div>
  );
}
