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

function fmtDate(v: any) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-ES");
}

function eur(v: any) {
  return (Number(v) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function num(v: any) {
  const n = Number(v) || 0;
  return n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

type Props = {
  mode?: "admin" | "central";
};

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState<any[]>([]);
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

  async function loadRendimiento() {
    try {
      setLoading(true);
      setMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/crm/rendimiento/listar?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setRows([]);
      setMsg(`❌ ${e?.message || "Error cargando rendimiento"}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRendimiento();
  }, []);

  const totals = useMemo(() => {
    return (rows || []).reduce(
      (acc, row) => {
        acc.importe += Number(row?.importe || 0);
        acc.tiempo += Number(row?.tiempo || 0);
        acc.captadas += row?.captado ? 1 : 0;
        acc.recuperadas += row?.recuperado ? 1 : 0;
        acc.promos += row?.promo ? 1 : 0;
        return acc;
      },
      { importe: 0, tiempo: 0, captadas: 0, recuperadas: 0, promos: 0 }
    );
  }, [rows]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="tc-card" style={{ borderRadius: 24, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <div className="tc-title">📈 Rendimiento</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Registro manual de llamadas desde CRM. Aquí ves compras, 7 free, minutos usados y clasificación comercial.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="tc-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar clienta, telefonista, tarotista, código..."
              style={{ width: 300, maxWidth: "100%" }}
            />
            <button className="tc-btn tc-btn-gold" onClick={loadRendimiento} disabled={loading}>
              {loading ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </div>
      </div>

      <div className="tc-grid-4">
        <div className="tc-card" style={{ borderRadius: 20, padding: 16 }}><div className="tc-sub">Importe</div><div className="tc-title" style={{ marginTop: 8 }}>{eur(totals.importe)}</div></div>
        <div className="tc-card" style={{ borderRadius: 20, padding: 16 }}><div className="tc-sub">Tiempo registrado</div><div className="tc-title" style={{ marginTop: 8 }}>{num(totals.tiempo)} min</div></div>
        <div className="tc-card" style={{ borderRadius: 20, padding: 16 }}><div className="tc-sub">Captadas</div><div className="tc-title" style={{ marginTop: 8 }}>{totals.captadas}</div></div>
        <div className="tc-card" style={{ borderRadius: 20, padding: 16 }}><div className="tc-sub">Modo</div><div className="tc-title" style={{ marginTop: 8 }}>{mode === "admin" ? "Admin" : "Central"}</div></div>
      </div>

      <div className="tc-card" style={{ borderRadius: 24, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1500 }}>
            <thead>
              <tr style={{ background: "rgba(215,181,109,.12)" }}>
                {[
                  "Fecha",
                  "ID único",
                  "Telefonista",
                  "Cliente",
                  "Tarotista",
                  "Tiempo",
                  "Llamada call",
                  "Código",
                  "¿Misma compra?",
                  "Forma pago",
                  "Importe",
                  "Promo",
                  "7 free",
                  "Captado",
                  "Recuperado",
                ].map((head) => (
                  <th key={head} style={{ textAlign: "left", padding: "12px 14px", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,.08)" }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id} style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                  <td style={{ padding: "12px 14px" }}>{fmtDate(row.fecha_hora || row.created_at)}</td>
                  <td style={{ padding: "12px 14px" }}>{row.id_unico ?? "—"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.telefonista_nombre || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.cliente_nombre || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>{num(row.tiempo || 0)}</td>
                  <td style={{ padding: "12px 14px" }}>{row.llamada_call ? "Sí" : "No"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.resumen_codigo || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.misma_compra ? "Sí" : "No"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.forma_pago || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>{eur(row.importe || 0)}</td>
                  <td style={{ padding: "12px 14px" }}>{row.promo ? "Sí" : "No"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.usa_7_free ? "Sí" : "No"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.captado ? "Sí" : "No"}</td>
                  <td style={{ padding: "12px 14px" }}>{row.recuperado ? "Sí" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && (
          <div style={{ padding: 18 }} className="tc-sub">
            {msg || "Todavía no hay líneas de rendimiento registradas."}
          </div>
        )}
      </div>
    </div>
  );
}
