"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Lead = {
  id: string;
  cliente_id: string | null;
  estado: string | null;
  intento_actual?: number | null;
  max_intentos?: number | null;
  next_contact_at?: string | null;
  last_contact_at?: string | null;
  contacted_at?: string | null;
  closed_at?: string | null;
  last_result?: string | null;
  campaign_name?: string | null;
  form_name?: string | null;
  origen?: string | null;
  notas?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  cliente?: {
    id?: string | null;
    nombre?: string | null;
    apellido?: string | null;
    telefono?: string | null;
    email?: string | null;
    origen?: string | null;
    estado?: string | null;
    lead_status?: string | null;
    lead_campaign_name?: string | null;
    lead_form_name?: string | null;
    created_at?: string | null;
  } | null;
};

const sb = supabaseBrowser();

type Props = {
  onOpenClient?: (clienteId: string) => void;
};

function fullName(lead: Lead) {
  const nombre = [lead.cliente?.nombre, lead.cliente?.apellido]
    .filter(Boolean)
    .join(" ")
    .trim();
  return nombre || "Lead sin nombre";
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

function minutesAgo(value?: string | null) {
  if (!value) return null;
  const d = new Date(value).getTime();
  if (!Number.isFinite(d)) return null;
  const diff = Math.max(0, Math.floor((Date.now() - d) / 60000));
  return diff;
}

function timeLabelFromMinutes(mins: number | null) {
  if (mins === null) return "—";
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}

function stateLabel(s?: string | null) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "nuevo") return "🔥 Nuevo";
  if (x === "reintento_2") return "📞 2º intento";
  if (x === "reintento_3") return "📞 3º intento";
  if (x === "contactado") return "✅ Contactado";
  if (x === "no_interesado") return "🙅 No interesado";
  if (x === "numero_invalido") return "❌ Número inválido";
  if (x === "perdido") return "⌛ Perdido";
  return x;
}

function stateStyle(s?: string | null) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "contactado") {
    return {
      background: "rgba(34,197,94,0.14)",
      color: "#b9f8c9",
      border: "1px solid rgba(34,197,94,0.35)",
    };
  }
  if (x === "no_interesado" || x === "numero_invalido" || x === "perdido") {
    return {
      background: "rgba(239,68,68,0.14)",
      color: "#ffc3c3",
      border: "1px solid rgba(239,68,68,0.35)",
    };
  }
  if (x === "reintento_2" || x === "reintento_3") {
    return {
      background: "rgba(245,158,11,0.14)",
      color: "#ffe1a8",
      border: "1px solid rgba(245,158,11,0.35)",
    };
  }
  return {
    background: "rgba(139,92,246,0.14)",
    color: "#e2d4ff",
    border: "1px solid rgba(139,92,246,0.35)",
  };
}

function priorityMeta(lead: Lead) {
  const nextTs = lead.next_contact_at ? new Date(lead.next_contact_at).getTime() : null;
  const createdTs = lead.created_at ? new Date(lead.created_at).getTime() : null;
  const baseTs = Number.isFinite(nextTs) ? nextTs : createdTs;
  if (!Number.isFinite(baseTs)) {
    return {
      tone: "normal",
      cardBorder: "1px solid rgba(255,255,255,0.08)",
      cardBg: "rgba(255,255,255,0.03)",
      badge: "Normal",
      badgeColor: "rgba(255,255,255,0.16)",
    };
  }

  const diff = Date.now() - Number(baseTs);

  if (diff >= 60 * 60 * 1000) {
    return {
      tone: "critical",
      cardBorder: "1px solid rgba(239,68,68,0.42)",
      cardBg: "rgba(239,68,68,0.09)",
      badge: "Crítico",
      badgeColor: "rgba(239,68,68,0.20)",
    };
  }

  if (diff >= 10 * 60 * 1000) {
    return {
      tone: "high",
      cardBorder: "1px solid rgba(245,158,11,0.42)",
      cardBg: "rgba(245,158,11,0.08)",
      badge: "Urgente",
      badgeColor: "rgba(245,158,11,0.18)",
    };
  }

  return {
    tone: "normal",
    cardBorder: "1px solid rgba(255,255,255,0.08)",
    cardBg: "rgba(255,255,255,0.03)",
    badge: "Normal",
    badgeColor: "rgba(255,255,255,0.12)",
  };
}

