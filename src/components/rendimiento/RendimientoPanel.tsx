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
  } as const;
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // 🔎 FILTROS
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

    const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    setRows(dedupeRows(json.data || []));
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [mode]);

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) =>
      prev.map((r) =>
        String(r.id) === String(id) ? { ...r, [field]: value } : r
      )
    );
  }

  async function saveRow(id?: string) {
    if (!id) return;

    const row = rows.find((r) => String(r.id) === String(id));
    if (!row) return;

    const token = await getToken();

    setSavingId(id);

    await fetch("/api/crm/rendimiento/update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id,
        updates: row,
      }),
    });

    setSavingId(null);
  }

  async function deleteRow(id?: string) {
    if (!id) return;

    const token = await getToken();

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

  // 🔥 FILTRADO
  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      const date = r.fecha_hora ? new Date(r.fecha_hora) : null;

      return (
        (!fTarotista ||
          (r.tarotista_nombre || "")
            .toLowerCase()
            .includes(fTarotista.toLowerCase())) &&
        (!fTelefonista ||
          (r.telefonista_nombre || "")
            .toLowerCase()
            .includes(fTelefonista.toLowerCase())) &&
        (!fCodigo ||
          (r.resumen_codigo || "")
            .toLowerCase()
            .includes(fCodigo.toLowerCase())) &&
        (!fFrom || (date && date >= new Date(fFrom))) &&
        (!fTo || (date && date <= new Date(fTo + "T23:59:59")))
      );
    });
  }, [rows, fTarotista, fTelefonista, fCodigo, fFrom, fTo]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">

      {/* 🔎 FILTROS */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="tc-input" placeholder="Tarotista" value={fTarotista} onChange={(e) => setFTarotista(e.target.value)} />
        <input className="tc-input" placeholder="Telefonista" value={fTelefonista} onChange={(e) => setFTelefonista(e.target.value)} />
        <input className="tc-input" placeholder="Código" value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
        <input className="tc-input" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <input className="tc-input" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>

      {/* 🧾 TABLA ORIGINAL */}
      <table className="tc-table">
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id}>
              <td>{fmt(row.fecha_hora)}</td>
              <td>{row.telefonista_nombre}</td>

              <td>
                <input
                  style={textInputStyle()}
                  value={row.cliente_nombre || ""}
                  onChange={(e) =>
                    updateField(row.id!, "cliente_nombre", e.target.value)
                  }
                  onBlur={() => saveRow(row.id)}
                />
              </td>

              <td>{row.tarotista_nombre}</td>

              <td>
                <input
                  type="number"
                  value={row.tiempo || 0}
                  onChange={(e) =>
                    updateField(row.id!, "tiempo", Number(e.target.value))
                  }
                  onBlur={() => saveRow(row.id)}
                />
              </td>

              <td>
                <input
                  value={row.resumen_codigo || ""}
                  onChange={(e) =>
                    updateField(row.id!, "resumen_codigo", e.target.value)
                  }
                  onBlur={() => saveRow(row.id)}
                />
              </td>

              <td>
                <input
                  type="number"
                  value={row.importe || ""}
                  onChange={(e) =>
                    updateField(row.id!, "importe", Number(e.target.value))
                  }
                  onBlur={() => saveRow(row.id)}
                />
              </td>

              <td>
                <button onClick={() => deleteRow(row.id)}>❌</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
