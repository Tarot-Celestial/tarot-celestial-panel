"use client";

import { useEffect, useState } from "react";
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
  const [refreshing, setRefreshing] = useState(false);

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token;
  }

  // 🔥 ANTI DUPLICADOS
  function dedupe(data: Row[]) {
    const map = new Map();
    data.forEach((r) => {
      if (r.id) map.set(r.id, r);
    });
    return Array.from(map.values());
  }

  async function fetchData(showLoader = true) {
    const token = await getToken();
    if (!token) return;

    if (showLoader) setLoading(true);
    else setRefreshing(true);

    const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();

    if (json?.ok) {
      setRows(dedupe(json.data || [])); // 🔥 clave
    }

    setLoading(false);
    setRefreshing(false);
  }

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  async function saveRow(row: Row) {
    const token = await getToken();
    if (!token) return;

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
  }

  useEffect(() => {
    fetchData(true);
  }, [mode]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">

      {/* 🔥 HEADER CON BOTÓN */}
      <div
        className="tc-row"
        style={{ justifyContent: "space-between", marginBottom: 10 }}
      >
        <div className="tc-title">📈 Rendimiento</div>

        <button
          className="tc-btn"
          onClick={() => fetchData(false)}
        >
          {refreshing ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table
          className="tc-table"
          style={{ tableLayout: "fixed", width: "100%" }}
        >
          <thead>
            <tr>
              <th>FECHA</th>
              <th>CLIENTE</th>

              <th style={{ width: 80, textAlign: "center" }}>TIEMPO</th>

              <th>CÓDIGO</th>
              <th>PAGO</th>

              <th style={{ width: 100, textAlign: "center" }}>IMPORTE</th>

              <th>CALL</th>
              <th>PROMO</th>
              <th>CAPTADO</th>
              <th>RECUPERADO</th>
              <th style={{ width: 60 }}></th>
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

                <td style={{ textAlign: "center" }}>
                  <input
                    className="tc-input"
                    style={{ width: 60, textAlign: "center", padding: "4px 6px" }}
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

                <td style={{ textAlign: "center" }}>
                  <input
                    className="tc-input"
                    style={{ width: 80, textAlign: "center", padding: "4px 6px" }}
                    type="number"
                    value={row.importe || ""}
                    onChange={(e) =>
                      updateField(row.id!, "importe", Number(e.target.value))
                    }
                    onBlur={() => saveRow(row)}
                  />
                </td>

                <td>{row.llamada_call ? "✔" : "-"}</td>
                <td>{row.promo ? "✔" : "-"}</td>
                <td>{row.captado ? "✔" : "-"}</td>
                <td>{row.recuperado ? "✔" : "-"}</td>

                <td>
                  <button className="tc-btn">❌</button>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
