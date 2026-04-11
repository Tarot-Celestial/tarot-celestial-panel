"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, LogOut, Lock, Send, Sparkles, Wallet, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

const COUNTRY_OPTIONS = [
  "España",
  "Puerto Rico",
  "Estados Unidos",
  "México",
  "Argentina",
  "Colombia",
  "Chile",
  "Perú",
  "República Dominicana",
  "Venezuela",
];

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function statusChip(worker: any) {
  if (worker?.status_key === "libre") {
    return { label: "Libre", dot: "#4ade80", soft: "rgba(34,197,94,.14)" };
  }
  if (worker?.status_key === "ocupada") {
    return { label: "Ocupada", dot: "#fb923c", soft: "rgba(249,115,22,.14)" };
  }
  if (worker?.status_key === "desconectada") {
    return { label: "Desconectada", dot: "#94a3b8", soft: "rgba(148,163,184,.16)" };
  }
  return { label: "Vuelvo en 5 min", dot: "#c084fc", soft: "rgba(168,85,247,.16)" };
}

function initials(name?: string | null) {
  const text = String(name || "T").trim();
  return (
    text
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "T"
  );
}

function isOnboardingComplete(cliente: any) {
  return Boolean(
    cliente?.onboarding_completado &&
      cliente?.nombre &&
      cliente?.telefono &&
      cliente?.email &&
      cliente?.pais &&
      cliente?.fecha_nacimiento
  );
}

