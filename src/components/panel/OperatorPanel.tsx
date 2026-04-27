"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Copy, Phone, Plus, RefreshCw, Save, Settings2, Smartphone, Users2, X } from "lucide-react";

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
  role?: string | null;
  extension_role?: string | null;
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

type RoutingRow = {
  id?: string;
  extension?: string | null;
  type?: "internal" | "external" | null;
  target?: string | null;
  is_active?: boolean | null;
  queue_id?: string | null;
  queue_priority?: number | null;
  notes?: string | null;
};

type QueueRow = {
  id?: string;
  queue_key?: string | null;
  label?: string | null;
  strategy?: string | null;
  ring_timeout?: number | null;
  wrapup_seconds?: number | null;
  max_wait_seconds?: number | null;
  is_active?: boolean | null;
};

type QueueMemberRow = {
  id?: string;
  queue_id?: string | null;
  worker_id?: string | null;
  extension?: string | null;
  penalty?: number | null;
  is_active?: boolean | null;
};

type FormState = {
  id?: string;
  worker_id: string;
  role: "central" | "tarotista";
  label: string;
  extension: string;
  secret: string;
  domain: string;
  ws_server: string;
  is_active: boolean;
  route_type: "internal" | "external";
  target_phone: string;
  queue_id: string;
  queue_priority: number;
  routing_notes: string;
};

type QueueFormState = {
  id?: string;
  queue_key: string;
  label: string;
  strategy: string;
  ring_timeout: number;
  wrapup_seconds: number;
  max_wait_seconds: number;
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
    return { label: "En llamada", dot: "#ff9f43", bg: "rgba(255,159,67,0.10)", border: "rgba(255,159,67,0.28)" };
  }
  if (s === "ringing") {
    return { label: "Entrante", dot: "#ff5d7a", bg: "rgba(255,93,122,0.12)", border: "rgba(255,93,122,0.30)" };
  }
  if (s === "paused" || s === "break") {
    return { label: "Pausado", dot: "#56b4ff", bg: "rgba(86,180,255,0.10)", border: "rgba(86,180,255,0.26)" };
  }
  if (s === "ready" || s === "registered" || s === "available") {
    return { label: "Disponible", dot: "#59e39f", bg: "rgba(89,227,159,0.10)", border: "rgba(89,227,159,0.26)" };
  }
  return { label: "Offline", dot: "rgba(255,255,255,0.45)", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.12)" };
}

function toneForWorkerRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  if (r === "tarotista") return { label: "Tarotista", bg: "rgba(143,92,255,.18)", border: "rgba(143,92,255,.42)", color: "#e8dcff" };
  if (r === "central") return { label: "Central", bg: "rgba(86,180,255,.16)", border: "rgba(86,180,255,.38)", color: "#dff4ff" };
  return { label: "Sin rol", bg: "rgba(255,255,255,.08)", border: "rgba(255,255,255,.16)", color: "#fff" };
}

function defaultSecretForExtension(extension: string) {
  return cleanDigits(extension) === "1000" ? "123456" : cleanDigits(extension) ? "1234" : "";
}

function emptyForm(): FormState {
  return {
    worker_id: "",
    role: "tarotista",
    label: "",
    extension: "",
    secret: "",
    domain: "sip.clientestarotcelestial.es",
    ws_server: "wss://sip.clientestarotcelestial.es/ws",
    is_active: true,
    route_type: "internal",
    target_phone: "",
    queue_id: "",
    queue_priority: 0,
    routing_notes: "",
  };
}

function emptyQueueForm(): QueueFormState {
  return {
    queue_key: "",
    label: "",
    strategy: "ringall",
    ring_timeout: 20,
    wrapup_seconds: 10,
    max_wait_seconds: 120,
    is_active: true,
  };
}

function cleanDigits(value: string) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function cleanPhone(value: string) {
  return String(value || "").replace(/[^0-9+]/g, "");
}

