"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { tcToast } from "@/lib/tc-toast";

const sb = supabaseBrowser();

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

type HabitualesPanelProps = {
  mode?: "admin" | "central";
  embedded?: boolean;
};

export default function HabitualesPanel({
  mode = "admin",
  embedded = false,
}: HabitualesPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadHabituales(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/habituales/listar", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      tcToast({ title: "Habituales actualizados", description: "Clientes cargados correctamente", tone: "info", duration: 2500 });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setRows(Array.isArray(j.clientes) ? j.clientes : []);
      if (!silent) setMsg(`✅ Habituales cargados: ${Array.isArray(j.clientes) ? j.clientes.length : 0}`);
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando habituales"}`);
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadHabituales(false);
    const t = setInterval(() => loadHabituales(true), 20000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows || [];
    return (rows || []).filter((r: any) =>
      [r?.nombre, r?.telefono, r?.ultima_llamada]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(qq)
    );
  }, [rows, q]);

  const wrapProps = embedded ? {} : { className: "tc-card" };

  return (
    <div {...wrapProps}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div className="tc-title">⭐ Habituales</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Clientes con pagos en los últimos 2 meses.
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="tc-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nombre o teléfono..."
            style={{ width: 260, maxWidth: "100%" }}
          />
          <button className="tc-btn tc-btn-gold" onClick={() => loadHabituales(false)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>
      <div className="tc-hr" />

      <div style={{ overflowX: "auto" }}>
        <table className="tc-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Última llamada</th>
              <th>Teléfono</th>
            </tr>
          </thead>
          <tbody>
            {(filtered || []).map((r: any) => (
              <tr key={r.id || `${r.nombre}-${r.telefono}`}>
                <td><b>{r.nombre || "—"}</b></td>
                <td>{r.ultima_llamada ? new Date(r.ultima_llamada).toLocaleString("es-ES") : "—"}</td>
                <td>{r.telefono || "—"}</td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="tc-muted">No hay clientes habituales en los últimos 2 meses.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