export default function ChatPage() {
  const [booting, setBooting] = useState(true);
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
  const [showWelcome, setShowWelcome] = useState(false);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [welcomeForm, setWelcomeForm] = useState({
    nombre: "",
    telefono: "",
    email: "",
    pais: COUNTRY_OPTIONS[0],
    fecha_nacimiento: "",
  });

  // mejoras pro
  const [confirmWorker, setConfirmWorker] = useState<any>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const prevMessageCountRef = useRef(0);

  const activeTarotista = useMemo(
    () => tarotistas.find((item: any) => String(item.id) === String(selectedWorkerId)) || null,
    [tarotistas, selectedWorkerId]
  );

  // solo últimos 5 mensajes para no hacer la experiencia pesada
  const visibleMessages = useMemo(() => {
    return (messages || []).slice(-5);
  }, [messages]);

  const summaryItems = useMemo(
    () => [
      { label: "Créditos", value: String(creditos) },
      { label: "Tarotistas", value: String(tarotistas.length) },
      {
        label: "Gratis",
        value: thread?.free_consulta_usada ? "Usada" : "Disponible",
      },
    ],
    [creditos, tarotistas.length, thread?.free_consulta_usada]
  );

  const locked = Boolean(thread?.free_consulta_usada) && creditos <= 0;

  const loadTarotistas = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/chat/login";
      return;
    }

    const res = await fetch("/api/cliente/chat/tarotistas", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo cargar el chat.");
      setBooting(false);
      return;
    }

    const nextCliente = json.cliente || null;
    setCliente(nextCliente);
    setWelcomeForm({
      nombre: nextCliente?.nombre || "",
      telefono: nextCliente?.telefono || "",
      email: nextCliente?.email || data.session?.user?.email || "",
      pais: nextCliente?.pais || COUNTRY_OPTIONS[0],
      fecha_nacimiento: nextCliente?.fecha_nacimiento || "",
    });
    setShowWelcome(!isOnboardingComplete(nextCliente));
    setCreditos(Number(json.creditos_disponibles || 0));

    const nextTarotistas = Array.isArray(json.tarotistas) ? json.tarotistas : [];
    setTarotistas(nextTarotistas);

    // preselecciona una, pero NO entra directo al chat
    if (!selectedWorkerId && nextTarotistas[0]?.id) {
      setSelectedWorkerId(String(nextTarotistas[0].id));
    }

    if (
      selectedWorkerId &&
      !nextTarotistas.some((item: any) => String(item.id) === String(selectedWorkerId))
    ) {
      setSelectedWorkerId(String(nextTarotistas[0]?.id || ""));
      setThread(null);
      setMessages([]);
      setMobileView("workers");
    }

    setBooting(false);
  }, [selectedWorkerId]);

  const loadThread = useCallback(async () => {
    if (!selectedWorkerId) {
      setThread(null);
      setMessages([]);
      prevMessageCountRef.current = 0;
      return;
    }

    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(
      `/api/cliente/chat/thread?worker_id=${encodeURIComponent(selectedWorkerId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo abrir el chat.");
      return;
    }

    const nextMessages = Array.isArray(json.messages) ? json.messages : [];
    const hadMessagesBefore = prevMessageCountRef.current;
    const hasNewWorkerMessage =
      nextMessages.length > hadMessagesBefore &&
      nextMessages[nextMessages.length - 1]?.sender_type !== "cliente";

    setThread(json.thread || null);
    setCreditos(Number(json.creditos_disponibles || 0));

    if (hasNewWorkerMessage) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      setIsTyping(true);
      typingTimeoutRef.current = setTimeout(() => {
        setMessages(nextMessages);
        setIsTyping(false);
        prevMessageCountRef.current = nextMessages.length;
      }, 900);
      return;
    }

    setMessages(nextMessages);
    prevMessageCountRef.current = nextMessages.length;
  }, [selectedWorkerId]);

  useEffect(() => {
    loadTarotistas();
  }, [loadTarotistas]);

  useEffect(() => {
    if (!selectedWorkerId || mobileView !== "chat") return;

    loadThread();
    const id = window.setInterval(() => {
      loadThread();
      loadTarotistas();
    }, 7000);

    return () => window.clearInterval(id);
  }, [selectedWorkerId, mobileView, loadThread, loadTarotistas]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom || autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages, isTyping, autoScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setAutoScroll(nearBottom);
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "ok") {
      setMsg("✅ Pago completado. Tus créditos del chat se están actualizando.");
      window.history.replaceState({}, "", "/chat");
      window.setTimeout(() => {
        loadTarotistas();
        loadThread();
      }, 800);
    }
    if (params.get("checkout") === "cancelled") {
      setMsg("Has cancelado el pago del chat.");
      window.history.replaceState({}, "", "/chat");
    }
  }, [loadTarotistas, loadThread]);

  function openWorker(worker: any) {
    setConfirmWorker(worker);
  }

  function confirmEnterChat() {
    if (!confirmWorker?.id) return;

    setSelectedWorkerId(String(confirmWorker.id));
    setThread(null);
    setMessages([]);
    prevMessageCountRef.current = 0;
    setMobileView("chat");
    setConfirmWorker(null);
  }

  async function saveWelcome() {
    if (
      !welcomeForm.nombre.trim() ||
      !welcomeForm.telefono.trim() ||
      !welcomeForm.email.trim() ||
      !welcomeForm.pais.trim() ||
      !welcomeForm.fecha_nacimiento.trim()
    ) {
      setMsg("Completa nombre, teléfono, e-mail, país y fecha de nacimiento para entrar al chat.");
      return;
    }

    try {
      setSavingWelcome(true);
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/cliente/perfil", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...welcomeForm, onboarding_completado: true }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "No se pudo guardar tu bienvenida.");
      }

      setCliente(json.cliente || null);
      setShowWelcome(false);
      setMsg("✨ Bienvenida completa. Ya puedes iniciar tu consulta.");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSavingWelcome(false);
    }
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/chat/login";
  }

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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          worker_id: selectedWorkerId,
          thread_id: thread?.id || null,
          body: text,
        }),
      });
      const json = await res.json().catch(() => null);

      if (res.status === 402 || json?.need_payment) {
        setMsg("Tu consulta gratis ya se ha usado. Necesitas créditos para seguir escribiendo.");
        return;
      }

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "No se pudo enviar el mensaje.");
      }

      setComposer("");
      setAutoScroll(true);
      await loadThread();
      await loadTarotistas();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSending(false);
    }
  }

  if (booting) {
    return <div className="chat-loading">Cargando tu espacio de chat…</div>;
  }

  return (
    <div className="chat-page-shell">
      <div className="chat-topbar">
        <div className="brand-block">
          <div className="brand-logo">
            <Image
              src="/Nuevo-logo-tarot.png"
              alt="Tarot Celestial"
              width={52}
              height={52}
              priority
            />
          </div>
          <div>
            <div className="brand-over">Tarot Celestial · Chat Privado</div>
            <div className="brand-title">Consulta por chat con una experiencia premium</div>
          </div>
        </div>

        <div className="topbar-actions">
          {summaryItems.map((item) => (
            <div key={item.label} className="summary-pill">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
          <button className="logout-btn" onClick={logout}>
            <LogOut size={15} /> Salir
          </button>
        </div>
      </div>

      {msg ? <div className="flash-box">{msg}</div> : null}

      <div className="chat-layout">
        <section className={`workers-panel ${mobileView === "chat" ? "mobile-hide" : ""}`}>
          <div className="panel-head">
            <div>
              <div className="panel-title">Tarotistas disponibles</div>
              <div className="panel-sub">
                Elige tu tarotista y entra en una consulta privada, cómoda y enfocada.
              </div>
            </div>
            <span className="count-chip">{tarotistas.length}</span>
          </div>

          <div className="workers-grid">
            {tarotistas.length ? (
              tarotistas.map((worker: any) => {
                const chip = statusChip(worker);
                const active = String(worker.id) === String(selectedWorkerId);

                return (
                  <button
                    key={worker.id}
                    type="button"
                    className={`worker-card ${active ? "worker-card-active" : ""}`}
                    onClick={() => openWorker(worker)}
                  >
                    <div className="worker-card-head">
                      <div className="worker-avatar">{initials(worker.display_name)}</div>
                      <div
                        className="worker-status-pill"
                        style={{ color: chip.dot, background: chip.soft }}
                      >
                        <span
                          className="worker-status-dot"
                          style={{ background: chip.dot }}
                        />
                        {chip.label}
                      </div>
                    </div>

                    <div className="worker-name">{worker.display_name}</div>
                    <div className="worker-team">Equipo {worker.team || "Tarot Celestial"}</div>

                    <div className="worker-copy">
                      {worker.welcome_message ||
                        "Consulta amor, trabajo, bloqueos, energía y decisiones importantes."}
                    </div>

                    <div className="worker-footer">
                      <span className="worker-mini-text">
                        {worker.current_thread_last_message_preview || "Sesión disponible ahora"}
                      </span>
                      <span className="worker-open">Abrir chat</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="empty-box">
                <div className="empty-chat-title">No vemos tarotistas activas</div>
                <div className="panel-sub">
                  Revisa el estado en admin o espera unos segundos para que el estado de conexión se refresque.
                </div>
              </div>
            )}
          </div>
        </section>

        <section className={`conversation-panel ${mobileView === "workers" ? "mobile-hide-chat" : ""}`}>
          <div className="panel-head conversation-head">
            <div className="conversation-ident">
              <button className="back-btn" onClick={() => setMobileView("workers")}>
                <ChevronLeft size={16} />
              </button>

              <div className="hero-avatar">
                {initials(activeTarotista?.display_name || thread?.tarotista_display_name)}
              </div>

              <div className="conversation-title-wrap">
                <div className="panel-title">
                  {activeTarotista?.display_name || thread?.tarotista_display_name || "Elige una tarotista"}
                </div>
                <div className="panel-sub">
                  {activeTarotista?.welcome_message ||
                    thread?.tarotista_welcome_message ||
                    "Tu espacio de consulta se abre limpio y privado en cada sesión."}
                </div>
              </div>
            </div>

            {activeTarotista ? (
              <span className="status-badge" style={{ color: statusChip(activeTarotista).dot }}>
                {statusChip(activeTarotista).label}
              </span>
            ) : null}
          </div>

          <div className="messages-surface" ref={scrollRef}>
            {!activeTarotista ? (
              <div className="empty-chat-box">
                <div className="empty-chat-title">Selecciona una tarotista</div>
                <div className="panel-sub">
                  Al abrir el chat verás los últimos mensajes recientes con esa tarotista.
                </div>
              </div>
            ) : !visibleMessages.length ? (
              <div className="empty-chat-box">
                <div className="hero-avatar hero-avatar-large">
                  {initials(activeTarotista?.display_name || thread?.tarotista_display_name)}
                </div>
                <div className="empty-chat-title">Todo listo para empezar</div>
                <div className="panel-sub">
                  Escribe tu primera pregunta. Tu primer intercambio es gratuito y después podrás continuar con créditos.
                </div>
              </div>
            ) : (
              <>
                {visibleMessages.map((m: any) => {
                  const mine = m.sender_type === "cliente";
                  return (
                    <div key={m.id} className={`bubble-row ${mine ? "bubble-row-mine" : ""}`}>
                      {!mine ? (
                        <div className="bubble-mini-avatar">
                          {initials(activeTarotista?.display_name || thread?.tarotista_display_name)}
                        </div>
                      ) : null}

                      <div className={`bubble ${mine ? "bubble-mine" : "bubble-worker"}`}>
                        <div>{m.body}</div>
                        <div className="bubble-time">{fmt(m.created_at)}</div>
                      </div>
                    </div>
                  );
                })}

                {isTyping ? (
                  <div className="bubble-row">
                    <div className="bubble-mini-avatar">
                      {initials(activeTarotista?.display_name || thread?.tarotista_display_name)}
                    </div>
                    <div className="bubble bubble-worker typing-bubble">
                      <div className="typing-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="composer-shell">
            {locked ? (
              <div className="locked-banner">
                <div>
                  <div className="locked-title">
                    <Lock size={16} /> Activa tu sesión para continuar
                  </div>
                  <div className="panel-sub">
                    Tu consulta gratis ya se ha usado. Compra créditos para seguir con tu lectura.
                  </div>
                </div>
                <button
                  className="pay-btn"
                  onClick={() => (window.location.href = "/checkout/chat")}
                >
                  <Wallet size={15} /> Comprar créditos
                </button>
              </div>
            ) : null}

            <textarea
              className="composer"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={locked ? "Necesitas créditos para seguir" : "Escribe aquí tu pregunta…"}
              disabled={locked || !activeTarotista || showWelcome}
            />

            <div className="composer-footer">
              <div className="composer-hint">
                <Sparkles size={14} /> Consulta privada, elegante y separada de tu panel cliente
              </div>
              <button
                className="send-btn"
                onClick={sendMessage}
                disabled={sending || locked || !activeTarotista || showWelcome}
              >
                <Send size={15} /> {sending ? "Enviando…" : "Enviar mensaje"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {showWelcome ? (
        <div className="modal-overlay">
          <div className="welcome-modal">
            <div className="welcome-head">
              <div className="brand-logo small">
                <Image
                  src="/Nuevo-logo-tarot.png"
                  alt="Tarot Celestial"
                  width={42}
                  height={42}
                />
              </div>
              <div>
                <div className="panel-title">Bienvenida a tu chat privado</div>
                <div className="panel-sub">
                  Antes de empezar, necesitamos tus datos básicos una sola vez.
                </div>
              </div>
            </div>

            <div className="welcome-grid">
              <label>
                <span>Nombre</span>
                <input
                  value={welcomeForm.nombre}
                  onChange={(e) =>
                    setWelcomeForm((p) => ({ ...p, nombre: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>Teléfono</span>
                <input
                  value={welcomeForm.telefono}
                  onChange={(e) =>
                    setWelcomeForm((p) => ({ ...p, telefono: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>E-mail</span>
                <input
                  type="email"
                  value={welcomeForm.email}
                  onChange={(e) =>
                    setWelcomeForm((p) => ({ ...p, email: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>País</span>
                <select
                  value={welcomeForm.pais}
                  onChange={(e) =>
                    setWelcomeForm((p) => ({ ...p, pais: e.target.value }))
                  }
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                <span>Fecha de nacimiento</span>
                <input
                  type="date"
                  value={welcomeForm.fecha_nacimiento}
                  onChange={(e) =>
                    setWelcomeForm((p) => ({
                      ...p,
                      fecha_nacimiento: e.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <button
              className="send-btn wide"
              disabled={savingWelcome}
              onClick={saveWelcome}
            >
              {savingWelcome ? "Guardando…" : "Entrar al chat"}
            </button>
          </div>
        </div>
      ) : null}

      {confirmWorker ? (
        <div className="modal-overlay">
          <div className="confirm-modal">
            <button className="confirm-close" onClick={() => setConfirmWorker(null)}>
              <X size={16} />
            </button>

            <div className="confirm-avatar">
              {initials(confirmWorker?.display_name)}
            </div>

            <div className="confirm-title">
              ¿Quieres entrar al chat con {confirmWorker?.display_name}?
            </div>

            <div className="confirm-sub">
              Verás los últimos mensajes recientes y continuarás tu consulta en una sesión privada.
            </div>

            <div className="confirm-actions">
              <button className="confirm-secondary" onClick={() => setConfirmWorker(null)}>
                Cancelar
              </button>
              <button className="confirm-primary" onClick={confirmEnterChat}>
                Entrar al chat
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .chat-page-shell {
          min-height: 100dvh;
          background:
            radial-gradient(circle at top, rgba(139, 92, 246, 0.22), transparent 35%),
            linear-gradient(180deg, #0b1120 0%, #020617 100%);
          color: #fff;
          display: flex;
          flex-direction: column;
          padding: 18px;
          gap: 16px;
          overflow: hidden;
        }

        .chat-loading {
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #020617;
          color: #fff;
          font-size: 16px;
        }

        .chat-topbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: center;
          padding: 18px 20px;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(8, 11, 26, 0.72);
          backdrop-filter: blur(18px);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
        }

        .brand-block {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .brand-logo {
          width: 58px;
          height: 58px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
          overflow: hidden;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
        }

        .brand-logo.small {
          width: 52px;
          height: 52px;
          border-radius: 16px;
        }

        .brand-over {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #d7b56d;
        }

        .brand-title {
          font-size: 24px;
          line-height: 1.08;
          font-weight: 900;
        }

        .topbar-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .summary-pill,
        .logout-btn,
        .status-badge,
        .count-chip,
        .pay-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 11px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        .summary-pill {
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          min-width: 112px;
          border-radius: 18px;
          padding: 12px 14px;
        }

        .summary-pill span {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.62);
        }

        .summary-pill strong {
          font-size: 18px;
          line-height: 1;
        }

        .logout-btn,
        .pay-btn {
          cursor: pointer;
          font-weight: 800;
        }

        .flash-box {
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid rgba(215, 181, 109, 0.18);
          background: rgba(215, 181, 109, 0.1);
          backdrop-filter: blur(12px);
        }

        .chat-layout {
          flex: 1;
          display: grid;
          grid-template-columns: 360px minmax(0, 1fr);
          gap: 16px;
          min-height: 0;
        }

        .workers-panel,
        .conversation-panel {
          min-height: 0;
          display: flex;
          flex-direction: column;
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(8, 11, 26, 0.78);
          backdrop-filter: blur(18px);
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
        }

        .panel-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          padding: 18px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
        }

        .panel-title {
          font-size: 22px;
          font-weight: 900;
          line-height: 1.05;
        }

        .panel-sub {
          font-size: 13px;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.7);
        }

        .conversation-title-wrap {
          min-width: 0;
        }

        .workers-grid {
          padding: 16px;
          display: grid;
          gap: 14px;
          overflow-y: auto;
          align-content: start;
        }

        .worker-card {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
          padding: 16px;
          text-align: left;
          display: grid;
          gap: 12px;
          cursor: pointer;
          transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .worker-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        }

        .worker-card-active {
          border-color: rgba(215, 181, 109, 0.42);
          box-shadow: 0 0 0 1px rgba(215, 181, 109, 0.18) inset;
        }

        .worker-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .worker-avatar,
        .hero-avatar,
        .bubble-mini-avatar,
        .hero-avatar-large,
        .confirm-avatar {
          display: grid;
          place-items: center;
          border-radius: 999px;
          font-weight: 900;
          color: #fff7ed;
          background: radial-gradient(circle at top, rgba(215, 181, 109, 0.9), rgba(107, 33, 168, 0.94));
        }

        .worker-avatar,
        .hero-avatar {
          width: 56px;
          height: 56px;
          font-size: 18px;
        }

        .hero-avatar-large,
        .confirm-avatar {
          width: 66px;
          height: 66px;
          font-size: 20px;
          margin-bottom: 10px;
        }

        .bubble-mini-avatar {
          width: 34px;
          height: 34px;
          font-size: 12px;
          flex: 0 0 auto;
        }

        .worker-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 800;
        }

        .worker-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          display: inline-block;
        }

        .worker-name {
          font-size: 20px;
          font-weight: 900;
          line-height: 1.05;
        }

        .worker-team {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.58);
          margin-top: -4px;
        }

        .worker-copy {
          font-size: 13px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.76);
        }

        .worker-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }

        .worker-mini-text {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.56);
        }

        .worker-open {
          font-size: 12px;
          font-weight: 900;
          color: #d7b56d;
        }

        .conversation-head {
          align-items: center;
        }

        .conversation-ident {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .back-btn {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          display: none;
          place-items: center;
          cursor: pointer;
        }

        .messages-surface {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 18px;
          display: grid;
          gap: 14px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent);
        }

        .empty-chat-box,
        .empty-box {
          min-height: 220px;
          border-radius: 22px;
          border: 1px dashed rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.03);
          padding: 22px;
          display: grid;
          place-items: center;
          text-align: center;
          gap: 8px;
          color: rgba(255, 255, 255, 0.74);
        }

        .empty-chat-title {
          font-size: 20px;
          font-weight: 900;
        }

        .bubble-row {
          display: flex;
          gap: 10px;
          align-items: flex-end;
        }

        .bubble-row-mine {
          justify-content: flex-end;
        }

        .bubble {
          max-width: min(78%, 620px);
          padding: 14px 16px;
          border-radius: 20px;
          display: grid;
          gap: 8px;
          font-size: 14px;
          line-height: 1.6;
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.12);
        }

        .bubble-worker {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.09);
        }

        .bubble-mine {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.92), rgba(107, 33, 168, 0.92));
          border: 1px solid rgba(168, 85, 247, 0.28);
        }

        .bubble-time {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.58);
        }

        .typing-bubble {
          min-width: 74px;
        }

        .typing-dots {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 18px;
        }

        .typing-dots span {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(255,255,255,.8);
          animation: blink 1.2s infinite ease-in-out;
        }

        .typing-dots span:nth-child(2) {
          animation-delay: .15s;
        }

        .typing-dots span:nth-child(3) {
          animation-delay: .3s;
        }

        @keyframes blink {
          0%, 80%, 100% {
            opacity: .25;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-2px);
          }
        }

        .composer-shell {
          padding: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          display: grid;
          gap: 12px;
          background: rgba(255, 255, 255, 0.02);
        }

        .composer {
          width: 100%;
          min-height: 110px;
          max-height: 160px;
          padding: 16px;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(2, 6, 23, 0.72);
          color: #fff;
          resize: none;
          outline: none;
        }

        .composer-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }

        .composer-hint {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.68);
        }

        .send-btn {
          height: 50px;
          padding: 0 18px;
          border: none;
          border-radius: 16px;
          background: linear-gradient(135deg, #d7b56d, #8b5cf6);
          color: #fff;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
        }

        .send-btn.wide {
          width: 100%;
          justify-content: center;
        }

        .locked-banner {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid rgba(215, 181, 109, 0.24);
          background: rgba(215, 181, 109, 0.12);
        }

        .locked-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 900;
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(2, 6, 23, 0.72);
          backdrop-filter: blur(10px);
          display: grid;
          place-items: center;
          padding: 18px;
          z-index: 50;
        }

        .welcome-modal,
        .confirm-modal {
          width: min(720px, 100%);
          padding: 22px;
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(10, 14, 29, 0.94);
          display: grid;
          gap: 18px;
          box-shadow: 0 32px 90px rgba(0, 0, 0, 0.38);
          position: relative;
        }

        .welcome-head {
          display: flex;
          gap: 14px;
          align-items: center;
        }

        .confirm-title {
          font-size: 24px;
          font-weight: 900;
          text-align: center;
        }

        .confirm-sub {
          text-align: center;
          color: rgba(255,255,255,.72);
          line-height: 1.6;
        }

        .confirm-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .confirm-primary,
        .confirm-secondary {
          height: 50px;
          border-radius: 16px;
          border: none;
          font-weight: 900;
          cursor: pointer;
        }

        .confirm-primary {
          background: linear-gradient(135deg, #d7b56d, #8b5cf6);
          color: #fff;
        }

        .confirm-secondary {
          background: rgba(255,255,255,.06);
          color: #fff;
          border: 1px solid rgba(255,255,255,.1);
        }

        .confirm-close {
          position: absolute;
          right: 16px;
          top: 16px;
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,.1);
          background: rgba(255,255,255,.05);
          color: #fff;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .welcome-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .welcome-grid label {
          display: grid;
          gap: 8px;
        }

        .welcome-grid label.full {
          grid-column: 1 / -1;
        }

        .welcome-grid span {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.72);
        }

        .welcome-grid input,
        .welcome-grid select {
          height: 50px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(2, 6, 23, 0.72);
          color: #fff;
          padding: 0 14px;
          outline: none;
        }

        @media (max-width: 980px) {
          .chat-layout {
            grid-template-columns: 320px minmax(0, 1fr);
          }

          .brand-title {
            font-size: 22px;
          }
        }

        @media (max-width: 860px) {
          .chat-page-shell {
            padding: 0;
            gap: 0;
          }

          .chat-topbar {
            border-radius: 0;
            border-left: none;
            border-right: none;
            border-top: none;
            padding: 14px;
            grid-template-columns: 1fr;
          }

          .topbar-actions {
            justify-content: flex-start;
          }

          .chat-layout {
            display: flex;
            flex-direction: column;
            gap: 0;
          }

          .workers-panel,
          .conversation-panel {
            width: 100%;
            height: 100%;
            border-radius: 0;
            border-left: none;
            border-right: none;
            border-bottom: none;
          }

          .mobile-hide {
            display: none;
          }

          .mobile-hide-chat {
            display: none;
          }

          .back-btn {
            display: grid;
          }

          .summary-pill {
            min-width: unset;
          }

          .welcome-grid,
          .confirm-actions {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 560px) {
          .brand-title {
            font-size: 20px;
          }

          .workers-grid {
            padding: 12px;
          }

          .panel-head,
          .messages-surface,
          .composer-shell {
            padding: 14px;
          }

          .bubble {
            max-width: 88%;
          }

          .summary-pill {
            width: calc(50% - 5px);
          }

          .locked-banner,
          .composer-footer,
          .worker-footer {
            flex-direction: column;
            align-items: stretch;
          }
        }
      `}</style>
    </div>
  );
}