export default function CaptacionPanel({ onOpenClient }: Props) {
  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [view, setView] = useState<"pendientes" | "todos">("pendientes");
  const [msg, setMsg] = useState("");

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setLoading(true);
      setMsg("");

      const res = await fetch(`/api/captacion/list?scope=${view}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "No se pudo cargar captación");
      }

      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando captación");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  async function act(id: string, action: "contactado" | "no_responde" | "no_interesado" | "numero_invalido") {
    try {
      setBusyId(id);
      setMsg("");

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;

      const res = await fetch("/api/captacion/action", {
        method: "POST",
        body: JSON.stringify({ lead_id: id, action }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "No se pudo actualizar el lead");
      }

      if (action === "contactado" || action === "no_interesado" || action === "numero_invalido") {
        setItems((prev) => prev.filter((l) => l.id !== id));
      } else {
        await load(false);
      }

      if (json?.message) setMsg(json.message);
    } catch (e: any) {
      setMsg(e?.message || "Error actualizando lead");
    } finally {
      setBusyId("");
    }
  }

  function openClient(lead: Lead) {
    const id = String(lead.cliente_id || lead.cliente?.id || "").trim();
    if (!id) return;

    if (onOpenClient) {
      onOpenClient(id);
      return;
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("captacion-open-cliente", { detail: { id } }));
    }
  }

  useEffect(() => {
    load(true);
  }, [view]);

  useEffect(() => {
    const t = setInterval(() => load(false), 15000);
    return () => clearInterval(t);
  }, [view]);

  const stats = useMemo(() => {
    const open = items.filter((x) =>
      !["contactado", "no_interesado", "numero_invalido", "perdido"].includes(String(x.estado || ""))
    ).length;

    const urgent = items.filter((x) => {
      const meta = priorityMeta(x);
      return meta.tone === "high" || meta.tone === "critical";
    }).length;

    const retry = items.filter((x) =>
      ["reintento_2", "reintento_3"].includes(String(x.estado || ""))
    ).length;

    const nowCalls = items.filter((x) => {
      if (!x.next_contact_at) return true;
      const ts = new Date(x.next_contact_at).getTime();
      return Number.isFinite(ts) && ts <= Date.now();
    }).length;

    return { open, urgent, retry, nowCalls };
  }, [items]);

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>🔥 Captación</div>
            <div style={{ opacity: 0.68, marginTop: 6 }}>
              Leads nuevos, seguimiento y reintentos de llamada.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => setView("pendientes")}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background:
                  view === "pendientes"
                    ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                    : "rgba(255,255,255,0.08)",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🔥 Pendientes
            </button>

            <button
              onClick={() => setView("todos")}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background:
                  view === "todos"
                    ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                    : "rgba(255,255,255,0.08)",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📋 Todos
            </button>

            <button
              onClick={() => load(true)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {loading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(4,minmax(0,1fr))",
            gap: 12,
          }}
        >
          <div style={kpiStyle()}>
            <div style={kpiLabelStyle()}>Pendientes</div>
            <div style={kpiValueStyle()}>{stats.open}</div>
          </div>

          <div style={kpiStyle()}>
            <div style={kpiLabelStyle()}>Llamar ahora</div>
            <div style={kpiValueStyle()}>{stats.nowCalls}</div>
          </div>

          <div style={kpiStyle()}>
            <div style={kpiLabelStyle()}>Urgentes</div>
            <div style={kpiValueStyle()}>{stats.urgent}</div>
          </div>

          <div style={kpiStyle()}>
            <div style={kpiLabelStyle()}>Reintentos</div>
            <div style={kpiValueStyle()}>{stats.retry}</div>
          </div>
        </div>

        {msg ? (
          <div style={{ marginTop: 14, color: "#ffb4b4" }}>
            {msg}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
        {!loading && !items.length ? (
          <div
            style={{
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: 18,
              opacity: 0.75,
            }}
          >
            No hay leads en esta vista.
          </div>
        ) : null}

        {items.map((lead) => {
          const meta = priorityMeta(lead);
          const sinceCreated = timeLabelFromMinutes(minutesAgo(lead.created_at));
          const nextContactIn = timeLabelFromMinutes(minutesAgo(lead.next_contact_at));
          const full = fullName(lead);

          return (
            <div
              key={lead.id}
              style={{
                borderRadius: 18,
                padding: 16,
                background: meta.cardBg,
                border: meta.cardBorder,
                boxShadow: meta.tone === "critical" ? "0 0 24px rgba(239,68,68,0.12)" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    {full}
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.78 }}>
                    {lead.cliente?.telefono || "Sin teléfono"}
                    {lead.cliente?.email ? ` · ${lead.cliente.email}` : ""}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={chipStyle(meta.badgeColor)}>
                      {meta.badge}
                    </span>

                    <span style={chipStyle(stateStyle(lead.estado).background, stateStyle(lead.estado).color, stateStyle(lead.estado).border)}>
                      {stateLabel(lead.estado)}
                    </span>

                    <span style={chipStyle("rgba(255,255,255,0.08)")}>
                      Intento {lead.intento_actual || 1}/{lead.max_intentos || 3}
                    </span>
                  </div>
                </div>

                <div style={{ minWidth: 260 }}>
                  <div style={{ opacity: 0.72 }}>
                    Entrada: <b>{fmtDate(lead.created_at)}</b>
                  </div>
                  <div style={{ opacity: 0.72, marginTop: 6 }}>
                    Próximo contacto: <b>{fmtDate(lead.next_contact_at)}</b>
                  </div>
                  <div style={{ opacity: 0.72, marginTop: 6 }}>
                    Tiempo desde entrada: <b>{sinceCreated}</b>
                  </div>
                  <div style={{ opacity: 0.72, marginTop: 6 }}>
                    Vencimiento contacto: <b>{nextContactIn}</b>
                  </div>
                </div>
              </div>

              {(lead.campaign_name || lead.form_name || lead.origen || lead.cliente?.origen) ? (
                <div style={{ marginTop: 12, opacity: 0.64 }}>
                  {[lead.campaign_name, lead.form_name, lead.origen || lead.cliente?.origen]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              ) : null}

              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => openClient(lead)}
                  style={buttonStyle("rgba(255,255,255,0.10)")}
                >
                  👤 Abrir ficha
                </button>

                <a
                  href={lead.cliente?.telefono ? `tel:${lead.cliente.telefono}` : undefined}
                  style={{ textDecoration: "none" }}
                >
                  <button
                    disabled={!lead.cliente?.telefono}
                    style={buttonStyle("#0ea5e9", !lead.cliente?.telefono)}
                  >
                    📞 Llamar
                  </button>
                </a>

                <button
                  disabled={busyId === lead.id}
                  onClick={() => act(lead.id, "contactado")}
                  style={buttonStyle("#22c55e", busyId === lead.id)}
                >
                  ✅ Contactado
                </button>

                <button
                  disabled={busyId === lead.id}
                  onClick={() => act(lead.id, "no_responde")}
                  style={buttonStyle("#f59e0b", busyId === lead.id)}
                >
                  📞 No responde
                </button>

                <button
                  disabled={busyId === lead.id}
                  onClick={() => act(lead.id, "no_interesado")}
                  style={buttonStyle("#6366f1", busyId === lead.id)}
                >
                  🙅 No interesado
                </button>

                <button
                  disabled={busyId === lead.id}
                  onClick={() => act(lead.id, "numero_invalido")}
                  style={buttonStyle("#ef4444", busyId === lead.id)}
                >
                  ❌ Número inválido
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function kpiStyle(): React.CSSProperties {
  return {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    padding: 14,
  };
}

function kpiLabelStyle(): React.CSSProperties {
  return {
    opacity: 0.65,
    fontSize: 13,
    marginBottom: 6,
  };
}

function kpiValueStyle(): React.CSSProperties {
  return {
    fontSize: 26,
    fontWeight: 800,
  };
}

function chipStyle(
  background: string,
  color = "white",
  border = "1px solid rgba(255,255,255,0.08)"
): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background,
    color,
    border,
    fontSize: 12,
    fontWeight: 700,
  };
}

function buttonStyle(background: string, disabled = false): React.CSSProperties {
  return {
    background,
    color: "white",
    border: "none",
    padding: "8px 12px",
    borderRadius: 10,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}
