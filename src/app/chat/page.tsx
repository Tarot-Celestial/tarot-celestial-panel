
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ChevronLeft, Lock, Send, Sparkles, Wallet } from "lucide-react";

const sb = supabaseBrowser();

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function statusChip(worker: any) {
  if (worker?.status_key === "libre") {
    return {
      label: "Libre",
      dot: "#4ade80",
      style: {
        background: "rgba(34,197,94,.14)",
        border: "1px solid rgba(34,197,94,.34)",
        color: "#dcfce7",
      },
    };
  }
  if (worker?.status_key === "ocupada") {
    return {
      label: "Ocupada",
      dot: "#fb923c",
      style: {
        background: "rgba(249,115,22,.14)",
        border: "1px solid rgba(249,115,22,.34)",
        color: "#fed7aa",
      },
    };
  }
  return {
    label: "Desconectada",
    dot: "#94a3b8",
    style: {
      background: "rgba(148,163,184,.12)",
      border: "1px solid rgba(148,163,184,.24)",
      color: "#e2e8f0",
    },
  };
}

function initials(name?: string | null) {
  const text = String(name || "T").trim();
  return text
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "T";
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
  const [mobileView, setMobileView] = useState<"workers" | "chat">("workers");

  const summaryItems = useMemo(
    () => [
      {
        label: "Créditos chat",
        value: String(creditos),
        meta: "Cuando tu consulta gratuita ya se ha usado, cada nuevo mensaje del cliente consume 1 crédito",
      },
      {
        label: "Tarotistas visibles",
        value: String(tarotistas.length),
        meta: "Escoge una tarotista y mantén tu hilo con ella",
      },
      {
        label: "Consulta gratis",
        value: thread?.free_consulta_usada ? "Usada" : "Disponible",
        meta: thread?.free_consulta_usada
          ? "Tu primer intercambio ya fue consumido"
          : "Tu primer mensaje y la primera respuesta son gratis",
      },
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

    const res = await fetch("/api/cliente/chat/tarotistas", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
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
      const firstActive =
        (json.tarotistas || []).find((item: any) => item.status_key !== "desconectada") ||
        json.tarotistas?.[0];
      if (firstActive?.id) setSelectedWorkerId(String(firstActive.id));
    }

    setLoading(false);
  }, [selectedWorkerId]);

  const loadThread = useCallback(async () => {
    if (!selectedWorkerId) return;
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(
      `/api/cliente/chat/thread?worker_id=${encodeURIComponent(selectedWorkerId)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
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

  function openWorker(workerId: string) {
    setSelectedWorkerId(workerId);
    setMobileView("chat");
  }

  const locked = Boolean(thread?.free_consulta_usada) && creditos <= 0;

  return (
    <ClienteLayout
      title="Consultas por chat"
      eyebrow="Tarot Celestial · Chat"
      subtitle="Habla con una tarotista, aprovecha tu primera consulta gratis y continúa tu sesión con créditos cuando quieras profundizar."
      summaryItems={summaryItems}
    >
      <div className="chat-shell">
        {msg ? (
          <div className="tc-card" style={{ padding: 14 }}>
            <div className="tc-sub" style={{ fontSize: 13 }}>{msg}</div>
          </div>
        ) : null}

        <div className="chat-app">
          <section className={`chat-pane workers-pane ${mobileView === "chat" ? "mobile-hidden" : ""}`}>
            <div className="pane-header">
              <div>
                <div className="tc-title" style={{ fontSize: 20 }}>Tarotistas</div>
                <div className="tc-sub">
                  {cliente?.nombre
                    ? `${cliente.nombre}, elige con quién quieres continuar tu energía hoy.`
                    : "Elige tu tarotista."}
                </div>
              </div>
              <span className="tc-chip">{tarotistas.length} disponibles</span>
            </div>

            <div className="workers-list">
              {(tarotistas || []).map((worker: any) => {
                const active = String(worker.id) === String(selectedWorkerId);
                const chip = statusChip(worker);
                return (
                  <button
                    key={worker.id}
                    type="button"
                    onClick={() => openWorker(String(worker.id))}
                    className={`worker-card ${active ? "worker-card-active" : ""}`}
                    style={{
                      background: active
                        ? "linear-gradient(180deg, rgba(215,181,109,.14), rgba(255,255,255,.05))"
                        : "rgba(255,255,255,.03)",
                      border: active ? "1px solid rgba(215,181,109,.42)" : worker.status_border,
                    }}
                  >
                    <div className="worker-head">
                      <div className="worker-avatar-wrap">
                        <div className="worker-avatar">{initials(worker.display_name)}</div>
                        <span className="worker-dot" style={{ background: chip.dot }} />
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div className="worker-name">{worker.display_name}</div>
                        <div className="tc-sub">Equipo {worker.team || "—"}</div>
                      </div>

                      <span className="tc-chip" style={chip.style}>{chip.label}</span>
                    </div>

                    <div className="worker-copy">
                      {worker.welcome_message ||
                        "Consulta por amor, trabajo, energía o decisiones importantes. Tu hilo quedará fijo con esta tarotista."}
                    </div>

                    <div className="worker-meta">
                      <span className="tc-chip">
                        {worker.current_thread_id ? "Consulta en curso" : "Nueva consulta"}
                      </span>
                      <span className="tc-sub">
                        {worker.current_thread_last_message_at
                          ? `Último movimiento ${fmt(worker.current_thread_last_message_at)}`
                          : "Sin hilo previo"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={`chat-pane conversation-pane ${mobileView === "workers" ? "mobile-hidden-chat" : ""}`}>
            <div className="conversation-top">
              <div className="conversation-top-main">
                <button type="button" className="back-btn" onClick={() => setMobileView("workers")}>
                  <ChevronLeft size={16} />
                </button>

                <div className="worker-avatar hero-avatar">
                  {initials(activeTarotista?.display_name)}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div className="tc-title" style={{ fontSize: 22 }}>
                    {activeTarotista?.display_name || "Selecciona una tarotista"}
                  </div>
                  <div className="tc-sub">
                    {activeTarotista?.welcome_message || "Tu hilo será privado y quedará asociado a esta tarotista."}
                  </div>
                </div>
              </div>

              {activeTarotista ? (
                <span className="tc-chip" style={statusChip(activeTarotista).style}>
                  {statusChip(activeTarotista).label}
                </span>
              ) : null}
            </div>

            <div className="conversation-stats">
              <div className="stat-box">
                <div className="tc-sub">Créditos disponibles</div>
                <div className="tc-title" style={{ fontSize: 22 }}>{creditos}</div>
              </div>
              <div className="stat-box">
                <div className="tc-sub">Consulta gratuita</div>
                <div className="tc-title" style={{ fontSize: 22 }}>
                  {thread?.free_consulta_usada ? "Usada" : "Activa"}
                </div>
              </div>
              <div className="stat-box">
                <div className="tc-sub">Hilo</div>
                <div className="tc-title" style={{ fontSize: 22 }}>{thread?.id ? "Abierto" : "Nuevo"}</div>
              </div>
            </div>

            <div className="messages-panel">
              {messages.map((m: any) => {
                const mine = m.sender_type === "cliente";
                return (
                  <div
                    key={m.id}
                    className={`bubble-row ${mine ? "bubble-row-mine" : ""}`}
                  >
                    {!mine ? <div className="worker-avatar bubble-avatar">{initials(activeTarotista?.display_name)}</div> : null}
                    <div className={`bubble-wrap ${mine ? "bubble-wrap-mine" : ""}`}>
                      <div className="tc-sub">
                        {m.sender_display_name || (mine ? "Tú" : activeTarotista?.display_name || "Tarotista")}
                      </div>
                      <div
                        className={`chat-bubble ${mine ? "chat-bubble-mine" : "chat-bubble-worker"}`}
                      >
                        {m.body}
                      </div>
                      <div className="tc-sub">{fmt(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}

              {!messages.length ? (
                <div className="empty-chat">
                  <div className="worker-avatar hero-avatar" style={{ width: 56, height: 56, fontSize: 18 }}>
                    {initials(activeTarotista?.display_name)}
                  </div>
                  <div className="tc-title">Empieza tu consulta</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Escribe una primera pregunta clara. Tu primer intercambio es gratis y después podrás seguir con créditos.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="composer-panel">
              {locked ? (
                <div className="locked-banner">
                  <div style={{ display: "grid", gap: 4 }}>
                    <div className="tc-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Lock size={16} /> Activa tu sesión para continuar
                    </div>
                    <div className="tc-sub">
                      Ya has usado tu consulta gratis. Pide el enlace de pago para seguir con esta tarotista.
                    </div>
                  </div>
                  <span className="tc-chip">
                    <Wallet size={13} style={{ marginRight: 6 }} /> 0 créditos
                  </span>
                </div>
              ) : null}

              <textarea
                className="tc-textarea"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={locked ? "Necesitas créditos para seguir escribiendo" : "Escribe aquí tu pregunta o continúa tu consulta…"}
                disabled={locked || !activeTarotista}
                style={{ minHeight: 110, resize: "vertical", opacity: locked ? 0.72 : 1 }}
              />

              <div className="composer-footer">
                <div className="tc-sub" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Sparkles size={14} /> Tu tarotista responderá dentro del mismo hilo.
                </div>
                <button className="tc-btn tc-btn-purple" onClick={sendMessage} disabled={sending || locked || !activeTarotista}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Send size={14} /> {sending ? "Enviando…" : "Enviar mensaje"}
                  </span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style jsx>{`
        .chat-shell {
          display: grid;
          gap: 18px;
        }
        .chat-app {
          display: grid;
          grid-template-columns: 360px minmax(0, 1fr);
          gap: 18px;
          align-items: stretch;
          min-height: 760px;
        }
        .chat-pane {
          border-radius: 24px;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(7, 11, 24, 0.72);
          backdrop-filter: blur(10px);
          box-shadow: 0 18px 60px rgba(0,0,0,.28);
          overflow: hidden;
        }
        .workers-pane {
          display: grid;
          grid-template-rows: auto 1fr;
        }
        .conversation-pane {
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          min-height: 760px;
        }
        .pane-header,
        .conversation-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 18px 18px 14px;
          border-bottom: 1px solid rgba(255,255,255,.06);
          background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01));
        }
        .conversation-top-main {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .workers-list {
          display: grid;
          gap: 12px;
          padding: 16px;
          overflow: auto;
        }
        .worker-card {
          text-align: left;
          display: grid;
          gap: 12px;
          padding: 14px;
          border-radius: 20px;
          transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
          cursor: pointer;
        }
        .worker-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 18px 40px rgba(0,0,0,.18);
        }
        .worker-head,
        .worker-meta,
        .composer-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .worker-copy {
          font-size: 13px;
          line-height: 1.55;
          color: rgba(255,255,255,.82);
        }
        .worker-avatar-wrap {
          position: relative;
          flex: 0 0 auto;
        }
        .worker-avatar {
          width: 48px;
          height: 48px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-weight: 900;
          color: #fff7ed;
          background: radial-gradient(circle at top, rgba(215,181,109,.88), rgba(107,33,168,.9));
          box-shadow: 0 12px 30px rgba(107,33,168,.28);
        }
        .hero-avatar {
          width: 56px;
          height: 56px;
          font-size: 18px;
        }
        .bubble-avatar {
          width: 34px;
          height: 34px;
          font-size: 12px;
          margin-top: 18px;
        }
        .worker-dot {
          position: absolute;
          right: -2px;
          bottom: -1px;
          width: 14px;
          height: 14px;
          border-radius: 999px;
          border: 2px solid rgba(10,14,24,1);
        }
        .worker-name {
          font-weight: 900;
          font-size: 16px;
        }
        .conversation-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0,1fr));
          gap: 10px;
          padding: 14px 18px;
          border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .stat-box {
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.04);
          padding: 12px;
        }
        .messages-panel {
          min-height: 380px;
          max-height: 100%;
          overflow: auto;
          padding: 18px;
          display: grid;
          gap: 12px;
          align-content: start;
          background:
            radial-gradient(circle at top right, rgba(139,92,246,.08), transparent 28%),
            linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
        }
        .bubble-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          max-width: 100%;
        }
        .bubble-row-mine {
          justify-content: flex-end;
        }
        .bubble-wrap {
          max-width: min(82%, 620px);
          display: grid;
          gap: 4px;
        }
        .bubble-wrap-mine {
          justify-items: end;
        }
        .chat-bubble {
          border-radius: 20px;
          padding: 12px 14px;
          line-height: 1.55;
          white-space: pre-wrap;
          box-shadow: 0 12px 30px rgba(0,0,0,.12);
        }
        .chat-bubble-mine {
          background: rgba(215,181,109,.14);
          border: 1px solid rgba(215,181,109,.26);
        }
        .chat-bubble-worker {
          background: rgba(139,92,246,.14);
          border: 1px solid rgba(139,92,246,.28);
        }
        .empty-chat {
          padding: 26px;
          border-radius: 24px;
          border: 1px dashed rgba(255,255,255,.12);
          background: rgba(255,255,255,.03);
          display: grid;
          justify-items: center;
          text-align: center;
        }
        .composer-panel {
          display: grid;
          gap: 10px;
          padding: 16px 18px 18px;
          border-top: 1px solid rgba(255,255,255,.06);
          background: rgba(10,14,24,.92);
        }
        .locked-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 14px;
          border-radius: 18px;
          background: rgba(215,181,109,.10);
          border: 1px solid rgba(215,181,109,.24);
        }
        .back-btn {
          display: none;
          width: 36px;
          height: 36px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.04);
          color: inherit;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }
        @media (max-width: 980px) {
          .chat-app {
            grid-template-columns: 1fr;
            min-height: auto;
          }
          .chat-pane {
            min-height: calc(100vh - 220px);
          }
          .mobile-hidden {
            display: none;
          }
          .mobile-hidden-chat {
            display: grid;
          }
          .back-btn {
            display: inline-flex;
          }
          .conversation-stats {
            grid-template-columns: repeat(3, minmax(0,1fr));
          }
          .worker-meta,
          .composer-footer,
          .locked-banner,
          .pane-header,
          .conversation-top {
            flex-wrap: wrap;
          }
          .bubble-wrap {
            max-width: 88%;
          }
        }
        @media (min-width: 981px) {
          .mobile-hidden-chat {
            display: grid;
          }
        }
        @media (max-width: 640px) {
          .chat-shell {
            margin-left: -6px;
            margin-right: -6px;
          }
          .chat-pane {
            border-radius: 22px;
          }
          .conversation-stats {
            grid-template-columns: 1fr;
          }
          .messages-panel {
            padding: 14px;
          }
          .composer-panel {
            padding: 14px;
          }
          .worker-card,
          .stat-box {
            border-radius: 18px;
          }
          .bubble-wrap {
            max-width: 92%;
          }
        }
      `}</style>
    </ClienteLayout>
  );
}
