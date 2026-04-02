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

type ReservasPanelProps = {
  mode?: "admin" | "central";
  embedded?: boolean;
};

function normalizeEstado(v: any) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "finalizada" || s === "completada") return "finalizada";
  if (s === "confirmada") return "confirmada";
  if (s === "cancelada") return "cancelada";
  return "pendiente";
}

function isClosedEstado(v: any) {
  return normalizeEstado(v) === "finalizada";
}

function estadoLabel(v: any) {
  const s = normalizeEstado(v);
  if (s === "finalizada") return "✅ Finalizada";
  if (s === "confirmada") return "🟢 Confirmada";
  if (s === "cancelada") return "❌ Cancelada";
  return "⏳ Pendiente";
}

function estadoStyles(v: any) {
  const s = normalizeEstado(v);

  if (s === "finalizada") {
    return {
      border: "1px solid rgba(120,255,190,.20)",
      background: "linear-gradient(180deg, rgba(120,255,190,.06), rgba(255,255,255,.02))",
      boxShadow: "0 12px 32px rgba(0,0,0,.18)",
      chipBg: "rgba(120,255,190,.10)",
      chipBorder: "1px solid rgba(120,255,190,.22)",
    };
  }

  if (s === "cancelada") {
    return {
      border: "1px solid rgba(255,80,80,.20)",
      background: "linear-gradient(180deg, rgba(255,80,80,.06), rgba(255,255,255,.02))",
      boxShadow: "0 12px 32px rgba(0,0,0,.18)",
      chipBg: "rgba(255,80,80,.10)",
      chipBorder: "1px solid rgba(255,80,80,.22)",
    };
  }

  if (s === "confirmada") {
    return {
      border: "1px solid rgba(120,255,190,.16)",
      background: "linear-gradient(180deg, rgba(120,255,190,.04), rgba(255,255,255,.02))",
      boxShadow: "0 12px 32px rgba(0,0,0,.18)",
      chipBg: "rgba(120,255,190,.08)",
      chipBorder: "1px solid rgba(120,255,190,.18)",
    };
  }

  return {
    border: "1px solid rgba(215,181,109,.22)",
    background: "linear-gradient(180deg, rgba(215,181,109,.08), rgba(255,255,255,.02))",
    boxShadow: "0 14px 36px rgba(0,0,0,.22), 0 0 0 1px rgba(215,181,109,.06) inset",
    chipBg: "rgba(215,181,109,.12)",
    chipBorder: "1px solid rgba(215,181,109,.24)",
  };
}

function formatFecha(value: any) {
  if (!value) return "—";
  try {
    return new Date(value + 'Z').toLocaleString("es-ES");
  } catch {
    return String(value);
  }
}

