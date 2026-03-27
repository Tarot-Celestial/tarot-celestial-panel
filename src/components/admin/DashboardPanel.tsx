"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

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
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando dashboard"}`);
      setInvoices([]);
      setStatsRows([]);
      setStatsTotals(null);
      setReservas([]);
      setDiarioRows([]);
    } finally {
      if (!silent) setLoading(false)
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

      <div className="tc-grid-2">
        <div className="tc-card">
          <div className="tc-title" style={{ fontSize: 16 }}>⚡ Actividad inmediata</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>Lo próximo que requiere atención.</div>
          <div className="tc-hr" />
          <div style={{ display: "grid", gap: 10 }}>
            {reservasProximas.length === 0 && <div className="tc-sub">No hay reservas próximas pendientes.</div>}
            {reservasProximas.map((r: any) => (
              <div
                key={r.id}
                style={{
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 12,
                  background: "rgba(255,255,255,.03)",
                }}
              >
                <div style={{ fontWeight: 800 }}>
                  {r?.cliente_nombre || "Cliente"}
                </div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  {r?.tarotista_display_name || r?.tarotista_nombre_manual || "Tarotista"} · {r?.fecha_reserva ? new Date(r.fecha_reserva).toLocaleString("es-ES") : "—"}
                </div>
                {!!r?.nota && <div className="tc-sub" style={{ marginTop: 6 }}>{r.nota}</div>}
              </div>
            ))}
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

      <div className="tc-grid-2">
        <div className="tc-card">
          <div className="tc-title" style={{ fontSize: 16 }}>💳 Clientes que han comprado hoy</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>Resumen directo del diario.</div>
          <div className="tc-hr" />
          <div style={{ display: "grid", gap: 10 }}>
            {diarioRows.length === 0 && <div className="tc-sub">No hay compras registradas hoy.</div>}
            {diarioRows.slice(0, 8).map((r: any) => (
              <div
                key={r.id || `${r.nombre}-${r.telefono}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 16,
                  padding: 12,
                  background: "rgba(255,255,255,.03)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>{r?.nombre || "Cliente"}</div>
                  <div className="tc-sub" style={{ marginTop: 4 }}>{r?.telefono || "—"}</div>
                </div>
                <div className="tc-sub">{r?.ultima_compra ? new Date(r.ultima_compra).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="tc-card">
          <div className="tc-title" style={{ fontSize: 16 }}>📈 Resumen de rendimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>Lectura rápida del mes actual.</div>
          <div className="tc-hr" />
          <div className="tc-grid-2">
            <DashMini label="Minutos totales" value={numES(statsTotals?.minutes_total || 0)} />
            <DashMini label="Llamadas" value={numES(statsTotals?.calls_total || 0)} />
            <DashMini label="Captadas" value={numES(statsTotals?.captadas_total || 0)} />
            <DashMini label="Pago minutos" value={eur(statsTotals?.pay_minutes || 0)} />
            <DashMini label="Bonus captadas" value={eur(statsTotals?.bonus_captadas || 0)} />
            <DashMini label="% Cliente medio" value={`${numES(statsTotals?.avg_pct_cliente || 0, 2)}%`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashKpi({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="tc-card"
      style={{
        padding: 18,
        borderRadius: 20,
        background: highlight
          ? "linear-gradient(180deg, rgba(215,181,109,.16), rgba(255,255,255,.04))"
          : "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, lineHeight: 1.02 }}>{value}</div>
    </div>
  );
}

function DashMini({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 16,
        padding: 12,
        background: "rgba(255,255,255,.03)",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, marginTop: 8 }}>{value}</div>
    </div>
  );
}
