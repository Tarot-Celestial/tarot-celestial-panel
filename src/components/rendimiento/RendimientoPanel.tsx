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
  return d.toLocaleString("es-ES");
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);

  async function fetchData() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    if (json?.ok) setRows(json.data || []);
    setLoading(false);
  }

  async function saveEdit() {
    if (!editing?.id) return;

    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
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

  const filtered = useMemo(() => rows, [rows]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">
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
            <th></th>
          </tr>
        </thead>

        <tbody>
          {filtered.map((row) => (
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
                <button onClick={() => setEditing(row)}>✏️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="tc-card">
            <input
              value={editing.cliente_nombre || ""}
              onChange={(e) =>
                setEditing({ ...editing, cliente_nombre: e.target.value })
              }
            />

            <input
              value={editing.importe || ""}
              onChange={(e) =>
                setEditing({ ...editing, importe: Number(e.target.value) })
              }
            />

            <button onClick={saveEdit}>Guardar</button>
            <button onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
