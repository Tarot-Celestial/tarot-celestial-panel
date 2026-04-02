
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type Props = {
  mode?: "admin" | "central";
};

type Row = {
  id?: string;
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
};

function fmt(v: any) {
  if (!v) return "—";
  return new Date(v).toLocaleString("es-ES");
}

function dedupeRows(data: Row[]) {
  const map = new Map<string, Row>();
  for (const row of data || []) {
    const key = String(row.id || [row.fecha_hora || '', row.cliente_nombre || '', row.telefonista_nombre || '', row.tarotista_nombre || row.tarotista_manual_call || '', row.tiempo || 0, row.resumen_codigo || '', row.importe || 0].join('|'));
    map.set(key, row);
  }
  return Array.from(map.values());
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || "";
  }

  async function fetchData(showLoader = true) {
    const token = await getToken();
    if (!token) return;

    if (showLoader) setLoading(true);

    try {
      const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar rendimiento");
      setRows(dedupeRows(Array.isArray(json.data) ? json.data : []));
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error cargando rendimiento"}`);
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  async function syncFromSheets() {
    const token = await getToken();
    if (!token || mode !== "admin" || syncing) return;
    try {
      setSyncing(true);
      setMsg("");
      const res = await fetch("/api/admin/rendimiento/import-sheet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ month: "2026-04" }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "No se pudo sincronizar");
      setMsg(`✅ Sincronización completada: ${json.inserted || 0} nuevas, ${json.skipped || 0} omitidas`);
      await fetchData(false);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error sincronizando"}`);
    } finally {
      setSyncing(false);
    }
  }

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function saveRow(row: Row) {
    const token = await getToken();
    if (!token || !row.id) return;
    try {
      setSavingId(String(row.id));
      const res = await fetch("/api/crm/rendimiento/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: row.id, updates: row }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "No se pudo guardar");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error guardando cambios"}`);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRow(id?: string) {
    const token = await getToken();
    if (!token || !id) return;
    if (!window.confirm("¿Seguro que quieres eliminar esta línea?")) return;
    try {
      const res = await fetch("/api/crm/rendimiento/delete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "No se pudo eliminar");
      setRows((prev) => prev.filter((r) => String(r.id) !== String(id)));
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error eliminando"}`);
    }
  }

  useEffect(() => {
    fetchData(true);
  }, [mode]);

  const visibleRows = useMemo(() => dedupeRows(rows), [rows]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">
      <div className="tc-row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title">📈 Rendimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {mode === "admin"
              ? "Sincroniza abril desde Sheets sin duplicar registros ya subidos."
              : "Vista operativa del rendimiento registrado desde CRM."}
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {mode === "admin" ? (
            <button className="tc-btn tc-btn-gold" onClick={syncFromSheets} disabled={syncing}>
              {syncing ? "Sincronizando..." : "Sincronizar abril"}
            </button>
          ) : (
            <button className="tc-btn" onClick={() => fetchData(false)}>
              Recargar
            </button>
          )}
        </div>
      </div>

      {msg ? <div className="tc-sub" style={{ marginBottom: 10 }}>{msg}</div> : null}

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="tc-table" style={{ tableLayout: "fixed", width: "100%" }}>
          <thead>
            <tr>
              <th>FECHA</th>
              <th>TELEFONISTA</th>
              <th>CLIENTE</th>
              <th>TAROTISTA</th>
              <th style={{ width: 80, textAlign: "center" }}>TIEMPO</th>
              <th>Llamada call</th>
              <th>CÓDIGO</th>
              <th>PAGO</th>
              <th style={{ width: 100, textAlign: "center" }}>IMPORTE</th>
              <th>PROMO</th>
              <th>CAPTADO</th>
              <th>RECUPERADO</th>
              <th style={{ width: 64 }}></th>
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row) => (
              <tr key={String(row.id || `${row.fecha_hora}-${row.cliente_nombre}`)}>
                <td>{fmt(row.fecha_hora)}</td>
                <td>{row.telefonista_nombre || "—"}</td>
                <td>
                  <input
                    className="tc-input"
                    value={row.cliente_nombre || ""}
                    onChange={(e) => updateField(String(row.id), "cliente_nombre", e.target.value)}
                    onBlur={() => saveRow(row)}
                  />
                </td>
                <td>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</td>
                <td style={{ textAlign: "center" }}>
                  <input
                    className="tc-input"
                    style={{ width: 60, textAlign: "center", padding: "4px 6px" }}
                    type="number"
                    value={row.tiempo || 0}
                    onChange={(e) => updateField(String(row.id), "tiempo", Number(e.target.value))}
                    onBlur={() => saveRow(row)}
                  />
                </td>
                <td>{row.llamada_call ? "✔" : "-"}</td>
                <td>
                  <input
                    className="tc-input"
                    value={row.resumen_codigo || ""}
                    onChange={(e) => updateField(String(row.id), "resumen_codigo", e.target.value)}
                    onBlur={() => saveRow(row)}
                  />
                </td>
                <td>
                  <select
                    className="tc-select"
                    value={row.forma_pago || ""}
                    onChange={(e) => {
                      const value = e.target.value || null;
                      updateField(String(row.id), "forma_pago", value);
                      saveRow({ ...row, forma_pago: value });
                    }}
                  >
                    <option value="">—</option>
                    <option value="TPV">TPV</option>
                    <option value="PAYPAL">PAYPAL</option>
                    <option value="BIZUM">BIZUM</option>
                    <option value="OTROS">OTROS</option>
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    className="tc-input"
                    style={{ width: 80, textAlign: "center", padding: "4px 6px" }}
                    type="number"
                    value={row.importe ?? ""}
                    onChange={(e) => updateField(String(row.id), "importe", e.target.value === "" ? null : Number(e.target.value))}
                    onBlur={() => saveRow(row)}
                  />
                </td>
                <td>{row.promo ? "✔" : "-"}</td>
                <td>{row.captado ? "✔" : "-"}</td>
                <td>{row.recuperado ? "✔" : "-"}</td>
                <td>
                  <button className="tc-btn tc-btn-danger" onClick={() => deleteRow(row.id)} disabled={savingId === String(row.id)}>
                    ❌
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
