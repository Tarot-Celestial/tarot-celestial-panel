"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import ClienteLayout from "@/components/cliente/ClienteLayout";

const sb = supabaseBrowser();

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function ClienteChatPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [cliente, setCliente] = useState<any>(null);
  const [creditos, setCreditos] = useState(0);
  const [tarotistas, setTarotistas] = useState<any[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [thread, setThread] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);

  const summaryItems = useMemo(() => [
    { label: "Créditos chat", value: String(creditos), meta: "Después de la primera consulta gratis, cada nuevo mensaje del cliente consume 1 crédito" },
    { label: "Tarotistas visibles", value: String(tarotistas.length), meta: "Pulsa en una tarotista para abrir o continuar tu hilo" },
    { label: "Consulta gratis", value: thread?.free_consulta_usada ? "Usada" : "Disponible", meta: thread?.free_consulta_usada ? "Ya has consumido la consulta inicial de este hilo" : "Tu primer mensaje y la primera respuesta son gratis" },
  ], [creditos, tarotistas.length, thread?.free_consulta_usada]);

  const loadTarotistas = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      return;
    }

    const res = await fetch("/api/cliente/chat/tarotistas", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo cargar el panel de chat.");
      setLoading(false);
      return;
    }
    setCliente(json.cliente || null);
    setCreditos(Number(json.creditos_disponibles || 0));
    setTarotistas(Array.isArray(json.tarotistas) ? json.tarotistas : []);
    if (!selectedWorkerId) {
      const firstActive = (json.tarotistas || []).find((item: any) => item.status_key !== "desconectada");
      if (firstActive?.id) setSelectedWorkerId(String(firstActive.id));
    }
    setLoading(false);
  }, [selectedWorkerId]);

  const loadThread = useCallback(async () => {
    if (!selectedWorkerId) return;
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(`/api/cliente/chat/thread?worker_id=${encodeURIComponent(selectedWorkerId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo abrir el chat.");
      return;
    }
    setThread(json.thread || null);
    setMessages(Array.isArray(json.messages) ? json.messages : []);
    setCreditos(Number(json.creditos_disponibles || 0));
  }, [selectedWorkerId]);

  useEffect(() => {
    loadTarotistas();
  }, [loadTarotistas]);

  useEffect(() => {
    if (!selectedWorkerId) return;
    loadThread();
    const id = window.setInterval(() => loadThread(), 5000);
    return () => window.clearInterval(id);
  }, [selectedWorkerId, loadThread]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "ok") {
      setMsg("✅ Pago completado. Tus créditos de chat se actualizarán en unos segundos.");
      window.history.replaceState({}, "", "/cliente/chat");
      window.setTimeout(() => { loadTarotistas(); loadThread(); }, 1200);
    }
    if (params.get("checkout") === "cancelled") {
      setMsg("Has cancelado el pago del chat. Puedes volver a intentarlo cuando quieras.");
      window.history.replaceState({}, "", "/cliente/chat");
    }
  }, [loadTarotistas, loadThread]);

  async function sendMessage() {
    const text = composer.trim();
    if (!text || !selectedWorkerId) return;
    try {
      setSending(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/cliente/chat/thread", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: selectedWorkerId, thread_id: thread?.id || null, body: text }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 402 || json?.need_payment) {
        setMsg("Ya has usado la consulta gratis. Pide a la tarotista que te envíe un enlace de pago o espera a que admin te cargue créditos.");
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo enviar el mensaje");
      setComposer("");
      await loadThread();
      await loadTarotistas();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSending(false);
    }
  }

  const activeTarotista = tarotistas.find((item: any) => String(item.id) === String(selectedWorkerId)) || null;

  return (
    <ClienteLayout
  title="Consultas por chat"
  eyebrow="Tarot Celestial · Chat"
  subtitle="Elige una tarotista disponible, envía tu primera consulta gratis y continúa la conversación con créditos cuando quieras profundizar."
  summaryItems={summaryItems}
>
      <div className="tc-grid" style={{ display: "grid", gap: 18 }}>
        {msg ? <div className="tc-card"><div className="tc-sub">{msg}</div></div> : null}

        <section className="tc-card">
          <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="tc-title">Tarotistas disponibles</div>
              <div className="tc-sub">Verde = libre · naranja = ocupada · gris = desconectada.</div>
            </div>
            <div className="tc-chip">Cliente: {cliente?.nombre || "—"}</div>
          </div>

          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            {(tarotistas || []).map((worker: any) => {
              const active = String(worker.id) === String(selectedWorkerId);
              const disabled = worker.status_key === "desconectada";
              return (
                <button
                  key={worker.id}
                  className="tc-card tc-click"
                  onClick={() => !disabled && setSelectedWorkerId(String(worker.id))}
                  style={{
                    textAlign: "left",
                    padding: 16,
                    opacity: disabled ? 0.7 : 1,
                    border: active ? worker.status_border : "1px solid rgba(255,255,255,.08)",
                    background: active ? worker.status_bg : "rgba(255,255,255,.03)",
                  }}
                >
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 800 }}>{worker.display_name}</div>
                    <span className="tc-chip" style={{ background: worker.status_bg, border: worker.status_border, color: worker.status_color }}>{worker.status_label}</span>
                  </div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>Equipo {worker.team || "—"}</div>
                  <div className="tc-sub" style={{ marginTop: 8 }}>{worker.welcome_message || "Pulsa para abrir tu hilo privado con esta tarotista."}</div>
                  <div style={{ marginTop: 12, fontWeight: 700 }}>{disabled ? "No disponible ahora" : worker.current_thread_id ? "Continuar chat" : "Entrar al chat"}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="tc-card" style={{ minHeight: 520, display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 14 }}>
          <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="tc-title">{activeTarotista?.display_name || "Selecciona una tarotista"}</div>
              <div className="tc-sub">{activeTarotista?.status_label || "Sin estado"} · Último mensaje {fmt(thread?.last_message_at)}</div>
            </div>
            <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="tc-chip">Créditos: {creditos}</span>
              <span className="tc-chip">Consulta gratis: {thread?.free_consulta_usada ? "usada" : "disponible"}</span>
            </div>
          </div>

          <div className="tc-sub">Primer flujo recomendado: escribe una sola consulta clara. La primera respuesta es gratis. Después la tarotista o admin te pasará un enlace de pago para seguir.</div>

          <div style={{ minHeight: 260, maxHeight: 420, overflow: "auto", display: "grid", gap: 10, padding: 12, borderRadius: 18, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
            {loading ? <div className="tc-sub">Cargando chat…</div> : null}
            {!loading && messages.map((item: any) => {
              const mine = item.sender_type === "cliente";
              return (
                <div key={item.id} style={{ justifySelf: mine ? "end" : "start", maxWidth: "80%" }}>
                  <div className="tc-sub" style={{ marginBottom: 4 }}>{item.sender_display_name || item.sender_type}</div>
                  <div style={{ padding: "10px 12px", borderRadius: 14, background: mine ? "rgba(181,156,255,.14)" : "rgba(255,255,255,.08)", border: mine ? "1px solid rgba(181,156,255,.28)" : "1px solid rgba(255,255,255,.10)" }}>{item.body}</div>
                  <div className="tc-sub" style={{ marginTop: 4 }}>{fmt(item.created_at)}</div>
                </div>
              );
            })}
            {!loading && !messages.length ? <div className="tc-sub">Todavía no hay mensajes. Abre una tarotista y escribe tu primera consulta gratis.</div> : null}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <textarea className="tc-input" value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="Escribe aquí tu consulta…" style={{ width: "100%", minHeight: 110, resize: "vertical" }} />
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="tc-sub">Consejo: sé directa en tu primera pregunta para aprovechar mejor la respuesta gratis.</div>
              <button className="tc-btn tc-btn-purple" onClick={sendMessage} disabled={sending || !selectedWorkerId || activeTarotista?.status_key === "desconectada"}>{sending ? "Enviando…" : "Enviar consulta"}</button>
            </div>
          </div>
        </section>
      </div>
  );
}
