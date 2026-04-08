"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type LeadItem = {
  id: string;
  cliente_id: string;
  estado: string;
  intento_actual: number;
  max_intentos: number;
  next_contact_at: string | null;
  last_contact_at: string | null;
  contacted_at?: string | null;
  closed_at?: string | null;
  last_result?: string | null;
  notas?: string | null;
  created_at: string;
  updated_at?: string | null;
  campaign_name?: string | null;
  form_name?: string | null;
  origen?: string | null;
  assigned_worker_id?: string | null;
  assigned_role?: string | null;
  overdue_minutes?: number;
  due_now?: boolean;
  priority?: string;
  cliente?: {
    id: string;
    nombre?: string | null;
    apellido?: string | null;
    telefono?: string | null;
    email?: string | null;
    origen?: string | null;
    estado?: string | null;
    lead_status?: string | null;
  } | null;
};

function fullName(lead: LeadItem) {
  const n = [lead?.cliente?.nombre, lead?.cliente?.apellido].filter(Boolean).join(" ").trim();
  return n || "Lead sin nombre";
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

function fmtAgo(v: string | null | undefined) {
  if (!v) return "";
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function stateLabel(s: string) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "nuevo") return "🔥 Nuevo";
  if (x === "reintento_2") return "📞 2º intento";
  if (x === "reintento_3") return "📞 3º intento";
  if (x === "contactado") return "✅ Contactado";
  if (x === "no_interesado") return "🙅 No interesado";
  if (x === "numero_invalido") return "❌ Número inválido";
  if (x === "perdido") return "⌛ Perdido";
  return x || "—";
}

function stateStyle(s: string) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "contactado") return { background: "rgba(120,255,190,0.12)", border: "1px solid rgba(120,255,190,0.26)", color: "#bcffd3" };
  if (["no_interesado", "numero_invalido", "perdido"].includes(x)) return { background: "rgba(255,120,120,0.12)", border: "1px solid rgba(255,120,120,0.24)", color: "#ffc4c4" };
  if (["reintento_2", "reintento_3"].includes(x)) return { background: "rgba(255,198,92,0.12)", border: "1px solid rgba(255,198,92,0.24)", color: "#ffe2a3" };
  return { background: "rgba(181,156,255,0.12)", border: "1px solid rgba(181,156,255,0.26)", color: "#e4d9ff" };
}

