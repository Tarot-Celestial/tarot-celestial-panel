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

  // 🔥 NUEVO: estado edición
  const [editing, setEditing] = useState<Row | null>(null);

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

  async function saveEdit() {
    if (!editing?.id) return;

    const token = await getTokenOrLogin();
    if (!token) return;

    const res = await fetch("/api/crm/rendimiento/update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: editing.id,
        updates: {
          cliente_nombre: editing.cliente_nombre,
          importe: editing.importe,
        },
      }),
    });

    const json = await res.json();

    if (json.ok) {
      setEditing(null);
      fetchData();
    } else {
      alert("Error al guardar");
    }
  }

  function openEdit(row: Row) {
    setEditing(row);
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

      return hayTexto;
    });
  }, [rows, q]);

  return (
    <div className="tc-card">
      <table className="tc-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Importe</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.id}>
              <td>{fmtDate(row.fecha_hora)}</td>
              <td>{row.cliente_nombre}</td>
              <td>{row.importe ? eur(row.importe) : "—"}</td>
              <td>
                <button className="tc-btn" onClick={() => openEdit(row)}>
                  ✏️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* MODAL */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="tc-card" style={{ width: 400 }}>
            <div className="tc-title">Editar registro</div>

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
