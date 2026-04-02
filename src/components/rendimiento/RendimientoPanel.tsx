"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type Props = {
  mode?: "admin" | "central";
};

type Row = {
  id?: string;
  id_unico?: number | string | null;
  fecha?: string | null;
  fecha_hora?: string | null;
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
  recuperado?: boolean | null;
  tipo_registro?: string | null;
};

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tipoBadge(row: Row) {
  if (row.promo) return { label: "Promo", style: { background: "rgba(215,181,109,0.16)", borderColor: "rgba(215,181,109,0.32)", color: "#f7dfab" } };
  if (row.captado) return { label: "Captado", style: { background: "rgba(105,240,177,0.12)", borderColor: "rgba(105,240,177,0.30)", color: "#9dffd1" } };
  if (row.recuperado) return { label: "Recuperado", style: { background: "rgba(181,156,255,0.15)", borderColor: "rgba(181,156,255,0.34)", color: "#dacdff" } };
  if (row.tipo_registro === "compra") return { label: "Compra", style: { background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.9)" } };
  if (row.tipo_registro === "7free") return { label: "7 Free", style: { background: "rgba(255,90,106,0.12)", borderColor: "rgba(255,90,106,0.28)", color: "#ffb0b8" } };
  return { label: "Minutos", style: { background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.88)" } };
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [pago, setPago] = useState("todos");
  const [importing, setImporting] = useState(false);

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      if (typeof window !== "undefined") window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function fetchData(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar rendimiento");

      setRows(Array.isArray(json.data) ? json.data : []);
      if (!silent) {
        setMsg(`✅ ${Array.isArray(json.data) ? json.data.length : 0} registros cargados`);
      }
    } catch (err: any) {
      setRows([]);
      setMsg(`❌ ${err?.message || "Error cargando rendimiento"}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }


  async function importApril() {
    if (mode !== "admin" || importing) return;
    try {
      setImporting(true);
      const token = await getTokenOrLogin();
      if (!token) return;
      const res = await fetch('/api/admin/rendimiento/import-sheet', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: '2026-04' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'No se pudo importar abril');
      setMsg(`✅ Abril importado: ${json.inserted || 0} filas nuevas`);
      await fetchData(false);
    } catch (err: any) {
      setMsg(`❌ ${err?.message || 'Error importando abril'}`);
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(true), 8000);
    return () => clearInterval(interval);
  }, [mode]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter((row) => {
      const hayTexto = !qq || [
        row.id_unico,
        row.cliente_nombre,
        row.telefonista_nombre,
        row.tarotista_nombre,
        row.tarotista_manual_call,
        row.resumen_codigo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(qq);

      const hayTipo = tipo === "todos"
        || (tipo === "compra" && row.tipo_registro === "compra")
        || (tipo === "minutos" && row.tipo_registro === "minutos")
        || (tipo === "7free" && row.tipo_registro === "7free")
        || (tipo === "promo" && Boolean(row.promo))
        || (tipo === "captado" && Boolean(row.captado))
        || (tipo === "recuperado" && Boolean(row.recuperado));

      const forma = String(row.forma_pago || "").toUpperCase();
      const hayPago = pago === "todos" || forma === pago;

      return hayTexto && hayTipo && hayPago;
    });
  }, [rows, q, tipo, pago]);

  const metrics = useMemo(() => {
    const total = filtered.length;
    const ventas = filtered.filter((r) => r.tipo_registro === "compra").length;
    const importe = filtered.reduce((acc, r) => acc + (Number(r.importe) || 0), 0);
    const minutos = filtered.reduce((acc, r) => acc + (Number(r.tiempo) || 0), 0);
    return { total, ventas, importe, minutos };
  }, [filtered]);

  return (
    <div className="tc-card">
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
        <div>
          <div className="tc-title">📈 Rendimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {mode === "central"
              ? "Tus llamadas, compras y uso de minutos registrados desde el CRM."
              : "Vista global de llamadas registradas por el equipo desde el CRM."}
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="tc-chip">Vista: {mode === "central" ? "Central" : "Admin"}</span>
          {mode === "admin" ? (
            <button className="tc-btn tc-btn-gold" onClick={importApril} disabled={importing}>
              {importing ? "Importando abril…" : "Importar abril desde Sheets"}
            </button>
          ) : null}
          <button className="tc-btn" onClick={() => fetchData(false)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>

      <div className="tc-grid-4" style={{ marginTop: 12 }}>
        <div className="tc-card">
          <div className="tc-sub">Registros</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{metrics.total}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Compras</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{metrics.ventas}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Importe</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{eur(metrics.importe)}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Minutos movidos</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{metrics.minutos}</div>
        </div>
      </div>

      <div className="tc-hr" />

      <div className="tc-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="tc-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente, telefonista, tarotista o código..."
          style={{ width: 320, maxWidth: "100%" }}
        />

        <select className="tc-select" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 180 }}>
          <option value="todos">Todos los tipos</option>
          <option value="compra">Compra</option>
          <option value="minutos">Uso minutos</option>
          <option value="7free">7 free</option>
          <option value="promo">Promo</option>
          <option value="captado">Captado</option>
          <option value="recuperado">Recuperado</option>
        </select>

        <select className="tc-select" value={pago} onChange={(e) => setPago(e.target.value)} style={{ width: 170 }}>
          <option value="todos">Todos los pagos</option>
          <option value="TPV">TPV</option>
          <option value="PAYPAL">PAYPAL</option>
          <option value="BIZUM">BIZUM</option>
          <option value="OTROS">OTROS</option>
        </select>
      </div>

      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Registro</th>
              <th>Cliente</th>
              <th>Telefonista</th>
              <th>Tarotista</th>
              <th>Tiempo</th>
              <th>Código</th>
              <th>Pago</th>
              <th>Importe</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const badge = tipoBadge(row);
              return (
                <tr key={String(row.id || `${row.id_unico}-${row.fecha_hora}`)}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{fmtDate(row.fecha_hora || row.fecha || null)}</div>
                    <div className="tc-sub">{row.fecha || "—"}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 800 }}>#{row.id_unico || "—"}</div>
                    <div className="tc-sub">{String(row.tipo_registro || "—").toUpperCase()}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 800 }}>{row.cliente_nombre || "—"}</div>
                  </td>
                  <td>{row.telefonista_nombre || "—"}</td>
                  <td>
                    <div>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</div>
                    {row.llamada_call ? <div className="tc-sub">CALL</div> : null}
                  </td>
                  <td>{Number(row.tiempo) || 0} min</td>
                  <td>{row.resumen_codigo || "—"}</td>
                  <td>{row.forma_pago || "—"}</td>
                  <td>{Number(row.importe) ? eur(row.importe) : "—"}</td>
                  <td>
                    <span
                      className="tc-chip"
                      style={{
                        ...badge.style,
                        borderWidth: 1,
                        borderStyle: "solid",
                        fontWeight: 800,
                      }}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={10}>
                  <div
                    className="tc-card"
                    style={{
                      margin: "8px 0",
                      textAlign: "center",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>
                    <div style={{ fontWeight: 800 }}>No hay registros para los filtros actuales</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Prueba quitando filtros o registra una llamada desde la ficha del cliente.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