export default function ReservasPanel({
  mode = "admin",
  embedded = false,
}: ReservasPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"proximas" | "hoy" | "todas" | "finalizadas">("proximas");
  const [finalizandoId, setFinalizandoId] = useState("");

  const [popupReserva, setPopupReserva] = useState<any | null>(null);
  const [avisadas, setAvisadas] = useState<string[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();

      rows.forEach((r: any) => {
        if (!r?.fecha_reserva) return;

        const fecha = new Date(r.fecha_reserva + 'Z');
        const diff = fecha.getTime() - now.getTime();

        const yaAvisada = avisadas.includes(r.id);

        if (diff <= 30000 && diff >= -30000 && !yaAvisada && !isClosedEstado(r.estado)) {
          setAvisadas((prev) => [...prev, r.id]);
          setPopupReserva(r);
        }
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [rows, avisadas]);


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

      const r = await fetch("/api/crm/reservas/listar", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      const nextRows = Array.isArray(j.reservas) ? j.reservas : [];
      setRows(nextRows);

      if (!silent) {
        setMsg(`✅ Reservas cargadas: ${nextRows.length}`);
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

      setRows((prev) =>
        prev.map((row) =>
          String(row?.id) === String(id)
            ? { ...row, estado: "finalizada" }
            : row
        )
      );

      setMsg("✅ Reserva finalizada");
      tcToast({
        title: "Reserva finalizada",
        description: "Todo correcto",
        tone: "success",
      });

      await loadReservas(true);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error finalizando reserva"}`);
      tcToast({
        title: "Error finalizando reserva",
        description: e?.message || "Inténtalo de nuevo",
        tone: "error",
      });
    } finally {
      setFinalizandoId("");
    }
  }

  useEffect(() => {
    loadReservas(false);
    const t = setInterval(() => loadReservas(true), 15000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const now = new Date();
    const end2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    let list = [...(rows || [])];

    list = list.filter((r: any) => {
      const fecha = r?.fecha_reserva ? new Date(r.fecha_reserva + 'Z') : null;
      const closed = isClosedEstado(r?.estado);

      if (filtro === "finalizadas") return closed;
      if (filtro === "todas") return true;
      if (!fecha || Number.isNaN(fecha.getTime())) return true;

      if (filtro === "hoy") {
        return fecha >= startDay && fecha <= endDay;
      }

      return !closed && fecha >= now && fecha <= end2h;
    });

    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter((r: any) => {
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
    }

    list.sort((a: any, b: any) => {
      const ae = isClosedEstado(a?.estado) ? 1 : 0;
      const be = isClosedEstado(b?.estado) ? 1 : 0;
      if (ae !== be) return ae - be;

      const at = a?.fecha_reserva ? new Date(a.fecha_reserva).getTime() : 0;
      const bt = b?.fecha_reserva ? new Date(b.fecha_reserva).getTime() : 0;

      if (ae === 0) return at - bt;
      return bt - at;
    });

    return list;
  }, [rows, q, filtro]);

  const pendientes = (rows || []).filter((x: any) => !isClosedEstado(x?.estado)).length;
  const finalizadas = (rows || []).filter((x: any) => isClosedEstado(x?.estado)).length;

  const wrapProps = embedded ? {} : { className: "tc-card" };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        className="tc-card"
        style={{
          padding: 22,
          borderRadius: 24,
          background:
            "radial-gradient(circle at top right, rgba(215,181,109,.18), transparent 26%), radial-gradient(circle at top left, rgba(181,156,255,.12), transparent 22%), linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03))",
        }}
      >
        <div
          className="tc-row"
          style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}
        >
          <div>
            <div className="tc-title" style={{ fontSize: 24 }}>🗓️ Reservas premium</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 760 }}>
              Vista operativa en tiempo real para {mode === "admin" ? "admin" : "centrales"}, con prioridades claras y foco en próximas acciones.
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tc-chip">Pendientes: {pendientes}</span>
            <span className="tc-chip">Finalizadas: {finalizadas}</span>
            <span className="tc-chip">Total: {(rows || []).length}</span>
          </div>
        </div>
      </div>

      <div {...wrapProps}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div className="tc-title">🗓️ Reservas</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Gestión pro de reservas para {mode === "admin" ? "admin" : "centrales"}.
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

            <button className={`tc-btn ${filtro === "proximas" ? "tc-btn-gold" : ""}`} onClick={() => setFiltro("proximas")}>
              Próximas 2h
            </button>
            <button className={`tc-btn ${filtro === "hoy" ? "tc-btn-gold" : ""}`} onClick={() => setFiltro("hoy")}>
              Hoy
            </button>
            <button className={`tc-btn ${filtro === "todas" ? "tc-btn-gold" : ""}`} onClick={() => setFiltro("todas")}>
              Todas
            </button>
            <button className={`tc-btn ${filtro === "finalizadas" ? "tc-btn-gold" : ""}`} onClick={() => setFiltro("finalizadas")}>
              Finalizadas
            </button>

            <button className="tc-btn" onClick={() => loadReservas(false)} disabled={loading}>
              {loading ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </div>

        <div className="tc-sub" style={{ marginTop: 10 }}>
          {msg || " "}
        </div>

        <div className="tc-hr" />

        <div style={{ display: "grid", gap: 14 }}>
          {(filtered || []).map((r: any) => {
            const clienteNombre =
              r?.cliente_nombre || (r?.cliente_id ? `Cliente ${String(r.cliente_id).slice(0, 8)}` : "Cliente");

            const tarotistaNombre =
              r?.tarotista_display_name ||
              r?.tarotista_nombre ||
              r?.tarotista_nombre_manual ||
              (r?.tarotista_worker_id ? `Worker ${String(r.tarotista_worker_id).slice(0, 8)}` : "—");

            const st = estadoStyles(r?.estado);

            return (
              <div
                key={r.id}
                style={{
                  border: st.border,
                  borderRadius: 18,
                  padding: 16,
                  background: st.background,
                  boxShadow: st.boxShadow,
                  transition: "transform .18s ease, box-shadow .18s ease",
                }}
              >
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 280, flex: 1 }}>
                    <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>
                        {clienteNombre}
                      </div>

                      {r?.cliente_telefono ? <span className="tc-chip">{r.cliente_telefono}</span> : null}

                      <span
                        className="tc-chip"
                        style={{
                          background: st.chipBg,
                          border: st.chipBorder,
                        }}
                      >
                        {estadoLabel(r?.estado)}
                      </span>
                    </div>

                    <div className="tc-sub" style={{ marginTop: 10 }}>
                      Tarotista: <b>{tarotistaNombre}</b>
                    </div>

                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Reserva: <b>{formatFecha(r?.fecha_reserva)}</b>
                    </div>

                    {!!r?.nota && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,.08)",
                          background: "rgba(255,255,255,.03)",
                          lineHeight: 1.5,
                        }}
                      >
                        <div className="tc-sub" style={{ marginBottom: 4 }}>Observación</div>
                        <div>{r.nota}</div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 8, minWidth: 160 }}>
                    {!isClosedEstado(r?.estado) ? (
                      <button
                        className="tc-btn tc-btn-ok"
                        onClick={() => finalizarReserva(String(r.id))}
                        disabled={finalizandoId === String(r.id)}
                      >
                        {finalizandoId === String(r.id) ? "Guardando..." : "Finalizado"}
                      </button>
                    ) : (
                      <button className="tc-btn" disabled>
                        Cerrada
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {(!filtered || filtered.length === 0) && (
            <div
              style={{
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 18,
                padding: 24,
                background: "rgba(255,255,255,.02)",
              }}
            >
              <div className="tc-title" style={{ fontSize: 16 }}>No hay reservas en este filtro</div>
              <div className="tc-sub" style={{ marginTop: 8 }}>
                Prueba con “Todas” o “Hoy” para ver más resultados.
              </div>
            </div>
          )}
        </div>
      </div>
    
      {popupReserva && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999
        }}>
          <div style={{
            background: "#111",
            padding: 30,
            borderRadius: 16,
            width: 420,
            textAlign: "center"
          }}>
            <h2>⏰ Reserva ahora</h2>
            <p><strong>{popupReserva.cliente_nombre}</strong></p>
            <p>{new Date(popupReserva.fecha_reserva + 'Z').toLocaleString("es-ES")}</p>
            <button className="tc-btn tc-btn-ok" onClick={() => setPopupReserva(null)}>
              Ir a la reserva
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

