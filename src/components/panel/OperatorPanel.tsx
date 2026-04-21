"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Activity, Copy, Phone, PhoneCall, PhoneIncoming, PhoneOff, Plus, Radio, RefreshCw, Save, Settings2, UserRound } from "lucide-react";

const sb = supabaseBrowser();

type OperatorPanelProps = {
  mode: "admin" | "central";
};

type WorkerRow = {
  id: string;
  user_id?: string | null;
  display_name?: string | null;
  role?: string | null;
  email?: string | null;
  team?: string | null;
  is_active?: boolean | null;
};

type ExtensionRow = {
  id?: string;
  worker_id?: string | null;
  label?: string | null;
  extension?: string | null;
  secret?: string | null;
  domain?: string | null;
  ws_server?: string | null;
  sip_uri?: string | null;
  is_active?: boolean | null;
  registered?: boolean | null;
  status?: string | null;
  active_call_count?: number | null;
  active_call_started_at?: string | null;
  incoming_number?: string | null;
  last_seen_at?: string | null;
};

type FormState = {
  id?: string;
  worker_id: string;
  label: string;
  extension: string;
  secret: string;
  domain: string;
  ws_server: string;
  is_active: boolean;
};

function secondsSince(dateLike?: string | null) {
  if (!dateLike) return 0;
  const ts = new Date(dateLike).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

function formatDuration(totalSeconds: number) {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function toneForStatus(status?: string | null, activeCallCount?: number | null) {
  const callCount = Number(activeCallCount || 0);
  const s = String(status || "offline").toLowerCase();
  if (callCount > 0 || s === "in_call" || s === "busy") {
    return {
      label: "En llamada",
      dot: "#ff7a00",
      bg: "rgba(255,122,0,0.12)",
      border: "rgba(255,122,0,0.32)",
    };
  }
  if (s === "ringing") {
    return {
      label: "Entrante",
      dot: "#ff5a6a",
      bg: "rgba(255,90,106,0.14)",
      border: "rgba(255,90,106,0.34)",
    };
  }
  if (s === "paused" || s === "break") {
    return {
      label: "Pausado",
      dot: "#ff5a6a",
      bg: "rgba(255,90,106,0.12)",
      border: "rgba(255,90,106,0.30)",
    };
  }
  if (s === "ready" || s === "registered" || s === "available") {
    return {
      label: "Disponible",
      dot: "#69f0b1",
      bg: "rgba(105,240,177,0.10)",
      border: "rgba(105,240,177,0.30)",
    };
  }
  return {
    label: "Offline",
    dot: "rgba(255,255,255,0.42)",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.16)",
  };
}

function emptyForm(): FormState {
  return {
    worker_id: "",
    label: "",
    extension: "",
    secret: "",
    domain: "sip.clientestarotcelestial.es",
    ws_server: "wss://sip.clientestarotcelestial.es:8089/ws",
    is_active: true,
  };
}

export default function OperatorPanel({ mode }: OperatorPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [, setClock] = useState(Date.now());

  const selected = useMemo(
    () => extensions.find((item) => String(item.id || "") === String(selectedId || "")) || null,
    [extensions, selectedId]
  );

  const workerMap = useMemo(() => {
    const map = new Map<string, WorkerRow>();
    for (const worker of workers) map.set(String(worker.id), worker);
    return map;
  }, [workers]);

  const cards = useMemo(() => {
    return [...extensions]
      .map((ext) => {
        const worker = ext.worker_id ? workerMap.get(String(ext.worker_id)) : null;
        return {
          ...ext,
          worker,
          tone: toneForStatus(ext.status, ext.active_call_count),
        };
      })
      .sort((a, b) => String(a.extension || "").localeCompare(String(b.extension || ""), "es"));
  }, [extensions, workerMap]);

  const stats = useMemo(() => {
    return cards.reduce(
      (acc, item) => {
        const state = item.tone.label;
        acc.total += 1;
        if (state === "Disponible") acc.available += 1;
        if (state === "En llamada") acc.inCall += 1;
        if (state === "Pausado") acc.paused += 1;
        if (state === "Entrante") acc.ringing += 1;
        if (state === "Offline") acc.offline += 1;
        acc.activeLines += Number(item.active_call_count || 0);
        return acc;
      },
      { total: 0, available: 0, inCall: 0, paused: 0, ringing: 0, offline: 0, activeLines: 0 }
    );
  }, [cards]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    loadData();
    const id = window.setInterval(loadData, 12000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selected) {
      setForm(emptyForm());
      return;
    }
    setForm({
      id: selected.id,
      worker_id: String(selected.worker_id || ""),
      label: String(selected.label || ""),
      extension: String(selected.extension || ""),
      secret: String(selected.secret || ""),
      domain: String(selected.domain || "sip.clientestarotcelestial.es"),
      ws_server: String(selected.ws_server || "wss://sip.clientestarotcelestial.es:8089/ws"),
      is_active: selected.is_active !== false,
    });
  }, [selected]);

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || "";
  }

  async function loadData() {
    try {
      if (loading) setMsg("");
      const token = await getToken();
      if (!token) {
        setMsg("Tu sesión ha caducado.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/operator/panel", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar el panel");
      setWorkers(Array.isArray(json.workers) ? json.workers : []);
      setExtensions(Array.isArray(json.extensions) ? json.extensions : []);
      setSetupNeeded(!!json.setupNeeded);
      setSelectedId((prev) => {
        if (prev && (json.extensions || []).some((item: any) => String(item.id || "") === String(prev))) return prev;
        return String(json.extensions?.[0]?.id || "");
      });
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo cargar el panel");
    } finally {
      setLoading(false);
    }
  }

  async function saveExtension() {
    try {
      setSaving(true);
      setMsg("");
      const token = await getToken();
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch("/api/operator/panel", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save_extension",
          ...form,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo guardar la extensión");

      await loadData();
      setSelectedId(String(json?.extension?.id || form.id || ""));
      setMsg("Configuración guardada.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo guardar la extensión");
    } finally {
      setSaving(false);
    }
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMsg(`Copiado: ${value}`);
    } catch {
      setMsg("No se pudo copiar al portapapeles.");
    }
  }

  return (
    <section className="tc-card" style={{ padding: 18 }}>
      <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
        <div>
          <div className="tc-title" style={{ fontSize: 24 }}>🎛️ Panel operativo</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Vista tipo call center para extensiones, estados en vivo y configuración rápida del softphone.
          </div>
        </div>
        <div className="tc-row" style={{ gap: 8 }}>
          <button className="tc-btn" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            Actualizar
          </button>
          <span className="tc-chip">Modo {mode === "admin" ? "Admin" : "Central"}</span>
        </div>
      </div>

      {msg ? (
        <div className="tc-chip" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</div>
      ) : null}

      {setupNeeded ? (
        <div className="tc-card" style={{ marginTop: 16, borderColor: "rgba(255,90,106,.24)", background: "rgba(255,90,106,.07)" }}>
          <div className="tc-title">Falta la tabla pbx_extensions</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Este ZIP ya deja el panel preparado. Solo necesitas ejecutar la migración SQL incluida para guardar extensiones en Supabase.
          </div>
        </div>
      ) : null}

      <div className="tc-kpis" style={{ marginTop: 18 }}>
        <div className="tc-kpi"><div className="tc-kpi-label">Extensiones</div><div className="tc-kpi-value">{stats.total}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Disponibles</div><div className="tc-kpi-value">{stats.available}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">En llamada</div><div className="tc-kpi-value">{stats.inCall}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Líneas activas</div><div className="tc-kpi-value">{stats.activeLines}</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, .7fr)", gap: 18, marginTop: 18 }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
            {cards.map((item) => {
              const seconds = item.active_call_started_at ? secondsSince(item.active_call_started_at) : 0;
              const workerName = item.worker?.display_name || item.label || `Extensión ${item.extension}`;
              const incoming = String(item.incoming_number || "").trim();
              return (
                <button
                  key={String(item.id || item.extension || Math.random())}
                  onClick={() => setSelectedId(String(item.id || ""))}
                  className="tc-card"
                  style={{
                    textAlign: "left",
                    padding: 16,
                    borderColor: String(selectedId) === String(item.id || "") ? "rgba(215,181,109,.34)" : item.tone.border,
                    background: item.tone.bg,
                    cursor: "pointer",
                  }}
                >
                  <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{workerName}</div>
                      <div className="tc-sub">Ext. {item.extension || "—"}</div>
                    </div>
                    <span className="tc-chip" style={{ borderColor: item.tone.border, background: "rgba(0,0,0,.16)" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: item.tone.dot, marginRight: 8 }} />
                      {item.tone.label}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
                    <div className="tc-chip" style={{ padding: 12, borderRadius: 16 }}>
                      <div className="tc-sub">Llamadas activas</div>
                      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{Number(item.active_call_count || 0)}</div>
                    </div>
                    <div className="tc-chip" style={{ padding: 12, borderRadius: 16 }}>
                      <div className="tc-sub">Tiempo en vivo</div>
                      <div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{formatDuration(seconds)}</div>
                    </div>
                  </div>

                  <div className="tc-row" style={{ marginTop: 12, justifyContent: "space-between" }}>
                    <span className="tc-sub">{item.registered ? "Registrada en SIP" : "Sin registrar"}</span>
                    <span className="tc-sub">{item.last_seen_at ? `Seen ${formatDuration(secondsSince(item.last_seen_at))}` : "Sin heartbeat"}</span>
                  </div>

                  {incoming ? (
                    <div className="tc-chip" style={{ marginTop: 12, width: "100%", justifyContent: "space-between", display: "flex" }}>
                      <span>Número entrante: {incoming}</span>
                      <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyValue(incoming); }} style={{ cursor: "pointer" }}>
                        <Copy size={14} />
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}

            {!cards.length && !loading ? (
              <div className="tc-card" style={{ padding: 20 }}>
                <div className="tc-title">Todavía no hay extensiones</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>Crea la primera extensión desde el panel derecho.</div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="tc-card" style={{ padding: 16, position: "sticky", top: 98, alignSelf: "start" }}>
          <div className="tc-row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="tc-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Settings2 size={18} /> Configuración</div>
              <div className="tc-sub" style={{ marginTop: 5 }}>Alta rápida y edición de extensiones SIP.</div>
            </div>
            <button className="tc-btn" onClick={() => { setSelectedId(""); setForm(emptyForm()); }}>
              <Plus size={14} style={{ marginRight: 6 }} /> Nueva
            </button>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            <label>
              <div className="tc-sub" style={{ marginBottom: 6 }}>Operadora</div>
              <select className="tc-select" value={form.worker_id} onChange={(e) => setForm((prev) => ({ ...prev, worker_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {workers.filter((worker) => worker.role !== "admin").map((worker) => (
                  <option key={worker.id} value={worker.id}>{worker.display_name || worker.email || worker.id}</option>
                ))}
              </select>
            </label>

            <label>
              <div className="tc-sub" style={{ marginBottom: 6 }}>Etiqueta visible</div>
              <input className="tc-input" value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="Ej. Central Principal" />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Extensión</div>
                <input className="tc-input" value={form.extension} onChange={(e) => setForm((prev) => ({ ...prev, extension: e.target.value.replace(/\s+/g, "") }))} placeholder="1000" />
              </label>
              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Password SIP</div>
                <input className="tc-input" type="password" value={form.secret} onChange={(e) => setForm((prev) => ({ ...prev, secret: e.target.value }))} placeholder="password" />
              </label>
            </div>

            <label>
              <div className="tc-sub" style={{ marginBottom: 6 }}>Dominio SIP</div>
              <input className="tc-input" value={form.domain} onChange={(e) => setForm((prev) => ({ ...prev, domain: e.target.value }))} placeholder="sip.tudominio.com" />
            </label>

            <label>
              <div className="tc-sub" style={{ marginBottom: 6 }}>Servidor WSS</div>
              <input className="tc-input" value={form.ws_server} onChange={(e) => setForm((prev) => ({ ...prev, ws_server: e.target.value }))} placeholder="wss://sip.tudominio.com:8089/ws" />
            </label>

            <label className="tc-row" style={{ gap: 10 }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
              <span>Extensión activa</span>
            </label>
          </div>

          <div className="tc-row" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <button className="tc-btn tc-btn-gold" onClick={saveExtension} disabled={saving}>
              <Save size={14} style={{ marginRight: 6 }} /> Guardar
            </button>
            {selected?.extension ? (
              <button className="tc-btn" onClick={() => copyValue(String(selected.extension))}>
                <Copy size={14} style={{ marginRight: 6 }} /> Copiar ext.
              </button>
            ) : null}
          </div>

          <div className="tc-hr" />

          <div style={{ display: "grid", gap: 10 }}>
            <div className="tc-title" style={{ fontSize: 16 }}>Estados del panel</div>
            <div className="tc-row" style={{ gap: 8 }}><span className="tc-chip" style={{ borderColor: "rgba(105,240,177,.30)" }}><Radio size={13} style={{ marginRight: 6 }} /> Disponible</span></div>
            <div className="tc-row" style={{ gap: 8 }}><span className="tc-chip" style={{ borderColor: "rgba(255,122,0,.30)" }}><PhoneCall size={13} style={{ marginRight: 6 }} /> En llamada</span></div>
            <div className="tc-row" style={{ gap: 8 }}><span className="tc-chip" style={{ borderColor: "rgba(255,90,106,.30)" }}><PhoneIncoming size={13} style={{ marginRight: 6 }} /> Entrante / Pausado</span></div>
            <div className="tc-row" style={{ gap: 8 }}><span className="tc-chip"><PhoneOff size={13} style={{ marginRight: 6 }} /> Offline</span></div>
          </div>
        </div>
      </div>

      <div className="tc-card" style={{ marginTop: 18, padding: 16 }}>
        <div className="tc-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Activity size={18} /> Preparado para trunk y CRM</div>
        <div className="tc-sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          El panel ya deja el terreno listo para el siguiente paso: detectar llamadas externas, enlazar el número entrante con CRM y abrir la ficha del cliente automáticamente cuando tengas el trunk activo.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 14 }}>
          <div className="tc-chip" style={{ padding: 12, borderRadius: 16 }}><Phone size={14} style={{ marginRight: 6 }} /> Detección de llamadas externas</div>
          <div className="tc-chip" style={{ padding: 12, borderRadius: 16 }}><UserRound size={14} style={{ marginRight: 6 }} /> Match automático por número</div>
          <div className="tc-chip" style={{ padding: 12, borderRadius: 16 }}><Copy size={14} style={{ marginRight: 6 }} /> Popup CRM / ficha automática</div>
        </div>
      </div>
    </section>
  );
}
