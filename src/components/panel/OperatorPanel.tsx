"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Copy, Phone, Plus, RefreshCw, Save, Settings2, X } from "lucide-react";

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
  talking_to?: string | null;
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
      dot: "#ff9f43",
      bg: "rgba(255,159,67,0.10)",
      border: "rgba(255,159,67,0.28)",
      glow: "0 0 0 1px rgba(255,159,67,0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
    };
  }
  if (s === "ringing") {
    return {
      label: "Entrante",
      dot: "#ff5d7a",
      bg: "rgba(255,93,122,0.12)",
      border: "rgba(255,93,122,0.30)",
      glow: "0 0 0 1px rgba(255,93,122,0.20), inset 0 1px 0 rgba(255,255,255,0.04)",
    };
  }
  if (s === "paused" || s === "break") {
    return {
      label: "Pausado",
      dot: "#56b4ff",
      bg: "rgba(86,180,255,0.10)",
      border: "rgba(86,180,255,0.26)",
      glow: "0 0 0 1px rgba(86,180,255,0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
    };
  }
  if (s === "ready" || s === "registered" || s === "available") {
    return {
      label: "Disponible",
      dot: "#59e39f",
      bg: "rgba(89,227,159,0.10)",
      border: "rgba(89,227,159,0.26)",
      glow: "0 0 0 1px rgba(89,227,159,0.16), inset 0 1px 0 rgba(255,255,255,0.04)",
    };
  }
  return {
    label: "Offline",
    dot: "rgba(255,255,255,0.45)",
    bg: "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.12)",
    glow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function toneForWorkerRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  if (r === "tarotista") return { label: "Tarotista", bg: "rgba(143,92,255,.18)", border: "rgba(143,92,255,.42)", color: "#e8dcff" };
  if (r === "central") return { label: "Central", bg: "rgba(86,180,255,.16)", border: "rgba(86,180,255,.38)", color: "#dff4ff" };
  return { label: "Sin rol", bg: "rgba(255,255,255,.08)", border: "rgba(255,255,255,.16)", color: "#fff" };
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
  const [drawerOpen, setDrawerOpen] = useState(false);
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
          roleTone: toneForWorkerRole(worker?.role),
        };
      })
      .sort((a, b) => String(a.extension || "").localeCompare(String(b.extension || ""), "es"));
  }, [extensions, workerMap]);

  const groupedCards = useMemo(() => ({
    central: cards.filter((item) => String(item.worker?.role || "").toLowerCase() === "central"),
    tarotista: cards.filter((item) => String(item.worker?.role || "").toLowerCase() === "tarotista"),
    other: cards.filter((item) => !["central", "tarotista"].includes(String(item.worker?.role || "").toLowerCase())),
  }), [cards]);

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
    const id = window.setInterval(loadData, 9000);
    return () => window.clearInterval(id);
  }, []);

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
      const nextExtensions = Array.isArray(json.extensions) ? json.extensions : [];
      setWorkers(Array.isArray(json.workers) ? json.workers : []);
      setExtensions(nextExtensions);
      setSetupNeeded(!!json.setupNeeded);
      setSelectedId((prev) => {
        if (prev && nextExtensions.some((item: any) => String(item.id || "") === String(prev))) return prev;
        return String(nextExtensions?.[0]?.id || "");
      });
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo cargar el panel");
    } finally {
      setLoading(false);
    }
  }

  function openCreateDrawer() {
    setSelectedId("");
    setForm(emptyForm());
    setDrawerOpen(true);
  }

  function openEditDrawer(item: ExtensionRow | null) {
    if (!item) return;
    setSelectedId(String(item.id || ""));
    setForm({
      id: item.id,
      worker_id: String(item.worker_id || ""),
      label: String(item.label || ""),
      extension: String(item.extension || ""),
      secret: String(item.secret || ""),
      domain: String(item.domain || "sip.clientestarotcelestial.es"),
      ws_server: String(item.ws_server || "wss://sip.clientestarotcelestial.es:8089/ws"),
      is_active: item.is_active !== false,
    });
    setDrawerOpen(true);
  }

  async function saveExtension() {
    try {
      setSaving(true);
      setMsg("");
      const token = await getToken();
      if (!token) throw new Error("Sesión no válida");

      const payload = {
        action: "save_extension",
        id: form.id || undefined,
        worker_id: form.worker_id || null,
        label: form.label,
        extension: form.extension,
        secret: form.secret,
        domain: form.domain,
        ws_server: form.ws_server,
        is_active: form.is_active,
      };

      const res = await fetch("/api/operator/panel", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo guardar la extensión");

      await loadData();
      setSelectedId(String(json?.extension?.id || ""));
      setDrawerOpen(false);
      setMsg(form.id ? "Extensión actualizada." : "Extensión creada correctamente.");
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

  function sendToSoftphone(item: any, intent: "dial" | "transfer" = "dial") {
    const number = String(item.extension || "").trim();
    if (!number) return;
    window.dispatchEvent(
      new CustomEvent("tc-softphone-dial", {
        detail: {
          number,
          label: item.label || item.worker?.display_name || `Ext. ${number}`,
          autoCall: false,
          intent,
          role: item.worker?.role || null,
        },
      })
    );
    setMsg(intent === "transfer" ? `Transferencia preparada a ${number}.` : `Extensión ${number} enviada al softphone.`);
  }

  function handleCardClick(item: any) {
    const number = String(item.extension || "").trim();
    if (!number) return;
    const workerRole = String(item.worker?.role || "").toLowerCase();
    const shouldTransfer = window.confirm(workerRole === "tarotista" ? `¿Transferir a la tarotista ${number}?` : `¿Transferir a la extensión ${number}?`);
    sendToSoftphone(item, shouldTransfer ? "transfer" : "dial");
  }

  return (
    <section className="tc-card" style={{ padding: 20, position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at top left, rgba(215,181,109,0.14), transparent 28%), radial-gradient(circle at top right, rgba(119,84,255,0.10), transparent 26%)",
          pointerEvents: "none",
        }}
      />

      <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 14, position: "relative" }}>
        <div>
          <div className="tc-title" style={{ fontSize: 26 }}>🎛️ Panel operativo</div>
          <div className="tc-sub" style={{ marginTop: 6, maxWidth: 820 }}>
            Vista profesional del call center con estados en vivo, tarjetas de extensión, interlocutor activo y acceso rápido al softphone.
          </div>
        </div>
        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="tc-btn" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            Actualizar
          </button>
          <button className="tc-btn tc-btn-gold" onClick={openCreateDrawer}>
            <Plus size={14} style={{ marginRight: 6 }} />
            Nueva extensión
          </button>
          <span className="tc-chip">Modo {mode === "admin" ? "Admin" : "Central"}</span>
        </div>
      </div>

      {msg ? <div className="tc-chip" style={{ marginTop: 12, whiteSpace: "pre-wrap", position: "relative" }}>{msg}</div> : null}

      {setupNeeded ? (
        <div className="tc-card" style={{ marginTop: 16, borderColor: "rgba(255,90,106,.24)", background: "rgba(255,90,106,.07)", position: "relative" }}>
          <div className="tc-title">Falta la tabla pbx_extensions</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Ejecuta la migración SQL incluida para que el panel pueda guardar extensiones y estados SIP en Supabase.
          </div>
        </div>
      ) : null}

      <div className="tc-kpis" style={{ marginTop: 18, position: "relative" }}>
        <div className="tc-kpi"><div className="tc-kpi-label">Extensiones</div><div className="tc-kpi-value">{stats.total}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Disponibles</div><div className="tc-kpi-value">{stats.available}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">En llamada</div><div className="tc-kpi-value">{stats.inCall}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Entrantes</div><div className="tc-kpi-value">{stats.ringing}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Líneas activas</div><div className="tc-kpi-value">{stats.activeLines}</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, marginTop: 18, position: "relative" }}>
        {[
          { key: "central", title: "Centrales", items: groupedCards.central, tone: { bg: "linear-gradient(180deg, rgba(40,92,145,.38), rgba(12,22,38,.92))", border: "rgba(86,180,255,.46)" } },
          { key: "tarotista", title: "Tarotistas", items: groupedCards.tarotista, tone: { bg: "linear-gradient(180deg, rgba(90,42,150,.38), rgba(18,12,34,.92))", border: "rgba(143,92,255,.44)" } },
          { key: "other", title: "Sin rol asignado", items: groupedCards.other, tone: { bg: "linear-gradient(180deg, rgba(70,70,90,.28), rgba(16,16,22,.92))", border: "rgba(255,255,255,.18)" } },
        ].filter((section) => section.items.length > 0).map((section) => (
          <div key={section.key} className="tc-card" style={{ padding: 10, borderColor: section.tone.border, background: section.tone.bg }}>
            <div className="tc-row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
              <div className="tc-title">{section.title}</div>
              <div className="tc-sub">{section.items.length} extensiones</div>
            </div>

            <div className="tc-compact-grid">
              {section.items.map((item: any) => {
                const seconds = item.active_call_started_at ? secondsSince(item.active_call_started_at) : 0;
                const workerName = item.worker?.display_name || item.label || `Extensión ${item.extension}`;
                const incoming = String(item.incoming_number || "").trim();
                const talkingTo = String(item.talking_to || incoming || "").trim();
                const isSelected = String(selectedId) === String(item.id || "");
                return (
                  <button
                    key={String(item.id || item.extension || Math.random())}
                    type="button"
                    onClick={() => handleCardClick(item)}
                    className="tc-mini-card"
                    style={{
                      borderColor: isSelected ? "rgba(255,214,102,.72)" : item.roleTone.border,
                      background: item.tone.bg,
                      boxShadow: `inset 0 0 0 1px ${item.tone.border}`,
                    }}
                  >
                    <div className="tc-mini-top">
                      <span className="tc-mini-dot" style={{ background: item.tone.dot }} />
                      <span className="tc-mini-ext">{item.extension || "—"}</span>
                      <span className="tc-mini-role" style={{ background: item.roleTone.bg, borderColor: item.roleTone.border, color: item.roleTone.color }}>
                        {item.roleTone.label}
                      </span>
                    </div>
                    <div className="tc-mini-name">{workerName}</div>
                    <div className="tc-mini-sub">{item.tone.label}{talkingTo ? ` · ${talkingTo}` : ""}</div>
                    <div className="tc-mini-footer">
                      <span>{Number(item.active_call_count || 0)} llamada{Number(item.active_call_count || 0) === 1 ? "" : "s"}</span>
                      <span>{seconds ? formatDuration(seconds) : (item.registered ? "SIP ok" : "SIP off")}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {!cards.length && !loading ? (
          <div className="tc-card" style={{ padding: 24 }}>
            <div className="tc-title">Todavía no hay extensiones</div>
            <div className="tc-sub" style={{ marginTop: 8 }}>Crea la primera desde el botón “Nueva extensión”.</div>
          </div>
        ) : null}
      </div>

      {drawerOpen ? (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(4,4,10,0.56)",
              backdropFilter: "blur(8px)",
              zIndex: 120,
            }}
          />
          <aside
            className="tc-card"
            style={{
              position: "fixed",
              top: 84,
              right: 20,
              bottom: 20,
              width: "min(460px, calc(100vw - 24px))",
              zIndex: 121,
              padding: 18,
              overflowY: "auto",
              borderColor: "rgba(215,181,109,.26)",
              boxShadow: "0 30px 80px rgba(0,0,0,.45)",
            }}
          >
            <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="tc-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Settings2 size={18} /> {form.id ? "Editar extensión" : "Nueva extensión"}
                </div>
                <div className="tc-sub" style={{ marginTop: 5 }}>
                  Alta rápida y edición segura. Crear una extensión nueva ya no sobrescribe otra existente.
                </div>
              </div>
              <button className="tc-btn" onClick={() => setDrawerOpen(false)}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Operadora</div>
                <select className="tc-select" value={form.worker_id} onChange={(e) => setForm((prev) => ({ ...prev, worker_id: e.target.value }))}>

                  
                  <option value="">Sin asignar</option>
                  <optgroup label="Centrales">
                    {workers.filter((worker) => worker.role === "central").map((worker) => (
                      <option key={worker.id} value={worker.id}>{worker.display_name || worker.email || worker.id}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Tarotistas">
                    {workers.filter((worker) => worker.role === "tarotista").map((worker) => (
                      <option key={worker.id} value={worker.id}>{worker.display_name || worker.email || worker.id}</option>
                    ))}
                  </optgroup>
                </select>
                <div className="tc-sub" style={{ marginTop: 6 }}>La extensión hereda el rol del trabajador asignado. Si asignas una central, no pedirá minutos al transferir. Si asignas una tarotista, sí.</div>
              </label>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Etiqueta visible</div>
                <input className="tc-input" value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="Ej. Central Principal" />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Extensión</div>
                  <input className="tc-input" value={form.extension} onChange={(e) => setForm((prev) => ({ ...prev, extension: e.target.value.replace(/\s+/g, "") }))} placeholder="1002" />
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Password SIP</div>
                  <input className="tc-input" type="password" value={form.secret} onChange={(e) => setForm((prev) => ({ ...prev, secret: e.target.value }))} placeholder="password" />
                </label>
              </div>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Dominio SIP</div>
                <input className="tc-input" value={form.domain} onChange={(e) => setForm((prev) => ({ ...prev, domain: e.target.value }))} placeholder="sip.clientestarotcelestial.es" />
              </label>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Servidor WSS</div>
                <input className="tc-input" value={form.ws_server} onChange={(e) => setForm((prev) => ({ ...prev, ws_server: e.target.value }))} placeholder="wss://sip.clientestarotcelestial.es:8089/ws" />
              </label>

              <label className="tc-chip" style={{ justifyContent: "flex-start", gap: 8, padding: 12 }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                Extensión activa
              </label>
            </div>

            <div className="tc-row" style={{ marginTop: 18, gap: 10, flexWrap: "wrap" }}>
              <button className="tc-btn tc-btn-gold" onClick={saveExtension} disabled={saving}>
                <Save size={14} style={{ marginRight: 6 }} />
                {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear extensión"}
              </button>
              {form.extension ? (
                <button className="tc-btn" onClick={() => copyValue(form.extension)}>
                  <Copy size={14} style={{ marginRight: 6 }} />
                  Copiar ext.
                </button>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}

      <style jsx>{`
        .tc-card {
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(15, 15, 22, 0.88);
          border-radius: 24px;
          backdrop-filter: blur(16px);
        }
        .tc-row {
          display: flex;
          align-items: center;
        }
        .tc-title {
          font-weight: 900;
          color: #fff;
        }
        .tc-sub {
          color: rgba(255,255,255,.66);
          font-size: 13px;
          line-height: 1.35;
        }
        .tc-chip {
          display: inline-flex;
          align-items: center;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.05);
          color: #fff;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 13px;
          min-width: 0;
        }

        .tc-compact-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 8px;
        }
        .tc-mini-card {
          display: grid;
          gap: 6px;
          text-align: left;
          width: 100%;
          min-height: 104px;
          padding: 9px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,.16);
          color: #fff;
          cursor: pointer;
        }
        .tc-mini-top {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .tc-mini-dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          flex: 0 0 auto;
        }
        .tc-mini-ext {
          font-weight: 900;
          font-size: 13px;
          letter-spacing: .02em;
        }
        .tc-mini-role {
          margin-left: auto;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 999px;
          padding: 2px 7px;
          font-size: 11px;
          font-weight: 800;
        }
        .tc-mini-name {
          font-size: 14px;
          font-weight: 900;
          line-height: 1.15;
          min-height: 32px;
        }
        .tc-mini-sub {
          color: rgba(255,255,255,.84);
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tc-mini-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: rgba(255,255,255,.7);
          font-size: 11px;
          margin-top: auto;
        }
        .tc-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.06);
          color: #fff;
          padding: 11px 14px;
          font-weight: 700;
          cursor: pointer;
        }
        .tc-btn-gold {
          background: linear-gradient(180deg, #f0d68d, #d7b56d);
          color: #22190b;
          border-color: rgba(215,181,109,.42);
        }
        .tc-input, .tc-select {
          width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.06);
          color: #fff;
          padding: 12px 14px;
          outline: none;
        }
        .tc-kpis {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 12px;
        }
        .tc-kpi {
          border: 1px solid rgba(255,255,255,.11);
          border-radius: 22px;
          padding: 16px;
          background: rgba(255,255,255,.04);
        }
        .tc-kpi-label {
          color: rgba(255,255,255,.64);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: .08em;
        }
        .tc-kpi-value {
          color: #fff;
          font-weight: 900;
          font-size: 32px;
          margin-top: 6px;
        }
      `}</style>
    </section>
  );
}
