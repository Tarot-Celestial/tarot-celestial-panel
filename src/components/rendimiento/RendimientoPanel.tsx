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
  if (row.promo) {
    return {
      label: "Promo",
      style: {
        background: "rgba(215,181,109,0.16)",
        borderColor: "rgba(215,181,109,0.32)",
        color: "#f7dfab",
      },
    };
  }
  if (row.captado) {
    return {
      label: "Captado",
      style: {
        background: "rgba(105,240,177,0.12)",
        borderColor: "rgba(105,240,177,0.30)",
        color: "#9dffd1",
      },
    };
  }
  if (row.recuperado) {
    return {
      label: "Recuperado",
      style: {
        background: "rgba(181,156,255,0.15)",
        borderColor: "rgba(181,156,255,0.34)",
        color: "#dacdff",
      },
    };
  }
  if (row.tipo_registro === "compra") {
    return {
      label: "Compra",
      style: {
        background: "rgba(255,255,255,0.08)",
        borderColor: "rgba(255,255,255,0.16)",
        color: "rgba(255,255,255,0.9)",
      },
    };
  }
  if (row.tipo_registro === "7free") {
    return {
      label: "7 Free",
      style: {
        background: "rgba(255,90,106,0.12)",
        borderColor: "rgba(255,90,106,0.28)",
        color: "#ffb0b8",
      },
    };
  }
  return {
    label: "Minutos",
    style: {
      background: "rgba(255,255,255,0.08)",
      borderColor: "rgba(255,255,255,0.16)",
      color: "rgba(255,255,255,0.88)",
    },
  };
}

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [pago, setPago] = useState("todos");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
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

  async function importApril() {
    if (mode !== "admin" || importing) return;
    try {
      setImporting(true);
      const token = await getTokenOrLogin();
      if (!token) return;

      const res = await fetch("/api/admin/rendimiento/import-sheet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ month: "2026-04" }),
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "No se pudo importar abril");

      setMsg(`✅ Abril importado: ${json.inserted || 0} filas nuevas`);
      await fetchData(false);
    } catch (err: any) {
      setMsg(`❌ ${err?.message || "Error importando abril"}`);
    } finally {
      setImporting(false);
    }
  }

  function openEdit(row: Row) {
    setEditing({ ...row });
  }

  async function saveEdit() {
    if (!editing?.id || saving) return;

    try {
      setSaving(true);
      const token = await getTokenOrLogin();
      if (!token) return;

      const updates = {
        cliente_nombre: editing.cliente_nombre ?? null,
        telefonista_nombre: editing.telefonista_nombre ?? null,
        tarotista_nombre: editing.tarotista_nombre ?? null,
        tarotista_manual_call: editing.tarotista_manual_call ?? null,
        tiempo: Number(editing.tiempo) || 0,
        llamada_call: Boolean(editing.llamada_call),
        resumen_codigo: editing.resumen_codigo ?? null,
        forma_pago: editing.forma_pago ?? null,
        importe: editing.importe === null || editing.importe === undefined || editing.importe === ""
          ? null
          : Number(editing.importe),
        promo: Boolean(editing.promo),
        captado: Boolean(editing.captado),
        recuperado: Boolean(editing.recuperado),
      };

      const res = await fetch("/api/crm/rendimiento/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editing.id,
          updates,
        }),
      });

      const json = await res.json();
      if (!json?.ok) {
        throw new Error(json?.error || "No se pudo guardar");
      }

      setMsg("✅ Registro actualizado");
      setEditing(null);
      await fetchData(true);
    } catch (err: any) {
      setMsg(`❌ ${err?.message || "Error guardando cambios"}`);
    } finally {
      setSaving(false);
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
      const hayTexto =
        !qq ||
        [
          row.id_unico,
          row.cliente_nombre,
          row.telefonista_nombre,
          row.tarotista_nombre,
          row.tarotista_manual_call,
          row.resumen_codigo,
          row.forma_pago,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(qq);

      const hayTipo =
        tipo === "todos" ||
        (tipo === "compra" && row.tipo_registro === "compra") ||
        (tipo === "minutos" && row.tipo_registro === "minutos") ||
        (tipo === "7free" && row.tipo_registro === "7free") ||
        (tipo === "promo" && Boolean(row.promo)) ||
        (tipo === "captado" && Boolean(row.captado)) ||
        (tipo === "recuperado" && Boolean(row.recuperado));

      const forma = String(row.forma_pago || "").toUpperCase();
      const hayPago = pago === "todos" || forma === pago;

      return hayTexto && hayTipo && hayPago;
    });
  }, [rows, q, tipo, pago]);

  const metrics = useMemo(() => {
    const total = filtered.length;
    const ventas = filtered.filter((r) => r.tipo_registro === "compra").length;
    const importe = filtered.reduce((acc, r) => acc + (Number(r.importe) || 0), 0);
    const minutos = filtered.reduce((acc, r) => acc + (Number(r.tiempo) || 0), 0);
    return { total, ventas, importe, minutos };
  }, [filtered]);

  return (
    <div className="tc-card">
      <div
        className="tc-row"
        style={{ justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}
      >
        <div>
          <div className="tc-title">📈 Rendimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {mode === "central"
              ? "Tus llamadas, compras y uso de minutos registrados desde el CRM."
              : "Vista global de llamadas registradas por el equipo desde el CRM."}
          </div>
        </div>

        <div
          className="tc-row"
          style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
        >
          <span className="tc-chip">Vista: {mode === "central" ? "Central" : "Admin"}</span>
          {mode === "admin" ? (
            <button className="tc-btn tc-btn-gold" onClick={importApril} disabled={importing}>
              {importing ? "Importando abril…" : "Importar abril desde Sheets"}
            </button>
          ) : null}
          <button className="tc-btn" onClick={() => fetchData(false)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>
        {msg || " "}
      </div>

      <div className="tc-grid-4" style={{ marginTop: 12 }}>
        <div className="tc-card">
          <div className="tc-sub">Registros</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{metrics.total}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Compras</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{metrics.ventas}</div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Importe</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>
            {eur(metrics.importe)}
          </div>
        </div>
        <div className="tc-card">
          <div className="tc-sub">Minutos movidos</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{metrics.minutos}</div>
        </div>
      </div>

      <div className="tc-hr" />

      <div className="tc-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="tc-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente, telefonista, tarotista o código..."
          style={{ width: 320, maxWidth: "100%" }}
        />

        <select
          className="tc-select"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          style={{ width: 180 }}
        >
          <option value="todos">Todos los tipos</option>
          <option value="compra">Compra</option>
          <option value="minutos">Uso minutos</option>
          <option value="7free">7 free</option>
          <option value="promo">Promo</option>
          <option value="captado">Captado</option>
          <option value="recuperado">Recuperado</option>
        </select>

        <select
          className="tc-select"
          value={pago}
          onChange={(e) => setPago(e.target.value)}
          style={{ width: 170 }}
        >
          <option value="todos">Todos los pagos</option>
          <option value="TPV">TPV</option>
          <option value="PAYPAL">PAYPAL</option>
          <option value="BIZUM">BIZUM</option>
          <option value="OTROS">OTROS</option>
        </select>
      </div>

      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>FECHA</th>
              <th>TELEFONISTA</th>
              <th>CLIENTES</th>
              <th>TAROTISTA</th>
              <th>TIEMPO</th>
              <th>Llamada call</th>
              <th>Codigo</th>
              <th>FORMA DE PAGO</th>
              <th>IMPORTE</th>
              <th>PROMO</th>
              <th>CAPTADO</th>
              <th>Recuperado</th>
              <th>Editar</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((row) => (
              <tr key={String(row.id || `${row.id_unico}-${row.fecha_hora}`)}>
                <td>
                  <div style={{ fontWeight: 700 }}>{fmtDate(row.fecha_hora || row.fecha || null)}</div>
                </td>

                <td>{row.telefonista_nombre || "—"}</td>

                <td>
                  <div style={{ fontWeight: 800 }}>{row.cliente_nombre || "—"}</div>
                  <div className="tc-sub">#{row.id_unico || "—"}</div>
                </td>

                <td>
                  <div>{row.tarotista_nombre || row.tarotista_manual_call || "—"}</div>
                </td>

                <td>{Number(row.tiempo) || 0} min</td>

                <td>{row.llamada_call ? "Sí" : "No"}</td>

                <td>{row.resumen_codigo || "—"}</td>

                <td>{row.forma_pago || "—"}</td>

                <td>{Number(row.importe) ? eur(row.importe) : "—"}</td>

                <td>{row.promo ? "Sí" : "—"}</td>

                <td>{row.captado ? "Sí" : "—"}</td>

                <td>{row.recuperado ? "Sí" : "—"}</td>

                <td>
                  <button className="tc-btn" onClick={() => openEdit(row)}>
                    ✏️ Editar
                  </button>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={13}>
                  <div
                    className="tc-card"
                    style={{
                      margin: "8px 0",
                      textAlign: "center",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>
                    <div style={{ fontWeight: 800 }}>No hay registros para los filtros actuales</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Prueba quitando filtros o registra una llamada desde la ficha del cliente.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          className="fixed inset-0"
          style={{
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 80,
            padding: 16,
          }}
        >
          <div className="tc-card" style={{ width: 760, maxWidth: "100%" }}>
            <div
              className="tc-row"
              style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
            >
              <div>
                <div className="tc-title">✏️ Editar registro</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Modifica el registro y guarda los cambios.
                </div>
              </div>

              <button className="tc-btn" onClick={() => setEditing(null)} disabled={saving}>
                Cerrar
              </button>
            </div>

            <div className="tc-grid-2" style={{ gap: 12 }}>
              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Telefonista</div>
                <input
                  className="tc-input"
                  value={editing.telefonista_nombre || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, telefonista_nombre: e.target.value })
                  }
                />
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Cliente</div>
                <input
                  className="tc-input"
                  value={editing.cliente_nombre || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, cliente_nombre: e.target.value })
                  }
                />
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Tarotista</div>
                <input
                  className="tc-input"
                  value={editing.tarotista_nombre || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, tarotista_nombre: e.target.value })
                  }
                />
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Tarotista CALL manual</div>
                <input
                  className="tc-input"
                  value={editing.tarotista_manual_call || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, tarotista_manual_call: e.target.value })
                  }
                />
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Tiempo</div>
                <input
                  className="tc-input"
                  type="number"
                  min={0}
                  value={editing.tiempo ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, tiempo: Number(e.target.value) })
                  }
                />
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Código</div>
                <input
                  className="tc-input"
                  value={editing.resumen_codigo || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, resumen_codigo: e.target.value })
                  }
                />
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Forma de pago</div>
                <select
                  className="tc-select"
                  value={editing.forma_pago || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, forma_pago: e.target.value || null })
                  }
                >
                  <option value="">—</option>
                  <option value="TPV">TPV</option>
                  <option value="PAYPAL">PAYPAL</option>
                  <option value="BIZUM">BIZUM</option>
                  <option value="OTROS">OTROS</option>
                </select>
              </div>

              <div>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Importe</div>
                <input
                  className="tc-input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={editing.importe ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      importe: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            <div className="tc-row" style={{ gap: 18, marginTop: 16, flexWrap: "wrap" }}>
              <label className="tc-row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(editing.llamada_call)}
                  onChange={(e) =>
                    setEditing({ ...editing, llamada_call: e.target.checked })
                  }
                />
                <span>Llamada call</span>
              </label>

              <label className="tc-row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(editing.promo)}
                  onChange={(e) =>
                    setEditing({ ...editing, promo: e.target.checked })
                  }
                />
                <span>Promo</span>
              </label>

              <label className="tc-row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(editing.captado)}
                  onChange={(e) =>
                    setEditing({ ...editing, captado: e.target.checked })
                  }
                />
                <span>Captado</span>
              </label>

              <label className="tc-row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(editing.recuperado)}
                  onChange={(e) =>z  
                    setEditing({ ...editing, recuperado: e.target.checked })
                  }
                />
                <span>Recuperado</span>
              </label>
            </div>

            <div className="tc-hr" />

            <div className="tc-row" style={{ justifyContent: "flex-end", gap: 10 }}>
              <button className="tc-btn" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </button>
              <button className="tc-btn tc-btn-gold" onClick={saveEdit} disabled={saving}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
