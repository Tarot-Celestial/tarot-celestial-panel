"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type Props = { mode?: "admin" | "central" };

type Row = {
  id?: string;
  fecha_hora?: string | null;
  fecha?: string | null;
  cliente_nombre?: string | null;
  telefonista_nombre?: string | null;
  tarotista_nombre?: string | null;
  tarotista_manual_call?: string | null;
  llamada_call?: boolean | null;
  tiempo?: number | null;
  resumen_codigo?: string | null;
  forma_pago?: string | null;
  importe?: number | null;
  promo?: boolean | null;
  captado?: boolean | null;
};

function fmt(v: any) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-ES");
}

function eur(v: any) {
  const n = Number(v) || 0;
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function yesNo(v: any) {
  return v ? "Sí" : "No";
}

function dedupeRows(data: Row[]) {
  const map = new Map<string, Row>();
  for (const row of data || []) {
    const key = String(
      row.id ||
        [row.fecha_hora || row.fecha || "", row.cliente_nombre || "", row.telefonista_nombre || "", row.tarotista_nombre || row.tarotista_manual_call || "", row.tiempo || 0, row.resumen_codigo || "", row.importe || 0].join("|")
    );
    map.set(key, row);
  }
  return Array.from(map.values());
}

function inputStyle() {
  return {
    width: "100%",
    minWidth: 96,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.05)",
    color: "white",
    outline: "none",
  } as const;
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const [fTarotista, setFTarotista] = useState("");
  const [fTelefonista, setFTelefonista] = useState("");
  const [fCodigo, setFCodigo] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || "";
  }

  async function fetchData() {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "No se pudo cargar rendimiento");
      setRows(dedupeRows(json.data || []));
      setMsg(`✅ ${Array.isArray(json.data) ? json.data.length : 0} registros cargados.`);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) => prev.map((r) => (String(r.id) === String(id) ? { ...r, [field]: value } : r)));
  }

  async function saveRow(id?: string) {
    if (!id) return;
    const row = rows.find((r) => String(r.id) === String(id));
    if (!row) return;
    const token = await getToken();
    setSavingId(id);
    try {
      const res = await fetch("/api/crm/rendimiento/update", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, updates: row }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "No se pudo guardar");
      setMsg("✅ Registro guardado.");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error guardando"}`);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRow(id?: string) {
    if (!id || !confirm("¿Borrar este registro de rendimiento?")) return;
    const token = await getToken();
    const res = await fetch("/api/crm/rendimiento/delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setRows((prev) => prev.filter((r) => r.id !== id));
  }

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      const date = r.fecha_hora || r.fecha ? new Date(r.fecha_hora || r.fecha || "") : null;
      const tarotista = String(r.tarotista_nombre || r.tarotista_manual_call || "").toLowerCase();
      return (
        (!fTarotista || tarotista.includes(fTarotista.toLowerCase())) &&
        (!fTelefonista || String(r.telefonista_nombre || "").toLowerCase().includes(fTelefonista.toLowerCase())) &&
        (!fCodigo || String(r.resumen_codigo || "").toLowerCase().includes(fCodigo.toLowerCase())) &&
        (!fFrom || (date && date >= new Date(fFrom))) &&
        (!fTo || (date && date <= new Date(`${fTo}T23:59:59`)))
      );
    });
  }, [rows, fTarotista, fTelefonista, fCodigo, fFrom, fTo]);

  const totals = useMemo(() => ({
    llamadas: visibleRows.length,
    importe: visibleRows.reduce((acc, r) => acc + Number(r.importe || 0), 0),
    captadas: visibleRows.filter((r) => !!r.captado).length,
    tiempo: visibleRows.reduce((acc, r) => acc + Number(r.tiempo || 0), 0),
  }), [visibleRows]);

  if (loading) return <div className="tc-card">Cargando rendimiento...</div>;

  return (
    <div className="tc-card">
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div className="tc-title">📊 Rendimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>Tabla completa de llamadas y cobros registrados.</div>
        </div>
        <button className="tc-btn tc-btn-gold" onClick={fetchData}>Actualizar</button>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>

      <div className="tc-grid-4" style={{ marginTop: 12 }}>
        <div className="tc-card"><div className="tc-sub">Registros</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{totals.llamadas}</div></div>
        <div className="tc-card"><div className="tc-sub">Tiempo total</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{totals.tiempo}</div></div>
        <div className="tc-card"><div className="tc-sub">Importe</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{eur(totals.importe)}</div></div>
        <div className="tc-card"><div className="tc-sub">Captado</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{totals.captadas}</div></div>
      </div>

      <div className="tc-hr" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input className="tc-input" style={{ width: 180 }} placeholder="Tarotista" value={fTarotista} onChange={(e) => setFTarotista(e.target.value)} />
        <input className="tc-input" style={{ width: 180 }} placeholder="Telefonista" value={fTelefonista} onChange={(e) => setFTelefonista(e.target.value)} />
        <input className="tc-input" style={{ width: 150 }} placeholder="Código" value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
        <input className="tc-input" style={{ width: 160 }} type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <input className="tc-input" style={{ width: 160 }} type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>FECHA</th>
              <th>TELEFONISTA</th>
              <th>CLIENTES</th>
              <th>TAROTISTA</th>
              <th>TIEMPO</th>
              <th>LLAMADA CALL</th>
              <th>CODIGO</th>
              <th>IMPORTE</th>
              <th>PROMO</th>
              <th>CAPTADO</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id || `${row.fecha_hora}-${row.cliente_nombre}`}>
                <td>{fmt(row.fecha_hora || row.fecha)}</td>
                <td>{row.telefonista_nombre || "—"}</td>
                <td>
                  <input style={inputStyle()} value={row.cliente_nombre || ""} onChange={(e) => updateField(row.id!, "cliente_nombre", e.target.value)} onBlur={() => saveRow(row.id)} />
                </td>
                <td>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</td>
                <td><input style={{ ...inputStyle(), minWidth: 76 }} type="number" value={row.tiempo || 0} onChange={(e) => updateField(row.id!, "tiempo", Number(e.target.value))} onBlur={() => saveRow(row.id)} /></td>
                <td>{yesNo(row.llamada_call)}</td>
                <td><input style={{ ...inputStyle(), minWidth: 92 }} value={row.resumen_codigo || ""} onChange={(e) => updateField(row.id!, "resumen_codigo", e.target.value)} onBlur={() => saveRow(row.id)} /></td>
                <td><input style={{ ...inputStyle(), minWidth: 92 }} type="number" value={row.importe ?? ""} onChange={(e) => updateField(row.id!, "importe", Number(e.target.value))} onBlur={() => saveRow(row.id)} /></td>
                <td>{yesNo(row.promo)}</td>
                <td>{yesNo(row.captado)}</td>
                <td>
                  <button className="tc-btn tc-btn-danger" onClick={() => deleteRow(row.id)} disabled={savingId === row.id}>{savingId === row.id ? "..." : "Borrar"}</button>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && <tr><td colSpan={11} className="tc-muted">No hay registros con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
