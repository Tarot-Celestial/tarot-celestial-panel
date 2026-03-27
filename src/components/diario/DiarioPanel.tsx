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
      tcToast({ title: "Diario actualizado", description: "Resumen cargado correctamente", tone: "info", duration: 2500 });
}

type DiarioPanelProps = {
  embedded?: boolean;
};

export default function DiarioPanel({ embedded = false }: DiarioPanelProps) {
  const [modo, setModo] = useState<"hoy" | "ayer" | "fecha">("hoy");
  const [fecha, setFecha] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({ total_clientes: 0, total_pagos: 0, total_importe: 0 });
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
      if (!silent) {
        setMsg(`✅ Diario cargado: ${Array.isArray(j.rows) ? j.rows.length : 0} líneas`);
      }
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando diario"}`);
      setRows([]);
      setTotals({ total_clientes: 0, total_pagos: 0, total_importe: 0 });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDiario(false);
  }, [modo, fecha]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows || [];
    return (rows || []).filter((r: any) =>
      [r?.nombre, r?.telefono, r?.ultima_compra]
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
          <div className="tc-title">📅 Diario</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Resumen diario de clientes que han comprado.
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className={`tc-btn ${modo === "hoy" ? "tc-btn-gold" : ""}`} onClick={() => setModo("hoy")}>
            Hoy
          </button>
          <button className={`tc-btn ${modo === "ayer" ? "tc-btn-gold" : ""}`} onClick={() => setModo("ayer")}>
            Ayer
          </button>
          <button className={`tc-btn ${modo === "fecha" ? "tc-btn-gold" : ""}`} onClick={() => setModo("fecha")}>
            Fecha
          </button>

          {modo === "fecha" && (
            <input
              className="tc-input"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={{ width: 170 }}
            />
          )}

          <input
            className="tc-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nombre o teléfono..."
            style={{ width: 240, maxWidth: "100%" }}
          />

          <button className="tc-btn" onClick={() => loadDiario(false)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>

      <div className="tc-grid-3" style={{ marginTop: 12 }}>
        <div className="tc-card">
          <div className="tc-sub">Clientes únicos</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{totals.total_clientes || 0}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Pagos</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{totals.total_pagos || 0}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Importe total</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{eur(totals.total_importe || 0)}</div>
        </div>
      </div>

      <div className="tc-hr" />

      <div style={{ overflowX: "auto" }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Fecha de llamada</th>
              <th>Teléfono</th>
            </tr>
          </thead>
          <tbody>
            {(filtered || []).map((r: any) => (
              <tr key={r.id || `${r.nombre}-${r.telefono}`}>
                <td><b>{r.nombre || "—"}</b></td>
                <td>{r.ultima_compra ? new Date(r.ultima_compra).toLocaleString("es-ES") : "—"}</td>
                <td>{r.telefono || "—"}</td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="tc-muted">No hay compras para este día.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
