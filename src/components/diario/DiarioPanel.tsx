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

export default function DiarioPanel({ embedded = false }: DiarioPanelProps) {
  const [modo, setModo] = useState<"hoy" | "ayer" | "fecha">("hoy");
  const [fecha, setFecha] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<DiarioRow[]>([]);
  const [totals, setTotals] = useState({ total_clientes: 0, total_pagos: 0, total_importe: 0 });
  const [byCentral, setByCentral] = useState<Array<{ name: string; count: number; importe: number }>>([]);
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
      if (!silent) setMsg(`✅ Diario cargado: ${Array.isArray(j.rows) ? j.rows.length : 0} cobros`);
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando diario"}`);
      setRows([]);
      setTotals({ total_clientes: 0, total_pagos: 0, total_importe: 0 });
      setByCentral([]);
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
        <div className="tc-card"><div className="tc-sub">Importe total</div><div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{eur(totals.total_importe)}</div></div>
        <div className="tc-card">
          <div className="tc-sub">Pagos por Centrales</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {byCentral.length ? byCentral.map((x) => (
              <span key={x.name} className="tc-chip" title={eur(x.importe)}>{x.name}: <b>{x.count}</b></span>
            )) : <span className="tc-muted">Sin cobros</span>}
          </div>
        </div>
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
