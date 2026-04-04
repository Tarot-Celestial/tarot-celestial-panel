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
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-ES");
}

function dedupeRows(data: Row[]) {
  const map = new Map<string, Row>();
  for (const row of data || []) {
    const key = String(
      row.id ||
        [
          row.fecha_hora || "",
          row.cliente_nombre || "",
          row.telefonista_nombre || "",
          row.tarotista_nombre || row.tarotista_manual_call || "",
          row.tiempo || 0,
          row.resumen_codigo || "",
          row.forma_pago || "",
          row.importe || 0,
        ].join("|")
    );
    map.set(key, row);
  }
  return Array.from(map.values());
}

function textInputStyle() {
  return {
    width: "100%",
    minWidth: 0,
    padding: "8px 10px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as const;
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
    else setRefreshing(true);

    try {
      const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar rendimiento");
      setRows(dedupeRows(Array.isArray(json.data) ? json.data : []));
      if (!showLoader) setMsg("✅ Rendimiento actualizado");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error cargando rendimiento"}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "No se pudo sincronizar");
      setMsg(`✅ Sincronización completada: ${json.inserted || 0} nuevas · ${json.skipped || 0} omitidas`);
      await fetchData(false);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error sincronizando"}`);
    } finally {
      setSyncing(false);
    }
  }

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) => prev.map((r) => (String(r.id) === String(id) ? { ...r, [field]: value } : r)));
  }

  async function saveRow(id?: string) {
    if (!id) return;
    const row = rows.find((r) => String(r.id) === String(id));
    if (!row?.id) return;

    const token = await getToken();
    if (!token) return;

    try {
      setSavingId(String(row.id));
      const updates = {
        cliente_nombre: row.cliente_nombre || null,
        tiempo: Number(row.tiempo || 0),
        resumen_codigo: row.resumen_codigo || null,
        forma_pago: row.forma_pago || null,
        importe: row.importe == null || row.importe === ("" as any) ? null : Number(row.importe),
        llamada_call: Boolean(row.llamada_call),
        promo: Boolean(row.promo),
        captado: Boolean(row.captado),
        recuperado: Boolean(row.recuperado),
      };

      const res = await fetch("/api/crm/rendimiento/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: row.id, updates }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "No se pudo guardar");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error guardando cambios"}`);
      await fetchData(false);
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
      setMsg("✅ Línea eliminada");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "No se pudo eliminar"}`);
    }
  }

  useEffect(() => {
    fetchData(true);
  }, [mode]);

  const visibleRows = useMemo(() => dedupeRows(rows), [rows]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">
      <div className="tc-row" style={{ justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title">📈 Rendimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {mode === "central"
              ? "Vista global del rendimiento registrado desde CRM."
              : "Vista global del rendimiento y sincronización de abril desde Sheets."}
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {mode === "admin" ? (
            <button className="tc-btn tc-btn-gold" onClick={syncFromSheets} disabled={syncing}>
              {syncing ? "Sincronizando..." : "Sincronizar abril"}
            </button>
          ) : null}
          <button className="tc-btn" onClick={() => fetchData(false)} disabled={refreshing}>
            {refreshing ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      {msg ? <div className="tc-sub" style={{ marginBottom: 10 }}>{msg}</div> : null}

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="tc-table tc-rendimiento-table" style={{ tableLayout: "fixed", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 120 }}>FECHA</th>
              <th style={{ width: 84 }}>TELEFONISTA</th>
              <th style={{ width: 170 }}>CLIENTE</th>
              <th style={{ width: 130 }}>TAROTISTA</th>
              <th style={{ width: 72, textAlign: "center" }}>TIEMPO</th>
              <th style={{ width: 86, textAlign: "center" }}>LLAMADA CALL</th>
              <th style={{ width: 150 }}>CÓDIGO</th>
              <th style={{ width: 110 }}>PAGO</th>
              <th style={{ width: 82, textAlign: "center" }}>IMPORTE</th>
              <th style={{ width: 70, textAlign: "center" }}>PROMO</th>
              <th style={{ width: 78, textAlign: "center" }}>CAPTADO</th>
              <th style={{ width: 96, textAlign: "center" }}>RECUPERADO</th>
              <th style={{ width: 64 }}></th>
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row) => (
              <tr key={String(row.id || `${row.fecha_hora}-${row.cliente_nombre}`)}>
                <td>
                  <div style={{ lineHeight: 1.35, whiteSpace: "normal" }}>{fmt(row.fecha_hora)}</div>
                </td>
                <td>
                  <div style={{ whiteSpace: "normal", lineHeight: 1.3 }}>{row.telefonista_nombre || "—"}</div>
                </td>
                <td>
                  <input
                    className="tc-input"
                    style={textInputStyle()}
                    value={row.cliente_nombre || ""}
                    onChange={(e) => updateField(String(row.id), "cliente_nombre", e.target.value)}
                    onBlur={() => saveRow(String(row.id))}
                  />
                </td>
                <td>
                  <div style={{ whiteSpace: "normal", lineHeight: 1.3 }}>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</div>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    className="tc-input"
                    style={{ width: 54, minWidth: 54, textAlign: "center", padding: "8px 6px" }}
                    type="number"
                    value={row.tiempo ?? 0}
                    onChange={(e) => updateField(String(row.id), "tiempo", Number(e.target.value))}
                    onBlur={() => saveRow(String(row.id))}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.llamada_call)}
                    onChange={(e) => {
                      updateField(String(row.id), "llamada_call", e.target.checked);
                      setTimeout(() => saveRow(String(row.id)), 0);
                    }}
                  />
                </td>
                <td>
                  <input
                    className="tc-input"
                    style={textInputStyle()}
                    value={row.resumen_codigo || ""}
                    onChange={(e) => updateField(String(row.id), "resumen_codigo", e.target.value)}
                    onBlur={() => saveRow(String(row.id))}
                  />
                </td>
                <td>
                  <select
                    className="tc-select"
                    style={{ width: "100%", minWidth: 0 }}
                    value={row.forma_pago || ""}
                    onChange={(e) => {
                      updateField(String(row.id), "forma_pago", e.target.value || null);
                      setTimeout(() => saveRow(String(row.id)), 0);
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
                    style={{ width: 66, minWidth: 66, textAlign: "center", padding: "8px 6px" }}
                    type="number"
                    value={row.importe ?? ""}
                    onChange={(e) => updateField(String(row.id), "importe", e.target.value === "" ? null : Number(e.target.value))}
                    onBlur={() => saveRow(String(row.id))}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.promo)}
                    onChange={(e) => {
                      updateField(String(row.id), "promo", e.target.checked);
                      setTimeout(() => saveRow(String(row.id)), 0);
                    }}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.captado)}
                    onChange={(e) => {
                      updateField(String(row.id), "captado", e.target.checked);
                      setTimeout(() => saveRow(String(row.id)), 0);
                    }}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.recuperado)}
                    onChange={(e) => {
                      updateField(String(row.id), "recuperado", e.target.checked);
                      setTimeout(() => saveRow(String(row.id)), 0);
                    }}
                  />
                </td>
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
