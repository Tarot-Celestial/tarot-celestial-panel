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

function eur(n: unknown) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function formatDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

function monthLabel(month?: string | null) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return "Mes seleccionado";
  const d = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

type DiarioPanelProps = {
  embedded?: boolean;
};

type DiarioRow = {
  id: string;
  source: "operador" | "web";
  nombre: string;
  telefono?: string | null;
  fecha_pago?: string | null;
  importe?: number | null;
  metodo?: string | null;
  central?: string | null;
  tarotista?: string | null;
  estado?: string | null;
};

type GeneratedRow = {
  name: string;
  count: number;
  importe: number;
};

type MonthlySummary = {
  month: string;
  total_importe_rendimiento: number;
  total_registros_rendimiento: number;
  byTelefonista: GeneratedRow[];
  byTarotista: GeneratedRow[];
};

const EMPTY_MONTHLY: MonthlySummary = {
  month: "",
  total_importe_rendimiento: 0,
  total_registros_rendimiento: 0,
  byTelefonista: [],
  byTarotista: [],
};

function RankingList({ title, rows, emptyText }: { title: string; rows: GeneratedRow[]; emptyText: string }) {
  return (
    <div className="tc-card" style={{ minHeight: 220 }}>
      <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          <div className="tc-sub" style={{ marginTop: 4 }}>
            Dinero generado para la empresa, no factura a pagar.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {rows.length ? (
          rows.slice(0, 10).map((item, index) => (
            <div
              key={`${item.name}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "36px minmax(0, 1fr) auto",
                gap: 10,
                alignItems: "center",
                border: "1px solid rgba(255,255,255,.10)",
                background: "rgba(255,255,255,.04)",
                borderRadius: 14,
                padding: "10px 12px",
              }}
            >
              <span className="tc-chip" style={{ justifyContent: "center" }}>
                #{index + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                <div className="tc-sub">{item.count} registros con importe</div>
              </div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>{eur(item.importe)}</div>
            </div>
          ))
        ) : (
          <div className="tc-muted">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

export default function DiarioPanel({ embedded = false }: DiarioPanelProps) {
  const [modo, setModo] = useState<"hoy" | "ayer" | "fecha">("hoy");
  const [fecha, setFecha] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<DiarioRow[]>([]);
  const [totals, setTotals] = useState({ total_clientes: 0, total_pagos: 0, total_importe: 0 });
  const [byCentral, setByCentral] = useState<Array<{ name: string; count: number; importe: number }>>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary>(EMPTY_MONTHLY);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadDiario(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const params = new URLSearchParams();
      params.set("mode", modo);
      if (modo === "fecha" && fecha) params.set("date", fecha);

      const r = await fetch(`/api/crm/diario/listar?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setRows(Array.isArray(j.rows) ? j.rows : []);
      setTotals(j.totals || { total_clientes: 0, total_pagos: 0, total_importe: 0 });
      setByCentral(Array.isArray(j.byCentral) ? j.byCentral : []);
      setMonthlySummary({
        ...EMPTY_MONTHLY,
        ...(j.monthlySummary || {}),
        byTelefonista: Array.isArray(j.monthlySummary?.byTelefonista) ? j.monthlySummary.byTelefonista : [],
        byTarotista: Array.isArray(j.monthlySummary?.byTarotista) ? j.monthlySummary.byTarotista : [],
      });
      if (!silent) setMsg(`✅ Diario cargado: ${Array.isArray(j.rows) ? j.rows.length : 0} cobros`);
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando diario"}`);
      setRows([]);
      setTotals({ total_clientes: 0, total_pagos: 0, total_importe: 0 });
      setByCentral([]);
      setMonthlySummary(EMPTY_MONTHLY);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDiario(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, fecha]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) =>
      [r.nombre, r.telefono, r.metodo, r.central, r.tarotista, r.source, r.estado]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(qq)
    );
  }, [rows, q]);

  const wrapProps = embedded ? {} : { className: "tc-card" };

  return (
    <div {...wrapProps}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div className="tc-title">📅 Diario de cobros</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Todos los cobros del día: operadores y pagos automáticos de la web.
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className={`tc-btn ${modo === "hoy" ? "tc-btn-gold" : ""}`} onClick={() => setModo("hoy")}>Hoy</button>
          <button className={`tc-btn ${modo === "ayer" ? "tc-btn-gold" : ""}`} onClick={() => setModo("ayer")}>Ayer</button>
          <button className={`tc-btn ${modo === "fecha" ? "tc-btn-gold" : ""}`} onClick={() => setModo("fecha")}>Fecha</button>
          {modo === "fecha" && <input className="tc-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: 170 }} />}
          <input className="tc-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, central, método..." style={{ width: 250, maxWidth: "100%" }} />
          <button className="tc-btn" onClick={() => loadDiario(false)} disabled={loading}>{loading ? "Cargando..." : "Actualizar"}</button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>

      <div className="tc-grid-4" style={{ marginTop: 12 }}>
        <div className="tc-card"><div className="tc-sub">Clientes únicos</div><div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{totals.total_clientes}</div></div>
        <div className="tc-card"><div className="tc-sub">Cobros totales</div><div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{totals.total_pagos}</div></div>
        <div className="tc-card"><div className="tc-sub">Importe total diario</div><div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{eur(totals.total_importe)}</div></div>
        <div className="tc-card">
          <div className="tc-sub">Pagos por Centrales</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {byCentral.length ? byCentral.map((x) => (
              <span key={x.name} className="tc-chip" title={eur(x.importe)}>{x.name}: <b>{eur(x.importe)}</b></span>
            )) : <span className="tc-muted">Sin cobros</span>}
          </div>
        </div>
      </div>

      <div className="tc-card" style={{ marginTop: 14, background: "linear-gradient(135deg, rgba(240,214,141,.16), rgba(255,255,255,.04))" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="tc-sub">Facturado este mes desde rendimiento</div>
            <div style={{ fontSize: 34, fontWeight: 950, marginTop: 6 }}>{eur(monthlySummary.total_importe_rendimiento)}</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              {monthLabel(monthlySummary.month)} · {monthlySummary.total_registros_rendimiento} registros con importe del rendimiento
            </div>
          </div>
          <div className="tc-chip" style={{ alignSelf: "flex-start" }}>
            No es factura a pagar: es dinero generado para la empresa
          </div>
        </div>
      </div>

      <div className="tc-grid-2" style={{ marginTop: 14 }}>
        <RankingList title="Generado por telefonista" rows={monthlySummary.byTelefonista} emptyText="No hay importes de rendimiento para telefonistas en este mes." />
        <RankingList title="Generado por tarotista" rows={monthlySummary.byTarotista} emptyText="No hay importes de rendimiento para tarotistas en este mes." />
      </div>

      <div className="tc-hr" />

      <div style={{ overflowX: "auto" }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Teléfono</th>
              <th>Origen</th>
              <th>Central</th>
              <th>Tarotista</th>
              <th>Método</th>
              <th>Estado</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.fecha_pago)}</td>
                <td><b>{r.nombre || "—"}</b></td>
                <td>{r.telefono || "—"}</td>
                <td><span className="tc-chip">{r.source === "web" ? "Web auto" : "Operador"}</span></td>
                <td>{r.central || "—"}</td>
                <td>{r.tarotista || "—"}</td>
                <td>{r.metodo || "—"}</td>
                <td>{r.estado || "—"}</td>
                <td><b>{eur(r.importe || 0)}</b></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="tc-muted">No hay cobros para este día.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
