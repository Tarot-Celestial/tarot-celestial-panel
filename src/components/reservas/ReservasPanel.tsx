\
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

type ReservasPanelProps = {
  mode: "admin" | "central";
  embedded?: boolean;
};

export default function ReservasPanel({ mode, embedded = false }: ReservasPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pendiente" | "finalizada" | "todas">("pendiente");
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

  async function loadReservas(silent = false) {
    if (loading && !silent) return;
    if (!silent) {
      setLoading(true);
      setMsg("");
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const qp = new URLSearchParams();
      if (statusFilter !== "todas") qp.set("estado", statusFilter);

      const r = await fetch(`/api/crm/reservas/listar?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setRows(Array.isArray(j.reservas) ? j.reservas : []);
      if (!silent) setMsg(`✅ Reservas cargadas: ${(j.reservas || []).length}`);
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando reservas"}`);
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function finalizarReserva(id: string) {
    if (!id) return;
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/reservas/finalizar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setMsg("✅ Reserva finalizada");
      await loadReservas(true);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error finalizando reserva"}`);
    }
  }

  useEffect(() => {
    loadReservas(false);
    const t = setInterval(() => loadReservas(true), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = rows || [];
    if (!qq) return list;
    return list.filter((r: any) => {
      const hay = [
        r?.cliente_nombre,
        r?.cliente_telefono,
        r?.tarotista_display_name,
        r?.tarotista_nombre_manual,
        r?.nota,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qq);
    });
  }, [rows, q]);

  return (
    <div className={embedded ? "" : "tc-card"}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title">🗓️ Reservas</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Reservas internas de tarotistas para clientas.
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="tc-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar clienta, tarotista..."
            style={{ width: 260, maxWidth: "100%" }}
          />
          <select
            className="tc-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{ width: 160, colorScheme: "dark" }}
          >
            <option value="pendiente">Pendientes</option>
            <option value="finalizada">Finalizadas</option>
            <option value="todas">Todas</option>
          </select>
          <button className="tc-btn tc-btn-gold" onClick={() => loadReservas(false)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || " "}</div>
      <div className="tc-hr" />

      <div style={{ display: "grid", gap: 12 }}>
        {(filtered || []).map((r: any) => (
          <div
            key={r.id}
            style={{
              border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 14,
              padding: 14,
              background: String(r.estado || "") === "pendiente" ? "rgba(255,255,255,.03)" : "rgba(120,255,190,.04)",
            }}
          >
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900 }}>
                  {r.cliente_nombre || "Cliente"}{" "}
                  {r.cliente_telefono ? <span className="tc-chip" style={{ marginLeft: 8 }}>{r.cliente_telefono}</span> : null}
                </div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Tarotista: <b>{r.tarotista_display_name || r.tarotista_nombre_manual || "—"}</b>
                </div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Reserva: <b>{r.fecha_reserva ? new Date(r.fecha_reserva).toLocaleString("es-ES") : "—"}</b>
                </div>
                {!!r.nota && (
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Nota: {r.nota}
                  </div>
                )}
              </div>

              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                <span className="tc-chip">
                  {String(r.estado || "") === "finalizada" ? "✅ Finalizada" : "⏳ Pendiente"}
                </span>
                {String(r.estado || "") !== "finalizada" ? (
                  <button className="tc-btn tc-btn-ok" onClick={() => finalizarReserva(String(r.id))}>
                    Finalizado
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {(!filtered || filtered.length === 0) && (
          <div className="tc-sub">No hay reservas en este filtro.</div>
        )}
      </div>
    </div>
  );
}