export default function OperatorPanel({ mode }: OperatorPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [routingSetupNeeded, setRoutingSetupNeeded] = useState(false);
  const [queueSetupNeeded, setQueueSetupNeeded] = useState(false);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [parkingCalls, setParkingCalls] = useState<{ slot: string; caller: string }[]>([]);
  const [routing, setRouting] = useState<RoutingRow[]>([]);
  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [queueMembers, setQueueMembers] = useState<QueueMemberRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [queueForm, setQueueForm] = useState<QueueFormState>(emptyQueueForm());
  const [queueMembersDraft, setQueueMembersDraft] = useState<{ worker_id: string; extension: string; penalty: number; is_active: boolean }[]>([]);
  const [, setClock] = useState(Date.now());

  const workerMap = useMemo(() => {
    const map = new Map<string, WorkerRow>();
    for (const worker of workers) map.set(String(worker.id), worker);
    return map;
  }, [workers]);

  const routingMap = useMemo(() => {
    const map = new Map<string, RoutingRow>();
    for (const route of routing) map.set(String(route.extension || ""), route);
    return map;
  }, [routing]);

  const queueMap = useMemo(() => {
    const map = new Map<string, QueueRow>();
    for (const queue of queues) map.set(String(queue.id || ""), queue);
    return map;
  }, [queues]);

  const cards = useMemo(() => {
    return [...extensions]
      .map((ext) => {
        const worker = ext.worker_id ? workerMap.get(String(ext.worker_id)) : null;
        const route = routingMap.get(String(ext.extension || "")) || null;
        return {
          ...ext,
          worker,
          route,
          tone: toneForStatus(ext.status, ext.active_call_count),
          resolvedRole: String(ext.role || ext.extension_role || worker?.role || "").toLowerCase(),
          roleTone: toneForWorkerRole(ext.role || ext.extension_role || worker?.role),
        };
      })
      .sort((a, b) => String(a.extension || "").localeCompare(String(b.extension || ""), "es"));
  }, [extensions, workerMap, routingMap]);

  const groupedCards = useMemo(
    () => ({
      central: cards.filter((item) => item.resolvedRole === "central"),
      tarotista: cards.filter((item) => item.resolvedRole === "tarotista"),
      other: cards.filter((item) => !["central", "tarotista"].includes(String(item.resolvedRole || "").toLowerCase())),
    }),
    [cards]
  );

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
        if (String(item.route?.type || "internal") === "external") acc.mobile += 1;
        if (item.route?.queue_id) acc.queued += 1;
        acc.activeLines += Number(item.active_call_count || 0);
        return acc;
      },
      { total: 0, available: 0, inCall: 0, paused: 0, ringing: 0, offline: 0, activeLines: 0, mobile: 0, queued: 0 }
    );
  }, [cards]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
  void loadAll();

  const id = window.setInterval(() => void loadAll(), 2000);
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
      setRouting(Array.isArray(json.routing) ? json.routing : []);
      setQueues(Array.isArray(json.queues) ? json.queues : []);
      setQueueMembers(Array.isArray(json.queueMembers) ? json.queueMembers : []);
      setSetupNeeded(false);
      setRoutingSetupNeeded(false);
      setQueueSetupNeeded(false);
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

  async function loadAll() {
  await loadData();

  try {
    const res = await fetch("/api/asterisk/parking");
    const json = await res.json();

    if (json?.ok) {
      setParkingCalls(json.calls || []);
    }
  } catch (e) {
    console.log("Parking error", e);
  }
}
  
  function openCreateDrawer() {
    setSelectedId("");
    setForm(emptyForm());
    setDrawerOpen(true);
  }

  function openEditDrawer(item: any) {
    if (!item) return;
    const route = routingMap.get(String(item.extension || ""));
    setSelectedId(String(item.id || ""));
    setForm({
      id: item.id,
      worker_id: String(item.worker_id || ""),
      role: (String(item.role || item.extension_role || item.worker?.role || "tarotista").toLowerCase() === "central" ? "central" : "tarotista"),
      label: String(item.label || ""),
      extension: String(item.extension || ""),
      secret: String(item.secret || defaultSecretForExtension(String(item.extension || ""))),
      domain: String(item.domain || "sip.clientestarotcelestial.es"),
      ws_server: String(item.ws_server || "wss://sip.clientestarotcelestial.es/ws"),
      is_active: item.is_active !== false,
      route_type: String(route?.type || "internal") === "external" ? "external" : "internal",
      target_phone: String(route?.target || ""),
      queue_id: String(route?.queue_id || ""),
      queue_priority: Number(route?.queue_priority || 0) || 0,
      routing_notes: String(route?.notes || ""),
    });
    setDrawerOpen(true);
  }

  function openCreateQueueDrawer() {
    setQueueForm(emptyQueueForm());
    setQueueMembersDraft([]);
    setQueueDrawerOpen(true);
  }

  function openEditQueueDrawer(queue: QueueRow) {
    setQueueForm({
      id: queue.id,
      queue_key: String(queue.queue_key || ""),
      label: String(queue.label || ""),
      strategy: String(queue.strategy || "ringall"),
      ring_timeout: Number(queue.ring_timeout || 20) || 20,
      wrapup_seconds: Number(queue.wrapup_seconds || 10) || 10,
      max_wait_seconds: Number(queue.max_wait_seconds || 120) || 120,
      is_active: queue.is_active !== false,
    });
    setQueueMembersDraft(
      queueMembers
        .filter((member) => String(member.queue_id || "") === String(queue.id || ""))
        .map((member) => ({
          worker_id: String(member.worker_id || ""),
          extension: String(member.extension || ""),
          penalty: Number(member.penalty || 0) || 0,
          is_active: member.is_active !== false,
        }))
    );
    setQueueDrawerOpen(true);
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
      role: form.role,
      label: form.label,
      extension: cleanDigits(form.extension),
      secret: form.secret,
      domain: form.domain,
      ws_server: form.ws_server,
      is_active: form.is_active,
      route_type: form.route_type,
      target_phone: form.route_type === "external" ? cleanPhone(form.target_phone) : null,
      queue_id: form.queue_id || null,
      queue_priority: form.queue_priority || 0,
      routing_notes: form.routing_notes || null,
    };


    const res = await fetch("/api/operator/panel", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log("FETCH DONE"); // 👈 AÑADE ESTO

    const json = await res.json().catch(() => null);
    console.log("RESPONSE:", json); // 👈 AÑADE ESTO

    if (!json?.ok) throw new Error(json?.error || "No se pudo guardar la extensión");

    await loadData();
    setDrawerOpen(false);
    setMsg(form.id ? "Extensión actualizada." : "Extensión creada correctamente.");

  } catch (e: any) {
    console.error("ERROR SAVE:", e); // 👈 AÑADE ESTO
    setMsg(e?.message || "No se pudo guardar la extensión");
  } finally {
    setSaving(false);
  }
}

  async function saveQueue() {
    try {
      setSaving(true);
      setMsg("");
      const token = await getToken();
      if (!token) throw new Error("Sesión no válida");

      const queueRes = await fetch("/api/operator/panel", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_queue",
          ...queueForm,
          queue_key: cleanDigits(queueForm.queue_key),
        }),
      });
      const queueJson = await queueRes.json().catch(() => null);
      if (!queueJson?.ok) throw new Error(queueJson?.error || "No se pudo guardar la cola");

      const queueId = String(queueJson.queue?.id || queueForm.id || "");
      if (queueId) {
        const membersRes = await fetch("/api/operator/panel", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_queue_members",
            queue_id: queueId,
            members: queueMembersDraft.map((item) => ({
              worker_id: item.worker_id || null,
              extension: cleanDigits(item.extension),
              penalty: Number(item.penalty || 0) || 0,
              is_active: item.is_active !== false,
            })),
          }),
        });
        const membersJson = await membersRes.json().catch(() => null);
        if (!membersJson?.ok) throw new Error(membersJson?.error || "No se pudieron guardar los operadores de la cola");
      }

      await loadData();
      setQueueDrawerOpen(false);
      setMsg(queueForm.id ? "Cola actualizada." : "Cola creada correctamente.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo guardar la cola");
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
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at top left, rgba(215,181,109,0.14), transparent 28%), radial-gradient(circle at top right, rgba(119,84,255,0.10), transparent 26%)", pointerEvents: "none" }} />

      <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 14, position: "relative" }}>
        <div>
          <div className="tc-title" style={{ fontSize: 26 }}>🎛️ Panel operativo PBX</div>
          <div className="tc-sub" style={{ marginTop: 6, maxWidth: 880 }}>
            Gestión visual de extensiones SIP, desvíos a móvil y colas de operadoras desde el panel. El SQL incluido deja preparado el trigger automático para sincronizar Supabase con Asterisk Realtime.
          </div>
        </div>
        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="tc-btn" onClick={() => void loadData()} disabled={loading}><RefreshCw size={14} style={{ marginRight: 6 }} />Actualizar</button>
          <button className="tc-btn tc-btn-gold" onClick={openCreateDrawer}><Plus size={14} style={{ marginRight: 6 }} />Nueva extensión</button>
          <button className="tc-btn" onClick={openCreateQueueDrawer}><Users2 size={14} style={{ marginRight: 6 }} />Nueva cola</button>
          <span className="tc-chip">Modo {mode === "admin" ? "Admin" : "Central"}</span>
        </div>
      </div>

      {msg ? <div className="tc-chip" style={{ marginTop: 12, whiteSpace: "pre-wrap", position: "relative" }}>{msg}</div> : null}

      {setupNeeded || routingSetupNeeded || queueSetupNeeded ? (
        <div className="tc-card" style={{ marginTop: 16, borderColor: "rgba(255,90,106,.24)", background: "rgba(255,90,106,.07)", position: "relative" }}>
          <div className="tc-title">Falta la base PBX en Supabase</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Ejecuta el archivo <strong>database/pbx_realtime_setup.sql</strong>. Crea routing, colas, miembros y trigger automático hacia <code>ps_endpoints</code>, <code>ps_auths</code> y <code>ps_aors</code>.
          </div>
        </div>
      ) : null}

      <div className="tc-kpis" style={{ marginTop: 18, position: "relative" }}>
        <div className="tc-kpi"><div className="tc-kpi-label">Extensiones</div><div className="tc-kpi-value">{stats.total}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Disponibles</div><div className="tc-kpi-value">{stats.available}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">En llamada</div><div className="tc-kpi-value">{stats.inCall}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Desvío móvil</div><div className="tc-kpi-value">{stats.mobile}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">En colas</div><div className="tc-kpi-value">{stats.queued}</div></div>
        <div className="tc-kpi"><div className="tc-kpi-label">Colas</div><div className="tc-kpi-value">{queues.length}</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, marginTop: 18, position: "relative" }}>
         <div className="tc-card" style={{
    padding: 14,
    borderColor: "rgba(255,200,100,.25)",
    background: "linear-gradient(180deg, rgba(255,200,100,.08), rgba(20,10,0,.9))"
  }}>
    <div className="tc-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
      <div className="tc-title">📦 Parking</div>
      <div className="tc-sub">{parkingCalls.length} llamadas</div>
    </div>

    <div style={{ display: "grid", gap: 8 }}>
      {parkingCalls.length === 0 ? (
        <div className="tc-sub">Sin llamadas aparcadas</div>
      ) : parkingCalls.map(call => (
        <div key={call.slot} className="tc-queue-row">
          <div>
            <div className="tc-title" style={{ fontSize: 15 }}>
              Slot {call.slot}
            </div>
            <div className="tc-sub">
              {call.caller}
            </div>
          </div>

          <button
            className="tc-btn-mini"
            onClick={() => sendToSoftphone({ extension: call.slot })}
          >
            <Phone size={12} /> Recuperar
          </button>
        </div>
      ))}
    </div>
  </div>
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
                const queueLabel = item.route?.queue_id ? (queueMap.get(String(item.route.queue_id))?.label || "Cola") : "";
                return (
                  <div key={String(item.id || item.extension || Math.random())} className="tc-mini-card" style={{ borderColor: isSelected ? "rgba(255,214,102,.72)" : item.roleTone.border, background: item.tone.bg, boxShadow: `inset 0 0 0 1px ${item.tone.border}` }}>
                    <button type="button" onClick={() => handleCardClick(item)} style={{ all: "unset", cursor: "pointer", display: "grid", gap: 6 }}>
                      <div className="tc-mini-top">
                        <span className="tc-mini-dot" style={{ background: item.tone.dot }} />
                        <span className="tc-mini-ext">{item.extension || "—"}</span>
                        {String(item.route?.type || "internal") === "external" ? <span className="tc-mini-badge"><Smartphone size={11} /> móvil</span> : null}
                        <span className="tc-mini-role" style={{ background: item.roleTone.bg, borderColor: item.roleTone.border, color: item.roleTone.color }}>{item.roleTone.label}</span>
                      </div>
                      <div className="tc-mini-name">{workerName}</div>
                      <div className="tc-mini-sub">{item.tone.label}{talkingTo ? ` · ${talkingTo}` : ""}</div>
                      <div className="tc-mini-sub">{item.route?.target ? `→ ${item.route.target}` : queueLabel ? `↺ ${queueLabel}` : "Ruta interna"}</div>
                      <div className="tc-mini-footer">
                        <span>{Number(item.active_call_count || 0)} llamada{Number(item.active_call_count || 0) === 1 ? "" : "s"}</span>
                        <span>{seconds ? formatDuration(seconds) : (item.registered ? "SIP ok" : "SIP off")}</span>
                      </div>
                    </button>
                    <div className="tc-row" style={{ gap: 8, marginTop: 2 }}>
                      <button className="tc-btn-mini" onClick={() => openEditDrawer(item)}><Settings2 size={12} />Editar</button>
                      <button className="tc-btn-mini" onClick={() => copyValue(String(item.extension || ""))}><Copy size={12} />Copiar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="tc-card" style={{ padding: 14, borderColor: "rgba(255,255,255,.14)", background: "rgba(255,255,255,.03)" }}>
          <div className="tc-row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
            <div className="tc-title">Colas / Operadoras</div>
            <div className="tc-sub">{queues.length} colas configuradas</div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {queues.length ? queues.map((queue) => {
              const members = queueMembers.filter((member) => String(member.queue_id || "") === String(queue.id || ""));
              return (
                <div key={String(queue.id || queue.queue_key)} className="tc-queue-row">
                  <div>
                    <div className="tc-title" style={{ fontSize: 15 }}>{queue.label || queue.queue_key}</div>
                    <div className="tc-sub" style={{ marginTop: 4 }}>Extensión cola {queue.queue_key} · estrategia {queue.strategy || "ringall"} · {members.length} operadoras</div>
                  </div>
                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {members.slice(0, 4).map((member) => {
                      const worker = member.worker_id ? workerMap.get(String(member.worker_id)) : null;
                      return <span key={String(member.id || member.worker_id || member.extension)} className="tc-chip">{worker?.display_name || member.extension || "Operadora"}</span>;
                    })}
                    <button className="tc-btn-mini" onClick={() => openEditQueueDrawer(queue)}><Users2 size={12} />Editar cola</button>
                  </div>
                </div>
              );
            }) : <div className="tc-sub">Todavía no hay colas. Crea una para agrupar tarotistas y dejarlas listas para estrategias tipo ringall o leastrecent.</div>}
          </div>
        </div>

        {!cards.length && !loading ? <div className="tc-card" style={{ padding: 24 }}><div className="tc-title">Todavía no hay extensiones</div><div className="tc-sub" style={{ marginTop: 8 }}>Crea la primera desde el botón “Nueva extensión”.</div></div> : null}
      </div>

      {drawerOpen ? (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(4,4,10,0.56)", backdropFilter: "blur(8px)", zIndex: 120 }} />
          <aside className="tc-card" style={{ position: "fixed", top: 84, right: 20, bottom: 20, width: "min(520px, calc(100vw - 24px))", zIndex: 121, padding: 18, overflowY: "auto", borderColor: "rgba(215,181,109,.26)", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
            <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="tc-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Settings2 size={18} />{form.id ? "Editar extensión" : "Nueva extensión"}</div>
                <div className="tc-sub" style={{ marginTop: 5 }}>Alta visual de internas SIP o extensiones que desvían a un móvil. También puedes enlazarlas a una cola.</div>
              </div>
              <button className="tc-btn" onClick={() => setDrawerOpen(false)}><X size={14} /></button>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Operadora</div>
                <select className="tc-select" value={form.worker_id} onChange={(e) => {
                  const nextWorkerId = e.target.value;
                  const nextWorker = workers.find((worker) => worker.id === nextWorkerId);
                  const nextRole = String(nextWorker?.role || "").toLowerCase() === "central" ? "central" : String(nextWorker?.role || "").toLowerCase() === "tarotista" ? "tarotista" : form.role;
                  setForm((prev) => ({ ...prev, worker_id: nextWorkerId, role: nextRole as "central" | "tarotista" }));
                }}>
                  <option value="">Sin asignar</option>
                  <optgroup label="Centrales">
                    {workers.filter((worker) => worker.role === "central").map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name || worker.email || worker.id}</option>)}
                  </optgroup>
                  <optgroup label="Tarotistas">
                    {workers.filter((worker) => worker.role === "tarotista").map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name || worker.email || worker.id}</option>)}
                  </optgroup>
                </select>
              </label>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Rol de la extensión</div>
                <select className="tc-select" value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as "central" | "tarotista" }))}>
                  <option value="central">Central</option>
                  <option value="tarotista">Tarotista</option>
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Extensión</div>
                  <input className="tc-input" value={form.extension} onChange={(e) => {
                    const nextExtension = cleanDigits(e.target.value);
                    setForm((prev) => ({
                      ...prev,
                      extension: nextExtension,
                      secret: (!prev.secret || prev.secret === "1234" || prev.secret === "123456") ? defaultSecretForExtension(nextExtension) : prev.secret,
                    }));
                  }} placeholder="1004" />
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Password SIP</div>
                  <input className="tc-input" type="password" value={form.secret} onChange={(e) => setForm((prev) => ({ ...prev, secret: e.target.value }))} placeholder="password" />
                  <div className="tc-sub" style={{ marginTop: 6 }}>1000 usa 123456. El resto se autocompleta con 1234, aunque puedes cambiarlo antes de guardar.</div>
                </label>
              </div>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Etiqueta visible</div>
                <input className="tc-input" value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="Ej. Tarotista móvil 1010" />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Tipo de ruta</div>
                  <select className="tc-select" value={form.route_type} onChange={(e) => setForm((prev) => ({ ...prev, route_type: e.target.value as "internal" | "external" }))}>
                    <option value="internal">Interna SIP</option>
                    <option value="external">Desvío a móvil</option>
                  </select>
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Cola</div>
                  <select className="tc-select" value={form.queue_id} onChange={(e) => setForm((prev) => ({ ...prev, queue_id: e.target.value }))}>
                    <option value="">Sin cola</option>
                    {queues.map((queue) => <option key={String(queue.id)} value={String(queue.id)}>{queue.label || queue.queue_key}</option>)}
                  </select>
                </label>
              </div>

              {form.route_type === "external" ? (
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Número móvil destino</div>
                  <input className="tc-input" value={form.target_phone} onChange={(e) => setForm((prev) => ({ ...prev, target_phone: cleanPhone(e.target.value) }))} placeholder="34600111222" />
                  <div className="tc-sub" style={{ marginTop: 6 }}>Esta extensión no sonará en SIP. Al marcarla, Asterisk podrá desviar la llamada al móvil configurado.</div>
                </label>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Prioridad en cola</div>
                  <input className="tc-input" type="number" value={form.queue_priority} onChange={(e) => setForm((prev) => ({ ...prev, queue_priority: Number(e.target.value || 0) || 0 }))} min={0} />
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Dominio SIP</div>
                  <input className="tc-input" value={form.domain} onChange={(e) => setForm((prev) => ({ ...prev, domain: e.target.value }))} placeholder="sip.clientestarotcelestial.es" />
                </label>
              </div>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Servidor WSS</div>
                <input className="tc-input" value={form.ws_server} onChange={(e) => setForm((prev) => ({ ...prev, ws_server: e.target.value }))} placeholder="wss://sip.clientestarotcelestial.es/ws" />
              </label>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Notas de routing</div>
                <textarea className="tc-input" value={form.routing_notes} onChange={(e) => setForm((prev) => ({ ...prev, routing_notes: e.target.value }))} placeholder="Ej. Tarotista de guardia o móvil personal de respaldo" rows={3} />
              </label>

              <label className="tc-chip" style={{ justifyContent: "flex-start", gap: 8, padding: 12 }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                Extensión activa
              </label>
            </div>

            <div className="tc-row" style={{ marginTop: 18, gap: 10, flexWrap: "wrap" }}>
              <button className="tc-btn tc-btn-gold" onClick={() => void saveExtension()} disabled={saving}><Save size={14} style={{ marginRight: 6 }} />{saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear extensión"}</button>
              {form.extension ? <button className="tc-btn" onClick={() => void copyValue(form.extension)}><Copy size={14} style={{ marginRight: 6 }} />Copiar ext.</button> : null}
            </div>
          </aside>
        </>
      ) : null}

      {queueDrawerOpen ? (
        <>
          <div onClick={() => setQueueDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(4,4,10,0.56)", backdropFilter: "blur(8px)", zIndex: 120 }} />
          <aside className="tc-card" style={{ position: "fixed", top: 84, left: 20, bottom: 20, width: "min(520px, calc(100vw - 24px))", zIndex: 121, padding: 18, overflowY: "auto", borderColor: "rgba(86,180,255,.26)", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
            <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="tc-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Users2 size={18} />{queueForm.id ? "Editar cola" : "Nueva cola"}</div>
                <div className="tc-sub" style={{ marginTop: 5 }}>Base visual para colas de operadoras. Queda lista para estrategias de central tipo ringall, leastrecent o roundrobin.</div>
              </div>
              <button className="tc-btn" onClick={() => setQueueDrawerOpen(false)}><X size={14} /></button>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Número de cola</div>
                  <input className="tc-input" value={queueForm.queue_key} onChange={(e) => setQueueForm((prev) => ({ ...prev, queue_key: cleanDigits(e.target.value) }))} placeholder="7001" />
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Nombre</div>
                  <input className="tc-input" value={queueForm.label} onChange={(e) => setQueueForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="Cola Tarot Noche" />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Estrategia</div>
                  <select className="tc-select" value={queueForm.strategy} onChange={(e) => setQueueForm((prev) => ({ ...prev, strategy: e.target.value }))}>
                    <option value="ringall">ringall</option>
                    <option value="leastrecent">leastrecent</option>
                    <option value="rrmemory">rrmemory</option>
                  </select>
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Ring timeout</div>
                  <input className="tc-input" type="number" value={queueForm.ring_timeout} onChange={(e) => setQueueForm((prev) => ({ ...prev, ring_timeout: Number(e.target.value || 20) || 20 }))} />
                </label>
                <label>
                  <div className="tc-sub" style={{ marginBottom: 6 }}>Wrapup</div>
                  <input className="tc-input" type="number" value={queueForm.wrapup_seconds} onChange={(e) => setQueueForm((prev) => ({ ...prev, wrapup_seconds: Number(e.target.value || 10) || 10 }))} />
                </label>
              </div>

              <label>
                <div className="tc-sub" style={{ marginBottom: 6 }}>Operadoras en cola</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {queueMembersDraft.map((member, idx) => (
                    <div key={`${member.worker_id}-${idx}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 44px", gap: 8 }}>
                      <select className="tc-select" value={member.worker_id} onChange={(e) => setQueueMembersDraft((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, worker_id: e.target.value, extension: cleanDigits(extensions.find((ext) => String(ext.worker_id || "") === e.target.value)?.extension || item.extension) } : item))}>
                        <option value="">Selecciona trabajadora</option>
                        {workers.filter((worker) => ["central", "tarotista"].includes(String(worker.role || ""))).map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name || worker.email || worker.id}</option>)}
                      </select>
                      <input className="tc-input" type="number" value={member.penalty} onChange={(e) => setQueueMembersDraft((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, penalty: Number(e.target.value || 0) || 0 } : item))} placeholder="Penalty" />
                      <button className="tc-btn" onClick={() => setQueueMembersDraft((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))}><X size={12} /></button>
                    </div>
                  ))}
                  <button className="tc-btn" onClick={() => setQueueMembersDraft((prev) => [...prev, { worker_id: "", extension: "", penalty: 0, is_active: true }])}><Plus size={14} style={{ marginRight: 6 }} />Añadir operadora</button>
                </div>
              </label>

              <label className="tc-chip" style={{ justifyContent: "flex-start", gap: 8, padding: 12 }}>
                <input type="checkbox" checked={queueForm.is_active} onChange={(e) => setQueueForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                Cola activa
              </label>
            </div>

            <div className="tc-row" style={{ marginTop: 18, gap: 10, flexWrap: "wrap" }}>
              <button className="tc-btn tc-btn-gold" onClick={() => void saveQueue()} disabled={saving}><Save size={14} style={{ marginRight: 6 }} />{saving ? "Guardando..." : queueForm.id ? "Guardar cola" : "Crear cola"}</button>
            </div>
          </aside>
        </>
      ) : null}

      <style jsx>{`
        .tc-card { border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(15, 15, 22, 0.88); border-radius: 24px; backdrop-filter: blur(16px); }
        .tc-row { display: flex; align-items: center; }
        .tc-title { font-weight: 900; color: #fff; }
        .tc-sub { color: rgba(255,255,255,.66); font-size: 13px; line-height: 1.35; }
        .tc-chip { display: inline-flex; align-items: center; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #fff; border-radius: 999px; padding: 8px 12px; font-size: 13px; min-width: 0; }
        .tc-compact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
        .tc-mini-card { display: grid; gap: 6px; text-align: left; width: 100%; min-height: 132px; padding: 10px; border-radius: 14px; border: 1px solid rgba(255,255,255,.16); color: #fff; }
        .tc-mini-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .tc-mini-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; }
        .tc-mini-ext { font-weight: 900; font-size: 13px; letter-spacing: .02em; }
        .tc-mini-role { margin-left: auto; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 2px 7px; font-size: 11px; font-weight: 800; }
        .tc-mini-badge { display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 2px 7px; font-size: 11px; background: rgba(255,255,255,.08); }
        .tc-mini-name { font-size: 14px; font-weight: 900; line-height: 1.15; min-height: 32px; }
        .tc-mini-sub { color: rgba(255,255,255,.84); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tc-mini-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: rgba(255,255,255,.7); font-size: 11px; margin-top: auto; }
        .tc-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 11px 14px; font-weight: 700; cursor: pointer; }
        .tc-btn-gold { background: linear-gradient(180deg, #f0d68d, #d7b56d); color: #22190b; border-color: rgba(215,181,109,.42); }
        .tc-btn-mini { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); color: #fff; padding: 7px 9px; font-size: 12px; cursor: pointer; }
        .tc-input, .tc-select { width: 100%; border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 12px 14px; outline: none; }
        .tc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
        .tc-kpi { border: 1px solid rgba(255,255,255,.11); border-radius: 22px; padding: 16px; background: rgba(255,255,255,.04); }
        .tc-kpi-label { color: rgba(255,255,255,.64); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
        .tc-kpi-value { color: #fff; font-weight: 900; font-size: 32px; margin-top: 6px; }
        .tc-queue-row { display: flex; gap: 12px; align-items: center; justify-content: space-between; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.03); border-radius: 16px; padding: 12px 14px; }
        textarea.tc-input { resize: vertical; min-height: 88px; }
      `}</style>
    </section>
  );
}
