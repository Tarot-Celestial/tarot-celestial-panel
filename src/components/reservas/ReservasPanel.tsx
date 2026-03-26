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
  mode?: "admin" | "central";
  embedded?: boolean;
};

export default function ReservasPanel({
  mode = "admin",
  embedded = false,
}: ReservasPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"todas" | "pendiente" | "finalizada">("todas");
  const [finalizandoId, setFinalizandoId] = useState("");

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
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const params = new URLSearchParams();
      if (estado !== "todas") params.set("estado", estado);

      const r = await fetch(`/api/crm/reservas/listar?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setRows(Array.isArray(j.reservas) ? j.reservas : []);
      if (!silent) {
        setMsg(`✅ Reservas cargadas: ${Array.isArray(j.reservas) ? j.reservas.length : 0}`);
      }
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
      setFinalizandoId(id);
      setMsg("");

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
    } finally {
      setFinalizandoId("");
    }
  }

  useEffect(() => {
    loadReservas(false);
    const t = setInterval(() => loadReservas(true), 15000);
    return () => clearInterval(t);
  }, [estado]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows || [];
    return (rows || []).filter((r: any) => {
      const text = [
        r?.cliente_nombre,
        r?.cliente_telefono,
        r?.tarotista_display_name,
        r?.tarotista_nombre_manual,
        r?.tarotista_worker_id,
        r?.cliente_id,
        r?.nota,
        r?.estado,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(qq);
    });
  }, [rows, q]);

  const wrapProps = embedded
    ? {}
    : { className: "tc-card" };

  return (
    <div {...wrapProps}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title">🗓️ Reservas</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Panel de reservas de tarotistas para clientas.
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="tc-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar clienta, tarotista, nota..."
            style={{ width: 280, maxWidth: "100%" }}
          />

          <select
            className="tc-input"
            value={estado}
            onChange={(e) => setEstado(e.target.value as any)}
            style={{ width: 170, colorScheme: "dark" }}
          >
            <option value="todas">Todas</option>
            <option value="pendiente">Pendientes</option>
            <option value="finalizada">Finalizadas</option>
          </select>

          <button className="tc-btn tc-btn-gold" onClick={() => loadReservas(false)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>
        {msg || " "}
      </div>

      <div className="tc-hr" />

      <div style={{ display: "grid", gap: 12 }}>
        {(filtered || []).map((r: any) => {
          const clienteNombre = r?.cliente_nombre || (r?.cliente_id ? `Cliente ${String(r.cliente_id).slice(0, 8)}` : "Cliente");
          const tarotistaNombre =
            r?.tarotista_display_name ||
            r?.tarotista_nombre_manual ||
            (r?.tarotista_worker_id ? `Worker ${String(r.tarotista_worker_id).slice(0, 8)}` : "—");

          return (
            <div
              key={r.id}
              style={{
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 16,
                padding: 14,
                background:
                  String(r?.estado || "") === "finalizada"
                    ? "rgba(120,255,190,.05)"
                    : "rgba(255,255,255,.03)",
              }}
            >
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 280 }}>
                  <div style={{ fontWeight: 900 }}>
                    {clienteNombre}
                    {r?.cliente_telefono ? (
                      <span className="tc-chip" style={{ marginLeft: 8 }}>
                        {r.cliente_telefono}
                      </span>
                    ) : null}
                  </div>

                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Tarotista: <b>{tarotistaNombre}</b>
                  </div>

                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Fecha reserva:{" "}
                    <b>
                      {r?.fecha_reserva
                        ? new Date(r.fecha_reserva).toLocaleString("es-ES")
                        : "—"}
                    </b>
                  </div>

                  {!!r?.nota && (
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Nota: {r.nota}
                    </div>
                  )}
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <span className="tc-chip">
                    {String(r?.estado || "") === "finalizada" ? "✅ Finalizada" : "⏳ Pendiente"}
                  </span>

                  {String(r?.estado || "") !== "finalizada" ? (
                    <button
                      className="tc-btn tc-btn-ok"
                      onClick={() => finalizarReserva(String(r.id))}
                      disabled={finalizandoId === String(r.id)}
                    >
                      {finalizandoId === String(r.id) ? "Guardando..." : "Finalizado"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {(!filtered || filtered.length === 0) && (
          <div className="tc-sub">No hay reservas para este filtro.</div>
        )}
      </div>
    </div>
  );
}

