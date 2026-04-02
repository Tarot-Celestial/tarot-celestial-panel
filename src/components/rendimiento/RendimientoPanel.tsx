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

function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function fmt(v: any) {
  if (!v) return "—";
  return new Date(v).toLocaleString("es-ES");
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token;
  }

  async function fetchData() {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    if (json?.ok) setRows(json.data || []);
    setLoading(false);
  }

  async function saveRow(row: Row) {
    if (!row.id) return;

    const token = await getToken();
    if (!token) return;

    setSavingId(row.id);

    await fetch("/api/crm/rendimiento/update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: row.id,
        updates: row,
      }),
    });

    setSavingId(null);
  }

  async function deleteRow(id?: string) {
    if (!id) return;

    if (!confirm("¿Seguro que quieres eliminar esta línea?")) return;

    const token = await getToken();
    if (!token) return;

    await fetch("/api/crm/rendimiento/delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });

    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  async function importApril() {
    if (mode !== "admin") return;

    const token = await getToken();
    if (!token) return;

    setImporting(true);

    const res = await fetch("/api/admin/rendimiento/import-sheet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ month: "2026-04" }),
    });

    setImporting(false);

    if (res.ok) fetchData();
  }

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 8000);
    return () => clearInterval(i);
  }, [mode]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">

      {/* HEADER */}
      <div className="tc-row" style={{ justifyContent: "space-between" }}>
        <div className="tc-title">📈 Rendimiento</div>

        {mode === "admin" && (
          <button className="tc-btn tc-btn-gold" onClick={importApril}>
            {importing ? "Importando..." : "Importar abril"}
          </button>
        )}
      </div>

      {/* TABLE */}
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>FECHA</th>
              <th>CLIENTE</th>
              <th style={{ width: 90, textAlign: "center" }}>TIEMPO</th>
              <th>CÓDIGO</th>
              <th>PAGO</th>
              <th style={{ width: 110, textAlign: "center" }}>IMPORTE</th>
              <th>CALL</th>
              <th>PROMO</th>
              <th>CAPTADO</th>
              <th>RECUPERADO</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>

                <td>{fmt(row.fecha_hora)}</td>

                <td>
                  <input
                    className="tc-input"
                    value={row.cliente_nombre || ""}
                    onChange={(e) =>
                      updateField(row.id!, "cliente_nombre", e.target.value)
                    }
                    onBlur={() => saveRow(row)}
                  />
                </td>

                <td>
                  <input
                    className="tc-input"
                    type="number"
                    value={row.tiempo || 0}
                    onChange={(e) =>
                      updateField(row.id!, "tiempo", Number(e.target.value))
                    }
                    onBlur={() => saveRow(row)}
                  />
                </td>

                <td>
                  <input
                    className="tc-input"
                    value={row.resumen_codigo || ""}
                    onChange={(e) =>
                      updateField(row.id!, "resumen_codigo", e.target.value)
                    }
                    onBlur={() => saveRow(row)}
                  />
                </td>

                <td>
                  <select
                    className="tc-select"
                    value={row.forma_pago || ""}
                    onChange={(e) => {
                      updateField(row.id!, "forma_pago", e.target.value);
                      saveRow({ ...row, forma_pago: e.target.value });
                    }}
                  >
                    <option value="">—</option>
                    <option value="TPV">TPV</option>
                    <option value="PAYPAL">PAYPAL</option>
                    <option value="BIZUM">BIZUM</option>
                    <option value="OTROS">OTROS</option>
                  </select>
                </td>

                <td>
                  <input
                    className="tc-input"
                    type="number"
                    value={row.importe || ""}
                    onChange={(e) =>
                      updateField(row.id!, "importe", Number(e.target.value))
                    }
                    onBlur={() => saveRow(row)}
                  />
                </td>

                <td>
                  <input
                    type="checkbox"
                    checked={!!row.llamada_call}
                    onChange={(e) => {
                      updateField(row.id!, "llamada_call", e.target.checked);
                      saveRow({ ...row, llamada_call: e.target.checked });
                    }}
                  />
                </td>

                <td>
                  <input
                    type="checkbox"
                    checked={!!row.promo}
                    onChange={(e) => {
                      updateField(row.id!, "promo", e.target.checked);
                      saveRow({ ...row, promo: e.target.checked });
                    }}
                  />
                </td>

                <td>
                  <input
                    type="checkbox"
                    checked={!!row.captado}
                    onChange={(e) => {
                      updateField(row.id!, "captado", e.target.checked);
                      saveRow({ ...row, captado: e.target.checked });
                    }}
                  />
                </td>

                <td>
                  <input
                    type="checkbox"
                    checked={!!row.recuperado}
                    onChange={(e) => {
                      updateField(row.id!, "recuperado", e.target.checked);
                      saveRow({ ...row, recuperado: e.target.checked });
                    }}
                  />
                </td>

                <td>
                  <button
                    className="tc-btn"
                    onClick={() => deleteRow(row.id)}
                  >
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
