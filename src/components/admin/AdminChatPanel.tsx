"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import KpiCard from "@/components/ui/KpiCard";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

async function getToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

function chipStyle(kind: string) {
  if (kind === "libre") return { background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.34)", color: "#dcfce7" };
  if (kind === "ocupada") return { background: "rgba(249,115,22,.14)", border: "1px solid rgba(249,115,22,.34)", color: "#fed7aa" };
  return { background: "rgba(148,163,184,.12)", border: "1px solid rgba(148,163,184,.24)", color: "#e2e8f0" };
}

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
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

  const selectedThread = useMemo(() => threads.find((t) => String(t.id) === String(selectedThreadId)) || null, [threads, selectedThreadId]);

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
    const id = window.setInterval(() => loadOverview(true), 10000);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  useEffect(() => {
    loadMessages();
    if (!selectedThreadId) return;
    const id = window.setInterval(() => loadMessages(), 5000);
    return () => window.clearInterval(id);
  }, [loadMessages, selectedThreadId]);

  async function setWorkerStatus(workerId: string, patch: any) {
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
      setMsg("✅ Estado de tarotista actualizado.");
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
        body: JSON.stringify({ cliente_id: selectedThread.cliente_id, thread_id: selectedThread.id, amount, notes: `Ajuste manual chat (${amount > 0 ? "+" : ""}${amount})` }),
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
    <div className="tc-card">
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title">💬 Chat comercial</div>
          <div className="tc-sub">Controla tarotistas online, conversaciones activas, cobros por créditos y seguimiento manual desde un solo panel.</div>
        </div>
        <button className="tc-btn tc-btn-gold" onClick={() => loadOverview(true)} disabled={loading}>{loading ? "Cargando…" : "Refrescar"}</button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10 }}>
        <KpiCard title="Hilos totales" value={String(summary.total_threads || 0)} hint="Histórico visible" accent="rgba(181,156,255,.75)" />
        <KpiCard title="Chats abiertos" value={String(summary.open_threads || 0)} hint="Conversaciones activas" accent="rgba(59,130,246,.75)" />
        <KpiCard title="Pendientes de pago" value={String(summary.pending_payment || 0)} hint="Sin créditos tras la free" accent="rgba(245,158,11,.75)" />
        <KpiCard title="Tarotistas online" value={String(summary.tarotistas_online || 0)} hint="Visibles al cliente" accent="rgba(34,197,94,.75)" />
        <KpiCard title="Tarotistas ocupadas" value={String(summary.tarotistas_busy || 0)} hint="Con hilos en curso" accent="rgba(249,115,22,.75)" />
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>{msg || "La tarotista queda fija por hilo. Después de la consulta gratis, el cliente necesita créditos para seguir escribiendo."}</div>

      <div className="tc-hr" />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,420px) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="tc-title" style={{ fontSize: 15 }}>Tarotistas visibles en chat</div>
            {(tarotistas || []).map((worker: any) => (
              <div key={worker.id} className="tc-card" style={{ padding: 14, border: worker.status_border, background: worker.status_bg }}>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{worker.display_name}</div>
                    <div className="tc-sub">Equipo {worker.team || "—"} · {worker.open_threads || 0} chats abiertos</div>
                  </div>
                  <span className="tc-chip" style={chipStyle(worker.status_key)}>{worker.status_label}</span>
                </div>
                <div className="tc-row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-ok" onClick={() => setWorkerStatus(worker.id, { is_online: true, chat_enabled: true, is_busy: false })}>Libre</button>
                  <button className="tc-btn tc-btn-gold" onClick={() => setWorkerStatus(worker.id, { is_online: true, chat_enabled: true, is_busy: true })}>Ocupada</button>
                  <button className="tc-btn" onClick={() => setWorkerStatus(worker.id, { is_online: false, chat_enabled: false, is_busy: false })}>Desconectada</button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div className="tc-title" style={{ fontSize: 15 }}>Conversaciones</div>
            {(threads || []).map((thread: any) => {
              const active = String(thread.id) === String(selectedThreadId);
              return (
                <button key={thread.id} className="tc-card tc-click" onClick={() => setSelectedThreadId(String(thread.id))} style={{ textAlign: "left", padding: 14, border: active ? "1px solid rgba(181,156,255,.4)" : "1px solid rgba(255,255,255,.08)", background: active ? "rgba(181,156,255,.10)" : "rgba(255,255,255,.03)" }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{thread.cliente_nombre}</div>
                    <span className="tc-chip">{thread.creditos_cliente || 0} créditos</span>
                  </div>
                  <div className="tc-sub">{thread.cliente_telefono || "Sin teléfono"} · {thread.tarotista_display_name || "Tarotista"}</div>
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>{thread.last_message_preview || "Sin mensajes"}</div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>Último movimiento: {fmt(thread.last_message_at)}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tc-card" style={{ minHeight: 640, display: "grid", gridTemplateRows: "auto auto 1fr auto auto", gap: 12 }}>
          {!selectedThread ? (
            <div className="tc-sub">Selecciona una conversación.</div>
          ) : (
            <>
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 18 }}>{selectedThread.cliente_nombre}</div>
                  <div className="tc-sub">{selectedThread.cliente_telefono || "Sin teléfono"} · {selectedThread.cliente_email || "Sin email"} · {selectedThread.tarotista_display_name || "Tarotista"}</div>
                </div>
                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="tc-chip">Créditos: {selectedThread.creditos_cliente || 0}</span>
                  <span className="tc-chip">Free usada: {selectedThread.free_consulta_usada ? "Sí" : "No"}</span>
                </div>
              </div>

              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input className="tc-input" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} style={{ width: 120 }} />
                <button className="tc-btn tc-btn-ok" onClick={() => adjustCredits(Math.max(1, Math.trunc(Number(creditAmount) || 0)))}>+ créditos</button>
                <button className="tc-btn" onClick={() => adjustCredits(-Math.max(1, Math.trunc(Number(creditAmount) || 0)))}>- créditos</button>
                <select className="tc-select" value={paymentPack} onChange={(e) => setPaymentPack(e.target.value)}>
                  <option value="chat_pack_5">Pack 5 créditos</option>
                  <option value="chat_pack_12">Pack 12 créditos</option>
                  <option value="chat_pack_25">Pack 25 créditos</option>
                </select>
                <button className="tc-btn tc-btn-gold" onClick={sendPaymentLink}>Enviar enlace de pago</button>
              </div>

              <div style={{ minHeight: 320, maxHeight: 420, overflow: "auto", padding: 12, borderRadius: 16, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", display: "grid", gap: 10 }}>
                {selectedMessages.map((item: any) => {
                  const mine = item.sender_type !== "cliente";
                  return (
                    <div key={item.id} style={{ justifySelf: mine ? "end" : "start", maxWidth: "80%" }}>
                      <div className="tc-sub" style={{ marginBottom: 4 }}>{item.sender_display_name || item.sender_type}</div>
                      <div style={{ padding: "10px 12px", borderRadius: 14, background: mine ? "rgba(181,156,255,.16)" : "rgba(255,255,255,.08)", border: mine ? "1px solid rgba(181,156,255,.28)" : "1px solid rgba(255,255,255,.10)" }}>{item.body}</div>
                      <div className="tc-sub" style={{ marginTop: 4 }}>{fmt(item.created_at)}</div>
                    </div>
                  );
                })}
                {!selectedMessages.length && <div className="tc-sub">Sin mensajes todavía.</div>}
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <textarea className="tc-input" value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="Escribe la respuesta de la tarotista o del equipo admin…" style={{ width: "100%", minHeight: 110, resize: "vertical" }} />
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <div className="tc-sub">Puedes responder directamente desde admin y mantener la conversación centralizada.</div>
                  <button className="tc-btn tc-btn-purple" onClick={() => sendMessage("text")} disabled={sending}>{sending ? "Enviando…" : "Enviar respuesta"}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
