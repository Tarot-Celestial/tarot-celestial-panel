"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Lead = {
  id: string;
  cliente_id: string | null;
  estado: string | null;
  workflow_state?: string | null;
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
    lead_status?: string | null;
  } | null;
};

const sb = supabaseBrowser();

const columns = [
  { key: "nuevo", title: "Nuevos", subtitle: "Entraron y toca primer contacto" },
  { key: "no_contesta", title: "No contesta", subtitle: "Reintentos de llamada" },
  { key: "pendiente_free", title: "Pendiente free", subtitle: "Contestó y falta hacer la free" },
  { key: "hizo_free", title: "Post-free", subtitle: "Hizo free, falta convertir" },
] as const;

type ColumnKey = (typeof columns)[number]["key"];

type Props = {
  onOpenClient?: (clienteId: string) => void;
};

function fullName(lead: Lead) {
  const crm = [lead.cliente?.nombre, lead.cliente?.apellido].filter(Boolean).join(" ").trim();
  if (crm) return crm;
  return "Lead sin nombre";
}

function phone(lead: Lead) {
  return String(lead.cliente?.telefono || "").trim() || "Sin teléfono";
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

function relativeDue(value?: string | null) {
  if (!value) return "Sin fecha";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "Sin fecha";
  const diffMin = Math.round((ts - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const label = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.floor(abs / 60)}h` : `${Math.floor(abs / 1440)}d`;
  if (diffMin < 0) return `Vencido hace ${label}`;
  if (diffMin === 0) return "Ahora";
  return `En ${label}`;
}

function workflowState(lead: Lead): ColumnKey | "captado" | "cerrado" {
  const state = String(lead.workflow_state || lead.estado || "nuevo").toLowerCase();
  if (state === "pendiente_free") return "pendiente_free";
  if (["hizo_free", "recontacto"].includes(state)) return "hizo_free";
  if (state === "captado") return "captado";
  if (["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(state) || !!lead.closed_at) return "cerrado";
  if (["no_contesta", "reintento_2", "reintento_3", "sin_respuesta"].includes(state) || Number(lead.intento_actual || 1) > 1) return "no_contesta";
  return "nuevo";
}

function stateChip(state: string) {
  if (state === "nuevo") return { label: "Nuevo", bg: "rgba(139,92,246,.18)", border: "1px solid rgba(139,92,246,.35)" };
  if (state === "no_contesta") return { label: "No contesta", bg: "rgba(245,158,11,.18)", border: "1px solid rgba(245,158,11,.35)" };
  if (state === "pendiente_free") return { label: "Pendiente free", bg: "rgba(14,165,233,.18)", border: "1px solid rgba(14,165,233,.35)" };
  if (state === "hizo_free" || state === "recontacto") return { label: "Post-free", bg: "rgba(236,72,153,.18)", border: "1px solid rgba(236,72,153,.35)" };
  if (state === "captado") return { label: "Captado", bg: "rgba(34,197,94,.18)", border: "1px solid rgba(34,197,94,.35)" };
  return { label: "Cerrado", bg: "rgba(239,68,68,.18)", border: "1px solid rgba(239,68,68,.35)" };
}

function cardTone(lead: Lead) {
  const next = lead.next_contact_at ? new Date(lead.next_contact_at).getTime() : null;
  if (next && next <= Date.now()) return { bg: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.24)" };
  if (workflowState(lead) === "nuevo") return { bg: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.2)" };
  return { bg: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" };
}

export default function CaptacionPanel({ onOpenClient }: Props) {
  const [items, setItems] = useState<Lead[]>([]);
  const [view, setView] = useState<"pendientes" | "todos" | "cerrados">("pendientes");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState("");

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setLoading(true);
      setMsg("");
      const res = await fetch(`/api/captacion/list?scope=${view}&t=${Date.now()}`, {
  cache: "no-store",
});
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar captación");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando captación");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  async function act(id: string, action: "no_contesta" | "pendiente_free" | "hizo_free" | "recontacto" | "captado" | "no_interesado" | "reabrir") {
    const prevItems = items;

    try {
      setBusyId(id);
      setMsg("");

      setItems((current) =>
        current.map((lead) => {
          if (lead.id !== id) return lead;

          const nowIso = new Date().toISOString();
          const currentAttempt = Math.max(1, Number(lead.intento_actual || 1));
          const maxAttempts = Math.max(3, Number(lead.max_intentos || 3));

          if (action === "no_contesta") {
            const nextAttempt = currentAttempt + 1;
            const shouldClose = nextAttempt > maxAttempts;
            return {
              ...lead,
              estado: shouldClose ? "no_interesado" : "no_contesta",
              workflow_state: shouldClose ? "no_interesado" : "no_contesta",
              intento_actual: shouldClose ? maxAttempts : nextAttempt,
              next_contact_at: shouldClose ? nowIso : lead.next_contact_at,
              contacted_at: null,
              closed_at: shouldClose ? nowIso : null,
              last_result: "no_contesta",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          if (action === "pendiente_free") {
            return {
              ...lead,
              estado: "pendiente_free",
              workflow_state: "pendiente_free",
              contacted_at: nowIso,
              closed_at: null,
              last_result: "pendiente_free",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          if (action === "hizo_free") {
            return {
              ...lead,
              estado: "hizo_free",
              workflow_state: "hizo_free",
              contacted_at: nowIso,
              closed_at: null,
              intento_actual: 1,
              max_intentos: 3,
              last_result: "hizo_free",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          if (action === "recontacto") {
            const nextAttempt = currentAttempt + 1;
            const shouldClose = nextAttempt > maxAttempts;
            return {
              ...lead,
              estado: shouldClose ? "no_interesado" : "recontacto",
              workflow_state: shouldClose ? "no_interesado" : "recontacto",
              intento_actual: shouldClose ? maxAttempts : nextAttempt,
              contacted_at: nowIso,
              closed_at: shouldClose ? nowIso : null,
              last_result: "recontacto",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          if (action === "captado") {
            return {
              ...lead,
              estado: "captado",
              workflow_state: "captado",
              contacted_at: nowIso,
              closed_at: nowIso,
              last_result: "captado",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          if (action === "no_interesado") {
            return {
              ...lead,
              estado: "no_interesado",
              workflow_state: "no_interesado",
              closed_at: nowIso,
              last_result: "no_interesado",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          if (action === "reabrir") {
            return {
              ...lead,
              estado: "nuevo",
              workflow_state: "nuevo",
              closed_at: null,
              contacted_at: null,
              intento_actual: 1,
              max_intentos: 3,
              last_result: "reabrir",
              updated_at: nowIso,
              last_contact_at: nowIso,
            };
          }

          return lead;
        })
      );

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/captacion/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lead_id: id, action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setItems(prevItems);
        throw new Error(json?.error || "No se pudo actualizar el lead");
      }
      setMsg(json?.message || "Lead actualizado");
    } catch (e: any) {
      setItems(prevItems);
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
    const timer = setInterval(() => load(false), 20000);
    return () => clearInterval(timer);
  }, [view]);

  useEffect(() => {
    const channel = sb
      .channel(`captacion-live-${view}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, () => {
  setTimeout(() => {
    load(false);
  }, 500);
})
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [view]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((lead) => {
      const haystack = [
        fullName(lead),
        phone(lead),
        lead.cliente?.email || "",
        lead.campaign_name || "",
        lead.form_name || "",
        lead.origen || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const stats = useMemo(() => {
    const pendientesHoy = filtered.filter((lead) => {
      const ts = lead.next_contact_at ? new Date(lead.next_contact_at).getTime() : 0;
      return !ts || ts <= Date.now();
    }).length;
    return {
      total: filtered.length,
      hoy: pendientesHoy,
      nuevos: filtered.filter((x) => workflowState(x) === "nuevo").length,
      postFree: filtered.filter((x) => workflowState(x) === "hizo_free").length,
    };
  }, [filtered]);

  const byColumn = useMemo(() => {
    const map: Record<string, Lead[]> = { nuevo: [], no_contesta: [], pendiente_free: [], hizo_free: [], captado: [], cerrado: [] };
    for (const lead of filtered) {
      map[workflowState(lead)].push(lead);
    }
    return map;
  }, [filtered]);

  return (
    <div style={{ padding: 24 }}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>📞 Captación</div>
            <div style={{ opacity: 0.72, marginTop: 6 }}>Seguimiento claro desde lead nuevo hasta captado, con control de free y reintentos.</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setView("pendientes")} style={buttonStyle(view === "pendientes" ? "linear-gradient(135deg,#8b5cf6,#6366f1)" : "rgba(255,255,255,.08)")}>Pendientes</button>
            <button onClick={() => setView("todos")} style={buttonStyle(view === "todos" ? "linear-gradient(135deg,#8b5cf6,#6366f1)" : "rgba(255,255,255,.08)")}>Todos</button>
            <button onClick={() => setView("cerrados")} style={buttonStyle(view === "cerrados" ? "linear-gradient(135deg,#8b5cf6,#6366f1)" : "rgba(255,255,255,.08)")}>Cerrados</button>
            <button onClick={() => load(true)} style={buttonStyle("rgba(255,255,255,.08)")}>{loading ? "Cargando…" : "Actualizar"}</button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
          <div style={kpiStyle}><div style={kpiLabel}>En vista</div><div style={kpiValue}>{stats.total}</div></div>
          <div style={kpiStyle}><div style={kpiLabel}>Llamar hoy</div><div style={kpiValue}>{stats.hoy}</div></div>
          <div style={kpiStyle}><div style={kpiLabel}>Nuevos</div><div style={kpiValue}>{stats.nuevos}</div></div>
          <div style={kpiStyle}><div style={kpiLabel}>Post-free</div><div style={kpiValue}>{stats.postFree}</div></div>
        </div>

        <div style={{ marginTop: 16 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono, email o campaña"
            style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.04)", color: "white", padding: "12px 14px", outline: "none" }}
          />
        </div>

        {msg ? <div style={{ marginTop: 14, color: "#c8f7d0", fontWeight: 700 }}>{msg}</div> : null}
      </div>

      {view === "cerrados" ? (
        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          {!loading && !filtered.length ? <div style={emptyStyle}>No hay leads cerrados.</div> : null}
          {filtered.map((lead) => <LeadCard key={lead.id} lead={lead} busyId={busyId} onAction={act} onOpenClient={openClient} />)}
        </div>
      ) : (
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14, alignItems: "start" }}>
          {columns.map((column) => (
            <div key={column.key} style={columnStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{column.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.68, marginTop: 4 }}>{column.subtitle}</div>
                </div>
                <div style={countStyle}>{byColumn[column.key]?.length || 0}</div>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {!byColumn[column.key]?.length ? <div style={emptyMiniStyle}>Sin leads</div> : null}
                {byColumn[column.key]?.map((lead) => <LeadCard key={lead.id} lead={lead} busyId={busyId} onAction={act} onOpenClient={openClient} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  busyId,
  onAction,
  onOpenClient,
}: {
  lead: Lead;
  busyId: string;
  onAction: (id: string, action: "no_contesta" | "pendiente_free" | "hizo_free" | "recontacto" | "captado" | "no_interesado" | "reabrir") => void;
  onOpenClient: (lead: Lead) => void;
}) {
  const state = String(lead.workflow_state || lead.estado || "nuevo").toLowerCase();
  const chip = stateChip(state);
  const tone = cardTone(lead);
  const phase = workflowState(lead);
  const disabled = busyId === lead.id;

  return (
    <div style={{ borderRadius: 18, padding: 14, background: tone.bg, border: tone.border }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{fullName(lead)}</div>
          <div style={{ marginTop: 5, opacity: 0.78, fontSize: 13 }}>{phone(lead)}{lead.cliente?.email ? ` · ${lead.cliente.email}` : ""}</div>
        </div>
        <span style={{ ...chipPill, background: chip.bg, border: chip.border }}>{chip.label}</span>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 12, opacity: 0.8 }}>
        <div>Entrada: <b>{fmtDate(lead.created_at)}</b></div>
        <div>Próxima gestión: <b>{fmtDate(lead.next_contact_at)}</b> · {relativeDue(lead.next_contact_at)}</div>
        <div>Intentos: <b>{Math.max(1, Number(lead.intento_actual || 1))}/{Math.max(3, Number(lead.max_intentos || 3))}</b></div>
        {(lead.campaign_name || lead.form_name || lead.origen) ? <div>{[lead.campaign_name, lead.form_name, lead.origen].filter(Boolean).join(" · ")}</div> : null}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onOpenClient(lead)} style={miniButton("rgba(255,255,255,.10)")}>Abrir CRM</button>
        <a href={phone(lead) !== "Sin teléfono" ? `tel:${phone(lead)}` : undefined} style={{ textDecoration: "none" }}>
          <button disabled={phone(lead) === "Sin teléfono"} style={miniButton("#0ea5e9", phone(lead) === "Sin teléfono")}>Llamar</button>
        </a>

        {phase !== "cerrado" && phase !== "captado" ? (
          <>
            <button disabled={disabled} onClick={() => onAction(lead.id, "no_contesta")} style={miniButton("#f59e0b", disabled)}>No contesta</button>
            <button disabled={disabled} onClick={() => onAction(lead.id, "pendiente_free")} style={miniButton("#38bdf8", disabled)}>Pendiente free</button>
            <button disabled={disabled} onClick={() => onAction(lead.id, phase === "hizo_free" ? "recontacto" : "hizo_free")} style={miniButton("#ec4899", disabled)}>{phase === "hizo_free" ? "Recontacto" : "Hizo free"}</button>
            <button disabled={disabled} onClick={() => onAction(lead.id, "captado")} style={miniButton("#22c55e", disabled)}>Captado</button>
            <button disabled={disabled} onClick={() => onAction(lead.id, "no_interesado")} style={miniButton("#ef4444", disabled)}>No interesa</button>
          </>
        ) : null}

        {(phase === "cerrado" || phase === "captado") ? (
          <button disabled={disabled} onClick={() => onAction(lead.id, "reabrir")} style={miniButton("#6366f1", disabled)}>Reabrir</button>
        ) : null}
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.03)",
  padding: 18,
};

const columnStyle: CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.03)",
  padding: 14,
  minHeight: 220,
};

const kpiStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.04)",
  padding: 14,
};

const kpiLabel: CSSProperties = { opacity: 0.68, fontSize: 13, marginBottom: 6 };
const kpiValue: CSSProperties = { fontSize: 26, fontWeight: 800 };
const emptyStyle: CSSProperties = { borderRadius: 18, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)", padding: 18, opacity: 0.75 };
const emptyMiniStyle: CSSProperties = { borderRadius: 14, border: "1px dashed rgba(255,255,255,.10)", padding: 14, opacity: 0.58, textAlign: "center" };
const countStyle: CSSProperties = { minWidth: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(255,255,255,.08)", fontWeight: 800 };
const chipPill: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 };

function buttonStyle(background: string): CSSProperties {
  return { background, color: "white", border: "none", padding: "10px 14px", borderRadius: 12, fontWeight: 700, cursor: "pointer" };
}

function miniButton(background: string, disabled = false): CSSProperties {
  return { background, color: "white", border: "none", padding: "8px 10px", borderRadius: 10, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 };
}
