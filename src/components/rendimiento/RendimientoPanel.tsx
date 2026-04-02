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
  const [importing, setImporting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

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

    const json = await res.json();
    setImporting(false);

    if (json.ok) {
      fetchData();
    } else {
      alert("Error importando");
    }
  }

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 8000);
    return () => clearInterval(i);
  }, [mode]);

  const metrics = useMemo(() => {
    const total = rows.length;
    const importe = rows.reduce((a, r) => a + (Number(r.importe) || 0), 0);
    const minutos = rows.reduce((a, r) => a + (Number(r.tiempo) || 0), 0);
    return { total, importe, minutos };
  }, [rows]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">

      {/* HEADER */}
      <div className="tc-row" style={{ justifyContent: "space-between" }}>
        <div className="tc-title">📈 Rendimiento</div>

        {mode === "admin" && (
          <button
            className="tc-btn tc-btn-gold"
            onClick={importApril}
          >
            {importing ? "Importando..." : "Importar abril"}
          </button>
        )}
      </div>

      {/* METRICS */}
      <div className="tc-grid-3" style={{ marginTop: 10 }}>
        <div className="tc-card">
          <div className="tc-sub">Registros</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{metrics.total}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Facturación</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{eur(metrics.importe)}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Minutos</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{metrics.minutos}</div>
        </div>
      </div>

      {/* TABLE */}
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>FECHA</th>
              <th>TELEFONISTA</th>
              <th>CLIENTE</th>
              <th>TAROTISTA</th>
              <th>TIEMPO</th>
              <th>CALL</th>
              <th>CÓDIGO</th>
              <th>PAGO</th>
              <th>IMPORTE</th>
              <th>PROMO</th>
              <th>CAPTADO</th>
              <th>RECUPERADO</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>

                <td>{fmt(row.fecha_hora)}</td>

                <td>{row.telefonista_nombre}</td>

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

                <td>{row.tarotista_nombre || row.tarotista_manual_call}</td>

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

                <td>{row.llamada_call ? "✔" : "-"}</td>

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

                <td>{row.forma_pago}</td>

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

                <td style={{ color: row.promo ? "#ffd700" : "" }}>
                  {row.promo ? "✔" : "-"}
                </td>

                <td style={{ color: row.captado ? "#00ffcc" : "" }}>
                  {row.captado ? "✔" : "-"}
                </td>

                <td style={{ color: row.recuperado ? "#a78bfa" : "" }}>
                  {row.recuperado ? "✔" : "-"}
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