function priorityStyle(p: string | undefined) {
  const x = String(p || "normal");
  if (x === "critical") return { background: "rgba(255,75,75,0.18)", border: "1px solid rgba(255,75,75,0.30)", color: "#ffd0d0" };
  if (x === "high") return { background: "rgba(255,177,66,0.16)", border: "1px solid rgba(255,177,66,0.28)", color: "#ffe1ae" };
  if (x === "closed") return { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#d7dbef" };
  return { background: "rgba(100,185,255,0.12)", border: "1px solid rgba(100,185,255,0.25)", color: "#cbe7ff" };
}

export default function CaptacionPanel({ mode }: { mode: "admin" | "central" }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<LeadItem[]>([]);
  const [view, setView] = useState<"pendientes" | "todos">("pendientes");
  const [busyId, setBusyId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    });
  }, []);

  const load = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      setMsg("");
      const res = await authedFetch(`/api/captacion/list?scope=${view}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar captación");
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando captación");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [authedFetch, view]);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    const i = setInterval(() => load(false), 15000);
    return () => clearInterval(i);
  }, [load]);

  useEffect(() => {
    const channel = sb
      .channel(`captacion-live-${mode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, () => {
        load(false);
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [mode, load]);

  const stats = useMemo(() => {
    const open = items.filter((x) => !["contactado", "no_interesado", "numero_invalido", "perdido"].includes(String(x.estado || ""))).length;
    const due = items.filter((x) => !!x.due_now).length;
    const hot = items.filter((x) => String(x.priority || "") === "critical").length;
    const won = items.filter((x) => String(x.estado || "") === "contactado").length;
    return { open, due, hot, won };
  }, [items]);

  async function act(leadId: string, action: "assign_to_me" | "contactado" | "no_responde" | "no_interesado" | "numero_invalido") {
    try {
      setBusyId(leadId);
      setMsg("");
      const note = String(notes[leadId] || "").trim();
      const res = await authedFetch("/api/captacion/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, action, note }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo actualizar el lead");
      if (action !== "assign_to_me") setNotes((prev) => ({ ...prev, [leadId]: "" }));
      await load(false);
    } catch (e: any) {
      setMsg(e?.message || "Error actualizando lead");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="tc-container">
      <div className="tc-card" style={{ marginTop: 18 }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="tc-title">Captación</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Leads nuevos, avisos en tiempo real y seguimiento de hasta 3 llamadas.
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className={`tc-btn ${view === "pendientes" ? "tc-btn-ok" : ""}`} onClick={() => setView("pendientes")}>Pendientes</button>
            <button className={`tc-btn ${view === "todos" ? "tc-btn-ok" : ""}`} onClick={() => setView("todos")}>Todos</button>
            <button className="tc-btn" onClick={() => load(true)} disabled={loading}>{loading ? "Cargando…" : "Actualizar"}</button>
          </div>
        </div>

        <div className="tc-grid" style={{ marginTop: 16, gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
          <div className="tc-kpi"><div className="tc-kpi-label">Pendientes</div><div className="tc-kpi-value">{stats.open}</div></div>
          <div className="tc-kpi"><div className="tc-kpi-label">Toca llamar</div><div className="tc-kpi-value">{stats.due}</div></div>
          <div className="tc-kpi"><div className="tc-kpi-label">Críticos</div><div className="tc-kpi-value">{stats.hot}</div></div>
          <div className="tc-kpi"><div className="tc-kpi-label">Contactados</div><div className="tc-kpi-value">{stats.won}</div></div>
        </div>

        {msg ? <div className="tc-sub" style={{ marginTop: 14, color: "#ffb4b4" }}>{msg}</div> : null}
      </div>

      <div className="tc-card" style={{ marginTop: 16 }}>
        {!items.length ? <div className="tc-sub">No hay leads en captación ahora mismo.</div> : null}

        {!!items.length && (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((lead) => {
              const hot = String(lead.priority || "") === "critical";
              const dueNow = !!lead.due_now;
              const assigned = !!lead.assigned_worker_id;

              return (
                <div
                  key={lead.id}
                  style={{
                    borderRadius: 18,
                    border: hot ? "1px solid rgba(255,82,82,0.35)" : dueNow ? "1px solid rgba(255,186,90,0.28)" : "1px solid rgba(255,255,255,0.10)",
                    background: hot ? "linear-gradient(180deg, rgba(80,16,16,0.32), rgba(255,255,255,0.03))" : dueNow ? "linear-gradient(180deg, rgba(88,60,8,0.25), rgba(255,255,255,0.03))" : "rgba(255,255,255,0.03)",
                    padding: 14,
                    boxShadow: hot ? "0 0 0 1px rgba(255,82,82,0.12), 0 8px 22px rgba(0,0,0,0.18)" : undefined,
                  }}
                >
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>{fullName(lead)}</div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        {lead?.cliente?.telefono || "Sin teléfono"}
                        {lead?.cliente?.email ? ` · ${lead.cliente.email}` : ""}
                      </div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Entrada: <b>{fmtDate(lead.created_at)}</b> · Próximo contacto: <b>{fmtDate(lead.next_contact_at)}</b>
                      </div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        {hot ? "⚠️ Muy urgente" : dueNow ? "📞 Toca llamar ahora" : `⏳ ${fmtAgo(lead.next_contact_at) || "Programado"}`}
                        {lead.overdue_minutes ? ` · ${lead.overdue_minutes} min de retraso` : ""}
                      </div>
                      {(lead.campaign_name || lead.form_name || lead.origen || lead?.cliente?.origen) ? (
                        <div className="tc-sub" style={{ marginTop: 6 }}>
                          {[lead.campaign_name, lead.form_name, lead.origen || lead?.cliente?.origen].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </div>

                    <div className="tc-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div className="tc-chip" style={stateStyle(lead.estado)}>{stateLabel(lead.estado)}</div>
                      <div className="tc-chip">Intento {lead.intento_actual}/{lead.max_intentos}</div>
                      <div className="tc-chip" style={priorityStyle(lead.priority)}>
                        {lead.priority === "critical" ? "Crítico" : lead.priority === "high" ? "Alta prioridad" : lead.priority === "closed" ? "Cerrado" : "Normal"}
                      </div>
                      <div className="tc-chip">{assigned ? "Asignado" : "Sin asignar"}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <textarea
                      value={notes[lead.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                      placeholder="Nota rápida del seguimiento…"
                      style={{
                        width: "100%",
                        minHeight: 72,
                        resize: "vertical",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(8,10,20,0.45)",
                        color: "white",
                        padding: 12,
                      }}
                    />
                  </div>

                  <div className="tc-row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                    {!assigned ? (
                      <button className="tc-btn" disabled={busyId === lead.id} onClick={() => act(lead.id, "assign_to_me")}>👤 Tomar lead</button>
                    ) : null}
                    <button className="tc-btn tc-btn-ok" disabled={busyId === lead.id} onClick={() => act(lead.id, "contactado")}>✅ Contactado</button>
                    <button className="tc-btn" disabled={busyId === lead.id} onClick={() => act(lead.id, "no_responde")}>📞 No responde</button>
                    <button className="tc-btn tc-btn-gold" disabled={busyId === lead.id} onClick={() => act(lead.id, "no_interesado")}>🙅 No interesado</button>
                    <button className="tc-btn tc-btn-danger" disabled={busyId === lead.id} onClick={() => act(lead.id, "numero_invalido")}>❌ Número inválido</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
