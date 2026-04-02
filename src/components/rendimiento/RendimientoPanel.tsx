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
};

function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function fmtDate(v: any) {
  if (!v) return "—";
  return new Date(v).toLocaleString("es-ES");
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
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
      alert("✅ Importado correctamente");
      fetchData();
    } else {
      alert("❌ Error importando");
    }
  }

  async function saveEdit() {
    if (!editing?.id) return;

    const token = await getToken();
    if (!token) return;

    await fetch("/api/crm/rendimiento/update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: editing.id,
        updates: editing,
      }),
    });

    setEditing(null);
    fetchData();
  }

  useEffect(() => {
    fetchData();
  }, [mode]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">

      {/* 🔥 HEADER */}
      <div className="tc-row" style={{ justifyContent: "space-between" }}>
        <div className="tc-title">📈 Rendimiento</div>

        {mode === "admin" && (
          <button
            className="tc-btn tc-btn-gold"
            onClick={importApril}
            disabled={importing}
          >
            {importing ? "Importando..." : "Importar abril desde Sheets"}
          </button>
        )}
      </div>

      {/* 🔥 TABLA */}
      <table className="tc-table" style={{ marginTop: 12 }}>
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
            <th></th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{fmtDate(row.fecha_hora)}</td>
              <td>{row.telefonista_nombre}</td>
              <td>{row.cliente_nombre}</td>
              <td>{row.tarotista_nombre || row.tarotista_manual_call}</td>
              <td>{row.tiempo}</td>
              <td>{row.llamada_call ? "Sí" : "-"}</td>
              <td>{row.resumen_codigo}</td>
              <td>{row.forma_pago}</td>
              <td>{row.importe ? eur(row.importe) : "-"}</td>
              <td>{row.promo ? "✔" : "-"}</td>
              <td>{row.captado ? "✔" : "-"}</td>
              <td>{row.recuperado ? "✔" : "-"}</td>
              <td>
                <button className="tc-btn" onClick={() => setEditing(row)}>
                  ✏️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 🔥 MODAL EDIT */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="tc-card" style={{ width: 400 }}>
            <div className="tc-title">Editar</div>

            <input
              className="tc-input"
              value={editing.cliente_nombre || ""}
              onChange={(e) =>
                setEditing({ ...editing, cliente_nombre: e.target.value })
              }
            />

            <input
              className="tc-input"
              value={editing.importe || ""}
              onChange={(e) =>
                setEditing({ ...editing, importe: Number(e.target.value) })
              }
            />

            <div className="tc-row">
              <button className="tc-btn tc-btn-gold" onClick={saveEdit}>
                Guardar
              </button>
              <button className="tc-btn" onClick={() => setEditing(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
