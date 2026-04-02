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
  tiempo?: number | null;
  resumen_codigo?: string | null;
  forma_pago?: string | null;
  importe?: number | null;
  promo?: boolean | null;
  captado?: boolean | null;
  recuperado?: boolean | null;
};

const defaultWidths = {
  fecha: 180,
  cliente: 220,
  tiempo: 80,
  codigo: 180,
  pago: 120,
  importe: 100,
};

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [widths, setWidths] = useState(defaultWidths);

  // 🔥 cargar layout guardado
  useEffect(() => {
    const saved = localStorage.getItem("rendimiento_layout");
    if (saved) setWidths(JSON.parse(saved));
  }, []);

  // 🔥 guardar layout
  useEffect(() => {
    localStorage.setItem("rendimiento_layout", JSON.stringify(widths));
  }, [widths]);

  async function fetchData() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    if (json?.ok) setRows(json.data || []);
  }

  useEffect(() => {
    fetchData();
  }, [mode]);

  function updateField(id: string, field: keyof Row, value: any) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  async function saveRow(row: Row) {
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
        id: row.id,
        updates: row,
      }),
    });
  }

  // 🔥 RESIZE
  function startResize(e: any, key: keyof typeof widths) {
    const startX = e.clientX;
    const startWidth = widths[key];

    function onMove(ev: any) {
      const newWidth = startWidth + (ev.clientX - startX);
      setWidths((prev) => ({
        ...prev,
        [key]: Math.max(60, newWidth),
      }));
    }

    function stop() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
  }

  function th(label: string, key: keyof typeof widths) {
    return (
      <th style={{ width: widths[key], position: "relative" }}>
        {label}
        <div
          onMouseDown={(e) => startResize(e, key)}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 6,
            height: "100%",
            cursor: "col-resize",
          }}
        />
      </th>
    );
  }

  return (
    <div className="tc-card">
      <div style={{ overflowX: "auto" }}>
        <table
          className="tc-table"
          style={{ tableLayout: "fixed", width: "100%" }}
        >
          <thead>
            <tr>
              {th("FECHA", "fecha")}
              {th("CLIENTE", "cliente")}
              {th("TIEMPO", "tiempo")}
              {th("CÓDIGO", "codigo")}
              {th("PAGO", "pago")}
              {th("IMPORTE", "importe")}
              <th>✔</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.fecha_hora || "").toLocaleString()}</td>

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
                    style={{ width: 60, textAlign: "center" }}
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

                <td>{row.forma_pago}</td>

                <td>
                  <input
                    className="tc-input"
                    style={{ width: 80, textAlign: "center" }}
                    value={row.importe || ""}
                    onChange={(e) =>
                      updateField(row.id!, "importe", Number(e.target.value))
                    }
                    onBlur={() => saveRow(row)}
                  />
                </td>

                <td>✔</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
