"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CreditCard, MessageSquare, RefreshCw, Search, Send, Sparkles, UserRound, Volume2, Wallet, XCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import KpiCard from "@/components/ui/KpiCard";

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

function initials(name?: string | null) {
  const text = String(name || "TC").trim();
  return text.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "TC";
}

function bubbleClass(kind: string) {
  if (kind === "cliente") return "client";
  if (kind === "admin") return "admin";
  return "reader";
}

function getMarkedState(message: any) {
  const meta = message?.meta || {};
  if (meta?.is_respuesta) return "respuesta";
  if (meta?.is_pregunta) return "pregunta";
  return "normal";
}

function statusClass(kind: string) {
  if (kind === "libre") return "ok";
  if (kind === "ocupada") return "busy";
  return "off";
}

function beep() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.02;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // noop
  }
}

export default function AdminChatPanel() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<any>({ total_threads: 0, open_threads: 0, pending_payment: 0, tarotistas_online: 0, tarotistas_busy: 0 });
  const [tarotistas, setTarotistas] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedMessages, setSelectedMessages] = useState<any[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [creditAmount, setCreditAmount] = useState("5");
  const [paymentPack, setPaymentPack] = useState("chat_pack_5");
  const [threadSearch, setThreadSearch] = useState("");
  const [savingWorkerId, setSavingWorkerId] = useState("");
  const [closingThreadId, setClosingThreadId] = useState("");
  const [workerDrafts, setWorkerDrafts] = useState<Record<string, { visible_name: string; welcome_message: string }>>({});
  const [mobileTab, setMobileTab] = useState<"threads" | "detail" | "workers">("threads");
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const previousLastMessageRef = useRef<string>("");
  const messagesBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      setNotifyEnabled(window.localStorage.getItem("admin_chat_notify_enabled") === "1");
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("admin_chat_notify_enabled", notifyEnabled ? "1" : "0");
    } catch {}
  }, [notifyEnabled]);

  const selectedThread = useMemo(
    () => threads.find((t: any) => String(t.id) === String(selectedThreadId)) || null,
    [threads, selectedThreadId]
  );

  const filteredThreads = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((thread: any) =>
      [thread.cliente_nombre, thread.cliente_telefono, thread.cliente_email, thread.tarotista_display_name, thread.last_message_preview]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [threadSearch, threads]);

  const loadOverview = useCallback(async (keepSelection = true) => {
  try {
    setLoading(true);

    const token = await getToken();
    const res = await fetch("/api/admin/chat/overview", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "No se pudo cargar el módulo de chat");
    }

    const nextThreads = Array.isArray(json.threads) ? json.threads : [];

    setSummary(json.summary || {});
    setTarotistas(Array.isArray(json.tarotistas) ? json.tarotistas : []);
    setThreads(nextThreads);

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

    const newest = nextThreads[0]?.last_message_at
      ? String(nextThreads[0].last_message_at)
      : "";

    if (
      notifyEnabled &&
      previousLastMessageRef.current &&
      newest &&
      newest !== previousLastMessageRef.current
    ) {
      beep();

      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification("Nuevo mensaje en el chat", {
          body: `${nextThreads[0]?.cliente_nombre || "Cliente"}: ${
            nextThreads[0]?.last_message_preview || "Mensaje nuevo"
          }`,
        });
      }
    }

    previousLastMessageRef.current = newest;

    // 🔥 FIX CHAT (SIN ROMPER NADA)
    if (!selectedThreadId) {
      setSelectedThreadId(String(nextThreads[0]?.id || ""));
    } else {
      const stillExists = nextThreads.some(
        (t: any) => String(t.id) === String(selectedThreadId)
      );

      if (!stillExists) {
        setSelectedThreadId(String(nextThreads[0]?.id || ""));
      }
    }

    setMsg("");
} catch (e) {
  if (e instanceof Error) {
    setMsg(`❌ ${e.message}`);
  } else {
    setMsg("❌ Error");
  }
} finally {
  setLoading(false);
}
}, [notifyEnabled, selectedThreadId]);

  const loadMessages = useCallback(async () => {
    if (!selectedThreadId) {
      setSelectedMessages([]);
      return;
    }
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/chat/thread?thread_id=${encodeURIComponent(selectedThreadId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
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

  useEffect(() => {
    const box = messagesBoxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [selectedMessages]);

  async function enableNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setMsg("⚠️ Este dispositivo no soporta notificaciones del navegador.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotifyEnabled(true);
      setMsg("✅ Avisos activados. Recibirás aviso del navegador y sonido cuando entren mensajes nuevos mientras el navegador siga abierto.");
      beep();
      return;
    }
    setMsg("⚠️ No se pudieron activar las notificaciones del navegador.");
  }

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
      await setWorkerStatus(workerId, { visible_name: draft.visible_name, welcome_message: draft.welcome_message }, "✅ Perfil de tarotista guardado.");
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
      await loadOverview(true);
      if (mode === "pregunta") setMsg("✅ Marcado como pregunta real. Solo ahora cuenta en créditos.");
      if (mode === "respuesta") setMsg("✅ Marcado como respuesta.");
      if (mode === "clear") setMsg("✅ Marca eliminada y saldo corregido si hacía falta.");
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

  async function closeConversation(threadId: string) {
    try {
      setClosingThreadId(threadId);
      const token = await getToken();
      const res = await fetch("/api/admin/chat/close-thread", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cerrar la conversación");
      setMsg("✅ Conversación cerrada.");
      setSelectedThreadId("");
      setSelectedMessages([]);
      await loadOverview(false);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setClosingThreadId("");
    }
  }

  return (
    <div className="tc-card" style={{ display: "grid", gap: 18 }}>
      <div className="topbar">
        <div>
          <div className="tc-title" style={{ fontSize: 22 }}>💬 Chat profesional</div>
          <div className="tc-sub" style={{ fontSize: 13 }}>Más cómodo para móvil, con envío de pagos, marcado manual de preguntas y aviso de nuevos mensajes.</div>
        </div>
        <div className="toolbar">
          <button className="tc-btn" onClick={enableNotifications}><Bell size={14} /> {notifyEnabled ? "Avisos activos" : "Activar avisos"}</button>
          <button className="tc-btn" onClick={() => { setNotifyEnabled(true); beep(); }}><Volume2 size={14} /> Probar sonido</button>
          <button className="tc-btn tc-btn-gold" onClick={() => loadOverview(true)} disabled={loading}><RefreshCw size={14} /> {loading ? "Cargando…" : "Refrescar"}</button>
        </div>
      </div>

      <div className="admin-chat-kpis">
        <KpiCard title="Hilos totales" value={String(summary.total_threads || 0)} hint="Histórico visible" accent="rgba(181,156,255,.75)" />
        <KpiCard title="Chats abiertos" value={String(summary.open_threads || 0)} hint="Conversaciones activas" accent="rgba(59,130,246,.75)" />
        <KpiCard title="Pendientes de pago" value={String(summary.pending_payment || 0)} hint="Sin créditos tras la gratuita" accent="rgba(245,158,11,.75)" />
        <KpiCard title="Tarotistas online" value={String(summary.tarotistas_online || 0)} hint="Disponibles al cliente" accent="rgba(34,197,94,.75)" />
        <KpiCard title="Tarotistas ocupadas" value={String(summary.tarotistas_busy || 0)} hint="Con hilo activo" accent="rgba(249,115,22,.75)" />
      </div>

      <div className="tc-card" style={{ padding: 12, background: "rgba(255,255,255,.035)" }}>
        <div className="tc-sub" style={{ fontSize: 13 }}>
          {msg || "Los avisos del chat funcionan con notificación del navegador + sonido. Sin una suscripción push específica de admin no pueden llegar con el navegador totalmente cerrado."}
        </div>
      </div>

      <div className="mobile-tabs">
        <button className={mobileTab === "threads" ? "tc-btn tc-btn-gold" : "tc-btn"} onClick={() => setMobileTab("threads")}>Chats</button>
        <button className={mobileTab === "detail" ? "tc-btn tc-btn-gold" : "tc-btn"} onClick={() => setMobileTab("detail")}>Detalle</button>
        <button className={mobileTab === "workers" ? "tc-btn tc-btn-gold" : "tc-btn"} onClick={() => setMobileTab("workers")}>Tarotistas</button>
      </div>

      <div className="admin-chat-grid">
        <section className={`admin-column ${mobileTab !== "threads" ? "mobile-hidden" : ""}`}>
          <div className="column-card">
            <div className="column-head">
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>Chats</div>
                <div className="tc-sub">Elige un hilo para responder.</div>
              </div>
            </div>
            <div className="search-wrap">
              <Search size={15} />
              <input value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)} placeholder="Buscar cliente, tarotista o texto…" />
            </div>
            <div className="admin-scroll">
              {filteredThreads.map((thread: any) => (
                <button key={thread.id} className={`thread-card ${selectedThreadId === String(thread.id) ? "thread-card-active" : ""}`} onClick={() => { setSelectedThreadId(String(thread.id)); setMobileTab("detail"); }}>
                  <div className="row-between">
                    <div>
                      <div className="thread-title">{thread.cliente_nombre}</div>
                      <div className="tc-sub">{thread.tarotista_display_name} · {fmt(thread.last_message_at)}</div>
                    </div>
                    <span className="tc-chip"><Wallet size={13} style={{ marginRight: 6 }} /> {thread.creditos_cliente || 0}</span>
                  </div>
                  <div className="thread-preview">{thread.last_message_preview || "Sin mensajes todavía."}</div>
                </button>
              ))}
              {!filteredThreads.length ? <div className="tc-sub">No hay hilos con esos filtros.</div> : null}
            </div>
          </div>
        </section>

        <section className={`detail-column ${mobileTab !== "detail" ? "mobile-hidden" : ""}`}>
          <div className="column-card detail-stretch">
            {!selectedThread ? (
              <div className="empty-state"><MessageSquare size={18} /> Selecciona un chat para contestar.</div>
            ) : (
              <>
                <div className="row-between gap-wrap">
                  <div>
                    <div className="tc-title" style={{ fontSize: 20 }}>{selectedThread.cliente_nombre}</div>
                    <div className="tc-sub">{selectedThread.cliente_telefono || "Sin teléfono"} · {selectedThread.cliente_email || "Sin email"}</div>
                  </div>
                  <div className="toolbar">
                    <span className="tc-chip"><Wallet size={13} style={{ marginRight: 6 }} /> {selectedThread.creditos_cliente || 0} créditos</span>
                    <span className="tc-chip"><UserRound size={13} style={{ marginRight: 6 }} /> {selectedThread.tarotista_display_name || "Tarotista"}</span>
                    <button className="tc-btn" disabled={closingThreadId === selectedThread.id} onClick={() => closeConversation(selectedThread.id)}><XCircle size={14} /> {closingThreadId === selectedThread.id ? "Cerrando…" : "Cerrar"}</button>
                  </div>
                </div>

                <div className="detail-stats">
                  <div className="mini-box"><span>Free</span><b>{selectedThread.free_consulta_usada ? "Usada" : "Disponible"}</b></div>
                  <div className="mini-box"><span>Estado</span><b>{selectedThread.estado || "open"}</b></div>
                  <div className="mini-box"><span>Último mensaje</span><b>{fmt(selectedThread.last_message_at)}</b></div>
                  <div className="mini-box"><span>Hilo</span><b>Fijo con tarotista</b></div>
                </div>

                <div className="quick-actions">
                  <input className="tc-input" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} style={{ width: 110 }} />
                  <button className="tc-btn tc-btn-ok" onClick={() => adjustCredits(Math.max(1, Math.trunc(Number(creditAmount) || 0)))}>+ créditos</button>
                  <button className="tc-btn" onClick={() => adjustCredits(-Math.max(1, Math.trunc(Number(creditAmount) || 0)))}>- créditos</button>
                  <select className="tc-select" value={paymentPack} onChange={(e) => setPaymentPack(e.target.value)} style={{ width: 180 }}>
                    <option value="chat_pack_3">3 preguntas · pack rápido</option>
                    <option value="chat_pack_5">5 preguntas · recomendado</option>
                    <option value="chat_pack_10">10 preguntas · sesión profunda</option>
                  </select>
                  <button className="tc-btn tc-btn-gold" onClick={sendPaymentLink}><CreditCard size={14} /> Enviar enlace y precios</button>
                </div>

                <div className="messages-admin" ref={messagesBoxRef}>
                  {selectedMessages.map((item: any) => {
                    const mark = getMarkedState(item);
                    return (
                      <div key={item.id} className={`bubble-row ${bubbleClass(item.sender_type)}`}>
                        <div className="bubble-head">{item.sender_display_name || item.sender_type}</div>
                        <div className={`bubble ${bubbleClass(item.sender_type)}`}>
                          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{item.body}</div>
                          <div className="bubble-meta">
                            <span>{fmt(item.created_at)}</span>
                            <div className="toolbar" style={{ gap: 6 }}>
                              {mark === "pregunta" ? <span className="tc-chip">Pregunta real</span> : null}
                              {mark === "respuesta" ? <span className="tc-chip">Respuesta</span> : null}
                            </div>
                          </div>
                        </div>
                        <div className="toolbar">
                          <button className="tc-btn" onClick={() => markMessage(item.id, "pregunta")}>Marcar pregunta</button>
                          <button className="tc-btn" onClick={() => markMessage(item.id, "respuesta")}>Marcar respuesta</button>
                          <button className="tc-btn" onClick={() => markMessage(item.id, "clear")}>Quitar marca</button>
                        </div>
                      </div>
                    );
                  })}
                  {!selectedMessages.length ? <div className="tc-sub">Sin mensajes todavía.</div> : null}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <textarea className="tc-textarea" value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="Escribe la respuesta o pega aquí el texto con precios y enlace de pago…" style={{ minHeight: 110, resize: "vertical" }} />
                  <div className="row-between gap-wrap">
                    <div className="tc-sub" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Sparkles size={14} /> Todo queda centralizado en el hilo.</div>
                    <button className="tc-btn tc-btn-purple" onClick={() => sendMessage("text")} disabled={sending}><Send size={14} /> {sending ? "Enviando…" : "Enviar respuesta"}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className={`admin-column ${mobileTab !== "workers" ? "mobile-hidden" : ""}`}>
          <div className="column-card">
            <div className="column-head">
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>Tarotistas</div>
                <div className="tc-sub">Estado y presentación visibles para el cliente.</div>
              </div>
            </div>
            <div className="admin-scroll">
              {tarotistas.map((worker: any) => {
                const draft = workerDrafts[String(worker.id)] || { visible_name: worker.display_name || "", welcome_message: worker.welcome_message || "" };
                return (
                  <div key={worker.id} className="worker-admin-card">
                    <div className="row-between gap-wrap">
                      <div className="avatar-line">
                        <div className="admin-avatar">{initials(worker.display_name)}</div>
                        <div>
                          <div className="thread-title">{worker.display_name}</div>
                          <div className="tc-sub">{worker.team || "Sin equipo"}</div>
                        </div>
                      </div>
                      <span className={`status-dot ${statusClass(worker.status_key)}`}>{worker.status_label}</span>
                    </div>

                    <div className="toolbar">
                      <button className="tc-btn tc-btn-ok" onClick={() => setWorkerStatus(worker.id, { is_online: true, is_busy: false, chat_enabled: true }, "✅ Tarotista marcada como libre.")}>Libre</button>
                      <button className="tc-btn" onClick={() => setWorkerStatus(worker.id, { is_online: true, is_busy: true, chat_enabled: true }, "✅ Tarotista marcada como ocupada.")}>Ocupada</button>
                      <button className="tc-btn" onClick={() => setWorkerStatus(worker.id, { is_online: false, is_busy: false, chat_enabled: false }, "✅ Tarotista desconectada.")}>Offline</button>
                    </div>

                    <input className="tc-input" value={draft.visible_name} onChange={(e) => setWorkerDrafts((prev) => ({ ...prev, [worker.id]: { ...draft, visible_name: e.target.value } }))} placeholder="Nombre visible" />
                    <textarea className="tc-textarea" value={draft.welcome_message} onChange={(e) => setWorkerDrafts((prev) => ({ ...prev, [worker.id]: { ...draft, welcome_message: e.target.value } }))} placeholder="Descripción / bienvenida" style={{ minHeight: 90 }} />
                    <button className="tc-btn tc-btn-gold" onClick={() => saveWorkerProfile(worker.id)} disabled={savingWorkerId === worker.id}>{savingWorkerId === worker.id ? "Guardando…" : "Guardar perfil"}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .topbar,.toolbar,.row-between,.gap-wrap,.avatar-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        .topbar,.row-between{justify-content:space-between;align-items:flex-start;}
        .admin-chat-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;}
        .mobile-tabs{display:none;gap:8px;}
        .admin-chat-grid{display:grid;grid-template-columns:minmax(300px,360px) minmax(0,1fr) minmax(300px,360px);gap:16px;align-items:start;}
        .column-card{display:grid;gap:12px;padding:14px;border-radius:22px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);}
        .admin-column,.detail-column{display:grid;gap:12px;min-height:820px;}
        .detail-stretch{min-height:100%;align-content:start;}
        .admin-scroll{display:grid;gap:12px;max-height:760px;overflow:auto;padding-right:4px;}
        .search-wrap{display:flex;align-items:center;gap:8px;padding:0 12px;height:46px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);}
        .search-wrap input{flex:1;background:transparent;border:none;color:#fff;outline:none;}
        .thread-card,.worker-admin-card{display:grid;gap:10px;padding:14px;border-radius:20px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);text-align:left;}
        .thread-card-active{border-color:rgba(181,156,255,.45);background:rgba(181,156,255,.12);}
        .thread-title{font-weight:900;font-size:17px;}
        .thread-preview{color:#e2e8f0;line-height:1.5;}
        .empty-state{min-height:180px;display:grid;place-items:center;text-align:center;color:#cbd5e1;border-radius:18px;border:1px dashed rgba(255,255,255,.12);}
        .detail-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
        .mini-box{padding:12px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);display:grid;gap:6px;}
        .mini-box span{font-size:12px;color:#cbd5e1;}
        .mini-box b{font-size:18px;}
        .quick-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
        .messages-admin{min-height:360px;max-height:480px;overflow:auto;padding:12px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);display:grid;gap:12px;}
        .bubble-row{display:grid;gap:6px;}
        .bubble-row.client{justify-items:start;}
        .bubble-row.admin,.bubble-row.reader{justify-items:end;}
        .bubble-head{font-size:12px;color:#cbd5e1;}
        .bubble{max-width:86%;border-radius:18px;padding:12px;display:grid;gap:10px;}
        .bubble.client{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);}
        .bubble.admin{background:rgba(215,181,109,.16);border:1px solid rgba(215,181,109,.28);}
        .bubble.reader{background:rgba(139,92,246,.16);border:1px solid rgba(139,92,246,.28);}
        .bubble-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;color:#cbd5e1;}
        .admin-avatar{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;font-weight:900;color:#fff7ed;background:radial-gradient(circle at top, rgba(215,181,109,.88), rgba(107,33,168,.9));}
        .status-dot{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;font-size:12px;border:1px solid rgba(255,255,255,.08);}
        .status-dot.ok{background:rgba(34,197,94,.14);color:#dcfce7;}
        .status-dot.busy{background:rgba(249,115,22,.14);color:#fed7aa;}
        .status-dot.off{background:rgba(148,163,184,.12);color:#e2e8f0;}
        @media (max-width: 1380px){.admin-chat-grid{grid-template-columns:minmax(300px,360px) minmax(0,1fr);} .admin-column:last-child{grid-column:1/-1;} }
        @media (max-width: 980px){
          .admin-chat-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}
          .admin-chat-grid{grid-template-columns:1fr;}
          .mobile-tabs{display:flex;}
          .admin-column,.detail-column{min-height:auto;}
          .admin-scroll,.messages-admin{max-height:none;}
          .detail-stats{grid-template-columns:repeat(2,minmax(0,1fr));}
          .mobile-hidden{display:none;}
        }
        @media (max-width: 640px){.admin-chat-kpis,.detail-stats{grid-template-columns:1fr;}.quick-actions{display:grid;grid-template-columns:1fr 1fr;}.quick-actions :global(select), .quick-actions :global(input){width:100% !important;grid-column:1/-1;}}
      `}</style>
    </div>
  );
}
