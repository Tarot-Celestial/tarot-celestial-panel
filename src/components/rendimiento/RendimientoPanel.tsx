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

  // 🔥 FILTROS
  const [fWorker, setFWorker] = useState("");
  const [fTelefono, setFTelefono] = useState("");
  const [fCodigo, setFCodigo] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

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

      setMsg(
        `✅ Sincronización completada: ${json.inserted || 0} nuevas · ${
          json.skipped || 0
        } omitidas`
      );

      await fetchData(false);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error sincronizando"}`);
    } finally {
      setSyncing(false);
    }
  }

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
        importe:
          row.importe == null || row.importe === ("" as any)
            ? null
            : Number(row.importe),
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

      setRows((prev) =>
        prev.filter((r) => String(r.id) !== String(id))
      );

      setMsg("✅ Línea eliminada");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "No se pudo eliminar"}`);
    }
  }

  useEffect(() => {
    fetchData(true);
  }, [mode]);

  // 🔥 FILTRADO
  const visibleRows = useMemo(() => {
    return dedupeRows(rows).filter((r) => {
      const matchWorker =
        !fWorker ||
        (r.tarotista_nombre || "")
          .toLowerCase()
          .includes(fWorker.toLowerCase());

      const matchTelefono =
        !fTelefono ||
        (r.telefonista_nombre || "")
          .toLowerCase()
          .includes(fTelefono.toLowerCase());

      const matchCodigo =
        !fCodigo ||
        (r.resumen_codigo || "")
          .toLowerCase()
          .includes(fCodigo.toLowerCase());

      const date = r.fecha_hora ? new Date(r.fecha_hora) : null;

      const matchFrom =
        !fFrom || (date && date >= new Date(fFrom));

      const matchTo =
        !fTo || (date && date <= new Date(fTo + "T23:59:59"));

      return (
        matchWorker &&
        matchTelefono &&
        matchCodigo &&
        matchFrom &&
        matchTo
      );
    });
  }, [rows, fWorker, fTelefono, fCodigo, fFrom, fTo]);

  if (loading) return <div className="p-4">Cargando...</div>;

  return (
    <div className="tc-card">
      {/* 🔎 FILTROS */}
      <div style={{ marginBottom: 16 }}>
        <div className="tc-title" style={{ fontSize: 14 }}>
          🔎 Filtros
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input className="tc-input" placeholder="Tarotista" value={fWorker} onChange={(e) => setFWorker(e.target.value)} />
          <input className="tc-input" placeholder="Telefonista" value={fTelefono} onChange={(e) => setFTelefono(e.target.value)} />
          <input className="tc-input" placeholder="Código" value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
          <input className="tc-input" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <input className="tc-input" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        </div>
      </div>

      {/* TABLA */}
      <div style={{ overflowX: "auto" }}>
        <table className="tc-table">
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{fmt(row.fecha_hora)}</td>
                <td>{row.telefonista_nombre}</td>
                <td>{row.tarotista_nombre}</td>
                <td>{row.cliente_nombre}</td>
                <td>{row.tiempo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
