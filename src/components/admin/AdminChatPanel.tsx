"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import KpiCard from "@/components/ui/KpiCard";
import { MessageSquare, RefreshCw, Search, Send, Sparkles, UserRound, Wallet } from "lucide-react";

const sb = supabaseBrowser();

async function getToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function bubbleStyle(kind: string) {
  if (kind === "cliente") {
    return {
      background: "rgba(255,255,255,.07)",
      border: "1px solid rgba(255,255,255,.10)",
      justifySelf: "start" as const,
    };
  }

  if (kind === "admin") {
    return {
      background: "rgba(215,181,109,.16)",
      border: "1px solid rgba(215,181,109,.28)",
      justifySelf: "end" as const,
    };
  }

  return {
    background: "rgba(139,92,246,.16)",
    border: "1px solid rgba(139,92,246,.28)",
    justifySelf: "end" as const,
  };
}

function chipStyle(kind: string) {
  if (kind === "libre") return { background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.34)", color: "#dcfce7" };
  if (kind === "ocupada") return { background: "rgba(249,115,22,.14)", border: "1px solid rgba(249,115,22,.34)", color: "#fed7aa" };
  return { background: "rgba(148,163,184,.12)", border: "1px solid rgba(148,163,184,.24)", color: "#e2e8f0" };
}

function getMarkedState(message: any) {
  const meta = message?.meta || {};
  if (meta?.is_respuesta) return "respuesta";
  if (meta?.is_pregunta) return "pregunta";
  return "normal";
}

