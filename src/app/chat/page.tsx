"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Lock, Send, Sparkles, Wallet } from "lucide-react";

const sb = supabaseBrowser();

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function statusChip(worker: any) {
  if (worker?.status_key === "libre") return { label: "🟢 Libre", style: { background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.34)", color: "#dcfce7" } };
  if (worker?.status_key === "ocupada") return { label: "🟠 Ocupada", style: { background: "rgba(249,115,22,.14)", border: "1px solid rgba(249,115,22,.34)", color: "#fed7aa" } };
  return { label: "⚫ Desconectada", style: { background: "rgba(148,163,184,.12)", border: "1px solid rgba(148,163,184,.24)", color: "#e2e8f0" } };
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

  const summaryItems = useMemo(
    () => [
      { label: "Créditos chat", value: String(creditos), meta: "Cuando tu consulta gratuita ya se ha usado, cada nuevo mensaje del cliente consume 1 crédito" },
      { label: "Tarotistas visibles", value: String(tarotistas.length), meta: "Escoge una tarotista y mantén tu hilo con ella" },
      { label: "Consulta gratis", value: thread?.free_consulta_usada ? "Usada" : "Disponible", meta: thread?.free_consulta_usada ? "Tu primer intercambio ya fue consumido" : "Tu primer mensaje y la primera respuesta son gratis" },
    ],
    [creditos, tarotistas.length, thread?.free_consulta_usada]
  );

  const activeTarotista = useMemo(
    () => tarotistas.find((item: any) => String(item.id) === String(selectedWorkerId)) || null,
    [tarotistas, selectedWorkerId]
  );

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
      const firstActive = (json.tarotistas || []).find((item: any) => item.status_key !== "desconectada") || json.tarotistas?.[0];
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
      window.history.replaceState({}, "", "/chat");
      window.setTimeout(() => {
        loadTarotistas();
        loadThread();
      }, 1200);
    }

    if (params.get("checkout") === "cancelled") {
      setMsg("Has cancelado el pago del chat. Puedes volver a intentarlo cuando quieras.");
      window.history.replaceState({}, "", "/chat");
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
        setMsg("Tu consulta gratis ya se ha usado. Pide el enlace de pago para seguir la sesión o espera a que te carguen créditos.");
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

  const locked = Boolean(thread?.free_consulta_usada) && creditos <= 0;

  return (
    <ClienteLayout
      title="Consultas por chat"
      eyebrow="Tarot Celestial · Chat"
      subtitle="Habla con una tarotista, aprovecha tu primera consulta gratis y continúa tu sesión con créditos cuando quieras profundizar."
      summaryItems={summaryItems}
    >
      <div style={{ display: "grid", gap: 18 }}>
        {msg ? (
          <div className="tc-card" style={{ padding: 14 }}>
            <div className="tc-sub" style={{ fontSize: 13 }}>{msg}</div>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "360px minmax(0,1fr)", gap: 18, alignItems: "start" }}>
          <section className="tc-card" style={{ display: "grid", gap: 14 }}>
            <div>
              <div className="tc-title" style={{ fontSize: 20 }}>Tarotistas disponibles</div>
              <div className="tc-sub">{cliente?.nombre ? `${cliente.nombre}, elige con quién quieres continuar tu energía hoy.` : "Elige tu tarotista."}</div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {(tarotistas || []).map((worker: any) => {
                const active = String(worker.id) === String(selectedWorkerId);
                const chip = statusChip(worker);
                return (
                  <button
                    key={worker.id}
                    onClick={() => setSelectedWorkerId(String(worker.id))}
                    className="tc-card"
                    style={{
                      textAlign: "left",
                      padding: 14,
                      display: "grid",
                      gap: 10,
                      border: active ? "1px solid rgba(215,181,109,.42)" : worker.status_border,
                      background: active ? "linear-gradient(180deg, rgba(215,181,109,.14), rgba(255,255,255,.05))" : worker.status_bg,
                    }}
                  >
                    <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{worker.display_name}</div>
                        <div className="tc-sub">Equipo {worker.team || "—"}</div>
                      </div>
                      <span className="tc-chip" style={chip.style}>{chip.label}</span>
                    </div>

                    <div className="tc-sub" style={{ fontSize: 13, lineHeight: 1.5 }}>
                      {worker.welcome_message || "Consulta por amor, trabajo, energía o decisiones importantes. Tu hilo quedará fijo con esta tarotista."}
                    </div>

                    <div className="tc-row" style={{ justifyContent: "space-between" }}>
                      <span className="tc-chip">{worker.creditos_restantes || creditos} créditos visibles</span>
                      <span className="tc-sub">{worker.current_thread_last_message_at ? `Último movimiento ${fmt(worker.current_thread_last_message_at)}` : "Sin hilo previo"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="tc-card" style={{ minHeight: 760, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 14 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 22 }}>{activeTarotista?.display_name || "Selecciona una tarotista"}</div>
                  <div className="tc-sub">{activeTarotista?.welcome_message || "Tu hilo será privado y quedará asociado a esta tarotista."}</div>
                </div>
                {activeTarotista ? <span className="tc-chip" style={statusChip(activeTarotista).style}>{statusChip(activeTarotista).label}</span> : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
                <div className="tc-card" style={{ padding: 12 }}>
                  <div className="tc-sub">Créditos disponibles</div>
                  <div className="tc-title" style={{ fontSize: 20 }}>{creditos}</div>
                </div>
                <div className="tc-card" style={{ padding: 12 }}>
                  <div className="tc-sub">Consulta gratuita</div>
                  <div className="tc-title" style={{ fontSize: 20 }}>{thread?.free_consulta_usada ? "Usada" : "Activa"}</div>
                </div>
                <div className="tc-card" style={{ padding: 12 }}>
                  <div className="tc-sub">Hilo</div>
                  <div className="tc-title" style={{ fontSize: 20 }}>{thread?.id ? "Abierto" : "Nuevo"}</div>
                </div>
              </div>
            </div>

            <div style={{ minHeight: 380, maxHeight: 500, overflow: "auto", padding: 14, borderRadius: 18, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", display: "grid", gap: 12, alignContent: "start" }}>
              {messages.map((m: any) => {
                const mine = m.sender_type === "cliente";
                return (
                  <div key={m.id} style={{ justifySelf: mine ? "end" : "start", maxWidth: "82%", display: "grid", gap: 4 }}>
                    <div className="tc-sub">{m.sender_display_name || (mine ? "Tú" : "Tarotista")}</div>
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: 18,
                        background: mine ? "rgba(215,181,109,.15)" : "rgba(139,92,246,.14)",
                        border: mine ? "1px solid rgba(215,181,109,.26)" : "1px solid rgba(139,92,246,.28)",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.body}
                    </div>
                    <div className="tc-sub">{fmt(m.created_at)}</div>
                  </div>
                );
              })}

              {!messages.length ? (
                <div className="tc-card" style={{ padding: 16, background: "rgba(255,255,255,.04)" }}>
                  <div className="tc-title">Empieza tu consulta</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Escribe una primera pregunta clara. Tu primer intercambio es gratis y después podrás seguir con créditos.
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {locked ? (
                <div className="tc-card" style={{ padding: 14, background: "rgba(215,181,109,.10)", border: "1px solid rgba(215,181,109,.24)" }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div className="tc-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Lock size={16} /> Activa tu sesión para continuar</div>
                      <div className="tc-sub">Ya has usado tu consulta gratis. Pide el enlace de pago para seguir con esta tarotista.</div>
                    </div>
                    <span className="tc-chip"><Wallet size={13} style={{ marginRight: 6 }} /> 0 créditos</span>
                  </div>
                </div>
              ) : null}

              <textarea
                className="tc-textarea"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={locked ? "Necesitas créditos para seguir escribiendo" : "Escribe aquí tu pregunta o continúa tu consulta…"}
                disabled={locked || !activeTarotista}
                style={{ minHeight: 110, resize: "vertical", opacity: locked ? 0.7 : 1 }}
              />

              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                <div className="tc-sub" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Sparkles size={14} /> Tu tarotista responderá dentro del mismo hilo.
                </div>
                <button className="tc-btn tc-btn-purple" onClick={sendMessage} disabled={sending || locked || !activeTarotista}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Send size={14} /> {sending ? "Enviando…" : "Enviar mensaje"}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </ClienteLayout>
  );
}
