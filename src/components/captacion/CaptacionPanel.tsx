"use client";

import { useEffect, useMemo, useState } from "react";
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
  cliente?: {
    id: string;
    nombre?: string | null;
    apellido?: string | null;
    telefono?: string | null;
    email?: string | null;
    origen?: string | null;
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

function stateLabel(s: string) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "nuevo") return "🔥 Nuevo";
  if (x === "reintento_2") return "📞 2º intento";
  if (x === "reintento_3") return "📞 3º intento";
  if (x === "contactado") return "✅ Contactado";
  if (x === "no_interesado") return "🙅 No interesado";
  if (x === "numero_invalido") return "❌ Número inválido";
  if (x === "perdido") return "⌛ Sin respuesta";
  return x || "—";
}

function stateStyle(s: string) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "contactado") return { background: "rgba(120,255,190,0.10)", border: "1px solid rgba(120,255,190,0.22)" };
  if (x === "no_interesado" || x === "numero_invalido" || x === "perdido") return { background: "rgba(255,120,120,0.10)", border: "1px solid rgba(255,120,120,0.22)" };
  if (x === "reintento_2" || x === "reintento_3") return { background: "rgba(215,181,109,0.10)", border: "1px solid rgba(215,181,109,0.22)" };
  return { background: "rgba(181,156,255,0.10)", border: "1px solid rgba(181,156,255,0.22)" };
}

export default function CaptacionPanel({ mode }: { mode: "admin" | "central" }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<LeadItem[]>([]);
  const [view, setView] = useState<"pendientes" | "todos">("pendientes");
  const [busyId, setBusyId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function authedFetch(url: string, init?: RequestInit) {
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
  }

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setLoading(true);
      setMsg("");
      const res = await fetch(`/api/captacion/list?scope=${view}`, {   cache: "no-store", });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar captación");
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando captación");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
  }, [view]);

  useEffect(() => {
    const i = setInterval(() => load(false), 10000);
    return () => clearInterval(i);
  }, [view]);

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
  }, [mode, view]);

  const stats = useMemo(() => {
    const open = items.filter((x) => !["contactado", "no_interesado", "numero_invalido", "perdido"].includes(String(x.estado || ""))).length;
    const due = items.filter((x) => {
      if (!["nuevo", "reintento_2", "reintento_3"].includes(String(x.estado || ""))) return false;
      const t = new Date(String(x.next_contact_at || x.created_at || 0)).getTime();
      return Number.isFinite(t) && t <= Date.now();
    }).length;
    const won = items.filter((x) => String(x.estado || "") === "contactado").length;
    const lost = items.filter((x) => ["perdido", "no_interesado", "numero_invalido"].includes(String(x.estado || ""))).length;
    return { open, due, won, lost };
  }, [items]);

  async function act(leadId: string, action: "contactado" | "no_responde" | "no_interesado" | "numero_invalido") {
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
      setNotes((prev) => ({ ...prev, [leadId]: "" }));
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
            <div className="tc-sub" style={{ marginTop: 6 }}>Leads nuevos y reintentos para llamar en el momento correcto.</div>
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
          <div className="tc-kpi"><div className="tc-kpi-label">Contactados</div><div className="tc-kpi-value">{stats.won}</div></div>
          <div className="tc-kpi"><div className="tc-kpi-label">Descartados</div><div className="tc-kpi-value">{stats.lost}</div></div>
        </div>

        {msg ? <div className="tc-sub" style={{ marginTop: 14, color: "#ffb4b4" }}>{msg}</div> : null}
      </div>

      <div className="tc-card" style={{ marginTop: 16 }}>
        {!items.length ? <div className="tc-sub">No hay leads en captación ahora mismo.</div> : null}

        {!!items.length && (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((lead) => {
              const dueNow = (() => {
                const t = new Date(String(lead.next_contact_at || lead.created_at || 0)).getTime();
                return Number.isFinite(t) && t <= Date.now() && !["contactado", "no_interesado", "numero_invalido", "perdido"].includes(String(lead.estado || ""));
              })();

              return (
                <div
                  key={lead.id}
                  style={{
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: dueNow ? "rgba(181,156,255,0.08)" : "rgba(255,255,255,0.03)",
                    padding: 14,
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
                      {(lead.campaign_name || lead.form_name || lead.origen || lead?.cliente?.origen) ? (
                        <div className="tc-sub" style={{ marginTop: 6 }}>
                          {[lead.campaign_name, lead.form_name, lead.origen || lead?.cliente?.origen].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </div>

                    <div className="tc-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div className="tc-chip" style={stateStyle(lead.estado)}>{stateLabel(lead.estado)}</div>
                      <div className="tc-chip">Intento {lead.intento_actual}/{lead.max_intentos}</div>
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