export default function AdminChatPanel() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<any>({ total_threads: 0, open_threads: 0, pending_payment: 0, tarotistas_online: 0, tarotistas_busy: 0 });
  const [tarotistas, setTarotistas] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>("");
  const [selectedMessages, setSelectedMessages] = useState<any[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [creditAmount, setCreditAmount] = useState("5");
  const [paymentPack, setPaymentPack] = useState("chat_pack_12");
  const [threadSearch, setThreadSearch] = useState("");
  const [savingWorkerId, setSavingWorkerId] = useState<string>("");
  const [workerDrafts, setWorkerDrafts] = useState<Record<string, { visible_name: string; welcome_message: string }>>({});

  const selectedThread = useMemo(
    () => threads.find((t) => String(t.id) === String(selectedThreadId)) || null,
    [threads, selectedThreadId]
  );

  const filteredThreads = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((thread: any) => {
      const haystack = [
        thread.cliente_nombre,
        thread.cliente_telefono,
        thread.cliente_email,
        thread.tarotista_display_name,
        thread.last_message_preview,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [threadSearch, threads]);

  const loadOverview = useCallback(async (keepSelection = true) => {
    try {
      setLoading(true);
      const token = await getToken();
      const res = await fetch("/api/admin/chat/overview", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar el módulo de chat");
      setSummary(json.summary || {});
      setTarotistas(Array.isArray(json.tarotistas) ? json.tarotistas : []);
      setThreads(Array.isArray(json.threads) ? json.threads : []);
      setWorkerDrafts((prev) => {
        const next = { ...prev };
        for (const worker of json.tarotistas || []) {
          next[String(worker.id)] = {
            visible_name: worker.display_name || "",
            welcome_message: worker.welcome_message || "",
          };
        }
        return next;
      });

      if (!keepSelection || !selectedThreadId) {
        setSelectedThreadId(String(json?.threads?.[0]?.id || ""));
      } else {
        const exists = (json.threads || []).some((t: any) => String(t.id) === String(selectedThreadId));
        if (!exists) setSelectedThreadId(String(json?.threads?.[0]?.id || ""));
      }
      setMsg("");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setLoading(false);
    }
  }, [selectedThreadId]);

  const loadMessages = useCallback(async () => {
    if (!selectedThreadId) {
      setSelectedMessages([]);
      return;
    }
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/chat/thread?thread_id=${encodeURIComponent(selectedThreadId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setSelectedMessages(Array.isArray(json.messages) ? json.messages : []);
      }
    } catch {
      // noop
    }
  }, [selectedThreadId]);

  useEffect(() => {
    loadOverview(false);
    const id = window.setInterval(() => loadOverview(true), 12000);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  useEffect(() => {
    loadMessages();
    if (!selectedThreadId) return;
    const id = window.setInterval(() => loadMessages(), 5000);
    return () => window.clearInterval(id);
  }, [loadMessages, selectedThreadId]);

  async function setWorkerStatus(workerId: string, patch: any, successMessage?: string) {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/chat/status", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId, ...patch }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo actualizar el estado");
      await loadOverview(true);
      setMsg(successMessage || "✅ Tarotista actualizada.");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function saveWorkerProfile(workerId: string) {
    const draft = workerDrafts[workerId];
    if (!draft) return;
    try {
      setSavingWorkerId(workerId);
      await setWorkerStatus(workerId, {
        visible_name: draft.visible_name,
        welcome_message: draft.welcome_message,
      }, "✅ Nombre visible y bienvenida guardados.");
    } finally {
      setSavingWorkerId("");
    }
  }

  async function markMessage(messageId: string, mode: "pregunta" | "respuesta" | "clear") {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/chat/message-flags", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, mode }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo marcar el mensaje");
      await loadMessages();
      setMsg(
        mode === "pregunta"
          ? "✅ Mensaje marcado como pregunta real."
          : mode === "respuesta"
          ? "✅ Mensaje marcado como respuesta."
          : "✅ Marca eliminada."
      );
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function sendMessage(kind: "text" | "payment_link" = "text") {
    if (!selectedThreadId || !composer.trim()) return;
    try {
      setSending(true);
      const token = await getToken();
      const res = await fetch("/api/admin/chat/message", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: selectedThreadId, body: composer, kind }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo enviar el mensaje");
      setComposer("");
      await loadMessages();
      await loadOverview(true);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSending(false);
    }
  }

  async function adjustCredits(amount: number) {
    if (!selectedThread) return;
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/chat/credits", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: selectedThread.cliente_id,
          thread_id: selectedThread.id,
          amount,
          notes: `Ajuste manual chat (${amount > 0 ? "+" : ""}${amount})`,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudieron ajustar los créditos");
      await loadOverview(true);
      setMsg(`✅ Créditos actualizados. Nuevo saldo: ${json.balance}`);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function sendPaymentLink() {
    if (!selectedThread) return;
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/chat/payment-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: selectedThread.cliente_id, thread_id: selectedThread.id, pack_id: paymentPack, send_to_thread: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo crear el enlace");
      setMsg("✅ Enlace de pago enviado al chat.");
      await loadMessages();
      await loadOverview(true);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  return (
    <div className="tc-card" style={{ display: "grid", gap: 18 }}>
      <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="tc-title" style={{ fontSize: 22 }}>💬 Chat profesional</div>
          <div className="tc-sub" style={{ fontSize: 13 }}>
            Gestión visual de tarotistas, hilos, cobros y marcado manual de preguntas reales desde un panel mucho más limpio.
          </div>
        </div>
        <button className="tc-btn tc-btn-gold" onClick={() => loadOverview(true)} disabled={loading}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <RefreshCw size={15} /> {loading ? "Cargando…" : "Refrescar"}
          </span>
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10 }}>
        <KpiCard title="Hilos totales" value={String(summary.total_threads || 0)} hint="Histórico visible" accent="rgba(181,156,255,.75)" />
        <KpiCard title="Chats abiertos" value={String(summary.open_threads || 0)} hint="Conversaciones activas" accent="rgba(59,130,246,.75)" />
        <KpiCard title="Pendientes de pago" value={String(summary.pending_payment || 0)} hint="Sin créditos tras la free" accent="rgba(245,158,11,.75)" />
        <KpiCard title="Tarotistas online" value={String(summary.tarotistas_online || 0)} hint="Visibles al cliente" accent="rgba(34,197,94,.75)" />
        <KpiCard title="Tarotistas ocupadas" value={String(summary.tarotistas_busy || 0)} hint="Con hilos en curso" accent="rgba(249,115,22,.75)" />
      </div>

      <div className="tc-card" style={{ padding: 12, background: "rgba(255,255,255,.035)" }}>
        <div className="tc-sub" style={{ fontSize: 13 }}>{msg || "Consejo operativo: marca manualmente qué mensaje cuenta como pregunta real para tener control comercial y evitar cobros automáticos injustos."}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "380px 360px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <section className="tc-card" style={{ display: "grid", gap: 12, maxHeight: 900, overflow: "auto" }}>
          <div className="tc-row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="tc-title" style={{ fontSize: 16 }}>Tarotistas</div>
              <div className="tc-sub">Edita nombre visible, mensaje de bienvenida y estado.</div>
            </div>
            <span className="tc-chip">{tarotistas.length} visibles</span>
          </div>

          {tarotistas.map((worker: any) => {
            const draft = workerDrafts[String(worker.id)] || { visible_name: worker.display_name || "", welcome_message: worker.welcome_message || "" };
            return (
              <div key={worker.id} className="tc-card" style={{ padding: 14, display: "grid", gap: 10, background: worker.status_bg, border: worker.status_border }}>
                <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900, fontSize: 15 }}>{worker.display_name}</div>
                    <div className="tc-sub">Equipo {worker.team || "—"} · {worker.open_threads || 0} chats abiertos</div>
                  </div>
                  <span className="tc-chip" style={chipStyle(worker.status_key)}>{worker.status_label}</span>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    className="tc-input"
                    placeholder="Nombre visible para cliente"
                    value={draft.visible_name}
                    onChange={(e) => setWorkerDrafts((prev) => ({ ...prev, [worker.id]: { ...draft, visible_name: e.target.value } }))}
                  />
                  <textarea
                    className="tc-textarea"
                    placeholder="Mensaje de bienvenida"
                    style={{ minHeight: 90, resize: "vertical" }}
                    value={draft.welcome_message}
                    onChange={(e) => setWorkerDrafts((prev) => ({ ...prev, [worker.id]: { ...draft, welcome_message: e.target.value } }))}
                  />
                </div>

                <div className="tc-row" style={{ gap: 8 }}>
                  <button className="tc-btn tc-btn-ok" onClick={() => setWorkerStatus(worker.id, { is_online: true, chat_enabled: true, is_busy: false }, "✅ Tarotista marcada como libre.")}>Libre</button>
                  <button className="tc-btn tc-btn-gold" onClick={() => setWorkerStatus(worker.id, { is_online: true, chat_enabled: true, is_busy: true }, "✅ Tarotista marcada como ocupada.")}>Ocupada</button>
                  <button className="tc-btn" onClick={() => setWorkerStatus(worker.id, { is_online: false, chat_enabled: false, is_busy: false }, "✅ Tarotista ocultada del chat.")}>Offline</button>
                </div>

                <button className="tc-btn tc-btn-purple" disabled={savingWorkerId === String(worker.id)} onClick={() => saveWorkerProfile(String(worker.id))}>
                  {savingWorkerId === String(worker.id) ? "Guardando…" : "Guardar nombre y bienvenida"}
                </button>
              </div>
            );
          })}
        </section>

        <section className="tc-card" style={{ display: "grid", gap: 12, maxHeight: 900, overflow: "auto" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div className="tc-title" style={{ fontSize: 16 }}>Conversaciones</div>
              <div className="tc-sub">Lista limpia con búsqueda rápida y señales comerciales.</div>
            </div>
            <div style={{ position: "relative" }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: 12, opacity: 0.7 }} />
              <input className="tc-input" style={{ paddingLeft: 36 }} placeholder="Buscar por cliente, teléfono, email o tarotista" value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)} />
            </div>
          </div>

          {filteredThreads.map((thread: any) => {
            const active = String(thread.id) === String(selectedThreadId);
            return (
              <button
                key={thread.id}
                className="tc-card tc-click"
                onClick={() => setSelectedThreadId(String(thread.id))}
                style={{
                  textAlign: "left",
                  padding: 14,
                  border: active ? "1px solid rgba(181,156,255,.45)" : "1px solid rgba(255,255,255,.08)",
                  background: active ? "rgba(181,156,255,.12)" : "rgba(255,255,255,.03)",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>{thread.cliente_nombre}</div>
                    <div className="tc-sub">{thread.cliente_telefono || "Sin teléfono"}</div>
                  </div>
                  <span className="tc-chip">{thread.creditos_cliente || 0} créditos</span>
                </div>
                <div className="tc-sub">Tarotista: {thread.tarotista_display_name || "—"}</div>
                <div style={{ fontSize: 13, lineHeight: 1.45 }}>{thread.last_message_preview || "Sin mensajes"}</div>
                <div className="tc-row" style={{ justifyContent: "space-between" }}>
                  <span className="tc-chip">{thread.free_consulta_usada ? "Free usada" : "Free disponible"}</span>
                  <span className="tc-sub">{fmt(thread.last_message_at)}</span>
                </div>
              </button>
            );
          })}

          {!filteredThreads.length ? <div className="tc-sub">No hay conversaciones que coincidan con la búsqueda.</div> : null}
        </section>

        <section className="tc-card" style={{ minHeight: 760, display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 12 }}>
          {!selectedThread ? (
            <div className="tc-sub">Selecciona una conversación para verla en detalle.</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10 }}>
                <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 20 }}>{selectedThread.cliente_nombre}</div>
                    <div className="tc-sub">{selectedThread.cliente_telefono || "Sin teléfono"} · {selectedThread.cliente_email || "Sin email"}</div>
                  </div>
                  <div className="tc-row" style={{ gap: 8 }}>
                    <span className="tc-chip"><Wallet size={13} style={{ marginRight: 6 }} /> {selectedThread.creditos_cliente || 0} créditos</span>
                    <span className="tc-chip"><UserRound size={13} style={{ marginRight: 6 }} /> {selectedThread.tarotista_display_name || "Tarotista"}</span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                  <div className="tc-card" style={{ padding: 12 }}>
                    <div className="tc-sub">Free</div>
                    <div className="tc-title">{selectedThread.free_consulta_usada ? "Usada" : "Disponible"}</div>
                  </div>
                  <div className="tc-card" style={{ padding: 12 }}>
                    <div className="tc-sub">Estado</div>
                    <div className="tc-title">{selectedThread.estado || "open"}</div>
                  </div>
                  <div className="tc-card" style={{ padding: 12 }}>
                    <div className="tc-sub">Último mensaje</div>
                    <div className="tc-title">{fmt(selectedThread.last_message_at)}</div>
                  </div>
                  <div className="tc-card" style={{ padding: 12 }}>
                    <div className="tc-sub">Hilo</div>
                    <div className="tc-title">Fijo con tarotista</div>
                  </div>
                </div>
              </div>

              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input className="tc-input" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} style={{ width: 110 }} />
                <button className="tc-btn tc-btn-ok" onClick={() => adjustCredits(Math.max(1, Math.trunc(Number(creditAmount) || 0)))}>+ créditos</button>
                <button className="tc-btn" onClick={() => adjustCredits(-Math.max(1, Math.trunc(Number(creditAmount) || 0)))}>- créditos</button>
                <select className="tc-select" value={paymentPack} onChange={(e) => setPaymentPack(e.target.value)} style={{ width: 180 }}>
                  <option value="chat_pack_5">Pack 5 créditos</option>
                  <option value="chat_pack_12">Pack 12 créditos</option>
                  <option value="chat_pack_25">Pack 25 créditos</option>
                </select>
                <button className="tc-btn tc-btn-gold" onClick={sendPaymentLink}><Sparkles size={14} style={{ marginRight: 6 }} /> Enviar enlace</button>
              </div>

              <div style={{ minHeight: 360, maxHeight: 480, overflow: "auto", padding: 12, borderRadius: 18, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", display: "grid", gap: 12 }}>
                {selectedMessages.map((item: any) => {
                  const bubble = bubbleStyle(item.sender_type);
                  const markedState = getMarkedState(item);
                  return (
                    <div key={item.id} style={{ display: "grid", gap: 6, justifyItems: bubble.justifySelf === "end" ? "end" : "start" }}>
                      <div className="tc-sub">{item.sender_display_name || item.sender_type}</div>
                      <div style={{ ...bubble, maxWidth: "82%", borderRadius: 18, padding: 12 }}>
                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.body}</div>
                        <div className="tc-row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                          <div className="tc-sub">{fmt(item.created_at)}</div>
                          <div className="tc-row" style={{ gap: 6 }}>
                            {markedState === "pregunta" ? <span className="tc-chip">Pregunta real</span> : null}
                            {markedState === "respuesta" ? <span className="tc-chip">Respuesta</span> : null}
                          </div>
                        </div>
                      </div>
                      <div className="tc-row" style={{ gap: 6 }}>
                        <button className="tc-btn" onClick={() => markMessage(item.id, "pregunta")}>Marcar pregunta</button>
                        <button className="tc-btn" onClick={() => markMessage(item.id, "respuesta")}>Marcar respuesta</button>
                        <button className="tc-btn" onClick={() => markMessage(item.id, "clear")}>Quitar marca</button>
                      </div>
                    </div>
                  );
                })}
                {!selectedMessages.length && <div className="tc-sub">Sin mensajes todavía.</div>}
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <textarea
                  className="tc-textarea"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Escribe la respuesta desde admin o envía directamente un texto de cierre / seguimiento…"
                  style={{ minHeight: 110, resize: "vertical" }}
                />
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <div className="tc-sub" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <MessageSquare size={14} /> Todo queda centralizado en el hilo.
                  </div>
                  <button className="tc-btn tc-btn-purple" onClick={() => sendMessage("text")} disabled={sending}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Send size={14} /> {sending ? "Enviando…" : "Enviar respuesta"}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
