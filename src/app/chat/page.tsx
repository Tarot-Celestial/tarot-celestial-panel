"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronRight, ExternalLink, Lock, LogOut, Send, Sparkles, Wallet, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY_CODE, buildInternationalPhone, formatCountryOptionLabel, getCountryByCode, getCountryByLabelOrCode, splitPhoneByCountry } from "@/lib/countries";

const sb = supabaseBrowser();

function normalizePaymentMeta(item: any) {
  const meta = item?.meta || {};
  if (Array.isArray(meta?.options) && meta.options.length) return meta.options;
  if (meta?.url) {
    return [{
      title: meta?.pack_name || "Continuar consulta",
      price_label: meta?.price_label || "Pagar ahora",
      url: meta.url,
      highlight: true,
    }];
  }
  return [];
}

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function statusMeta(worker: any) {
  if (worker?.status_key === "libre") return { label: "Libre", dot: "#4ade80", bg: "rgba(34,197,94,.14)" };
  if (worker?.status_key === "ocupada") return { label: "Ocupada", dot: "#fb923c", bg: "rgba(249,115,22,.14)" };
  if (worker?.status_key === "vuelvo") return { label: "Vuelvo enseguida", dot: "#c084fc", bg: "rgba(168,85,247,.16)" };
  return { label: "Desconectada", dot: "#94a3b8", bg: "rgba(148,163,184,.16)" };
}

function initials(name?: string | null) {
  return (
    String(name || "T")
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "T"
  );
}

function isOnboardingComplete(cliente: any) {
  return Boolean(cliente?.onboarding_completado && cliente?.nombre && cliente?.telefono && cliente?.email && cliente?.pais);
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
  const [showWelcome, setShowWelcome] = useState(false);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [welcomeForm, setWelcomeForm] = useState({ nombre: "", telefono: "", email: "", countryCode: DEFAULT_COUNTRY_CODE, fecha_nacimiento: "" });
  const [confirmWorker, setConfirmWorker] = useState<any>(null);
  const [mobileView, setMobileView] = useState<"workers" | "chat">("workers");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const prevMessageCountRef = useRef(0);

  const activeTarotista = useMemo(
    () => tarotistas.find((item: any) => String(item.id) === String(selectedWorkerId)) || null,
    [tarotistas, selectedWorkerId]
  );

  const welcomeCountry = useMemo(() => getCountryByCode(welcomeForm.countryCode), [welcomeForm.countryCode]);

  const visibleMessages = useMemo(() => {
    if (!thread?.id) return [];
    const limit = messages.length > 4 ? 4 : messages.length;
    return messages.slice(-limit);
  }, [messages, thread?.id]);

  const locked = Boolean(thread?.free_consulta_usada) && creditos <= 0;
  const hasPendingClientMessage = useMemo(() => messages.some((item: any) => item?.pending), [messages]);

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
      setMsg(json?.error || "No se pudo cargar el panel.");
      setBooting(false);
      return;
    }

    const nextCliente = json.cliente || null;
    setCliente(nextCliente);
    const phoneSplit = splitPhoneByCountry(nextCliente?.telefono, nextCliente?.pais);
    setWelcomeForm({
      nombre: nextCliente?.nombre || "",
      telefono: phoneSplit.localPhone || "",
      email: nextCliente?.email || data.session?.user?.email || "",
      countryCode: getCountryByLabelOrCode(nextCliente?.pais || phoneSplit.country.code).code,
      fecha_nacimiento: nextCliente?.fecha_nacimiento || "",
    });
    setShowWelcome(!isOnboardingComplete(nextCliente));
    setCreditos(Number(json.creditos_disponibles || 0));
    const nextTarotistas = Array.isArray(json.tarotistas) ? json.tarotistas : [];
    setTarotistas(nextTarotistas);
    if (!selectedWorkerId && nextTarotistas[0]?.id) {
      setSelectedWorkerId(String(nextTarotistas[0].id));
    }
    if (selectedWorkerId && !nextTarotistas.some((item: any) => String(item.id) === String(selectedWorkerId))) {
      setSelectedWorkerId("");
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

    const res = await fetch(`/api/cliente/chat/thread?worker_id=${encodeURIComponent(selectedWorkerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo abrir el chat.");
      return;
    }

    const nextMessages = Array.isArray(json.messages) ? json.messages : [];
    const hasNewWorkerMessage = nextMessages.length > prevMessageCountRef.current && nextMessages[nextMessages.length - 1]?.sender_type !== "cliente";

    setThread(json.thread || null);
    setCreditos(Number(json.creditos_disponibles || 0));

    if (hasNewWorkerMessage) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
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
    el.scrollTop = el.scrollHeight;
  }, [visibleMessages, isTyping]);

  async function openWorker(worker: any) {
    setConfirmWorker(null);
    setSelectedWorkerId(String(worker.id));
    setMobileView("chat");
    setThread(null);
    setMessages([]);
    prevMessageCountRef.current = 0;
    await loadThread();
  }

  async function saveWelcome() {
    try {
      setSavingWelcome(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/chat/login";
        return;
      }

      const res = await fetch("/api/cliente/perfil", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: welcomeForm.nombre,
          telefono: buildInternationalPhone(welcomeCountry, welcomeForm.telefono),
          email: welcomeForm.email,
          pais: welcomeCountry.label,
          fecha_nacimiento: welcomeForm.fecha_nacimiento,
          onboarding_completado: true,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo guardar tu perfil.");
      setShowWelcome(false);
      await loadTarotistas();
    } catch (e: any) {
      setMsg(e?.message || "No se pudo guardar tu perfil.");
    } finally {
      setSavingWelcome(false);
    }
  }

  async function sendMessage() {
    if (!composer.trim() || !selectedWorkerId) return;

    const body = composer.trim();
    const optimisticId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      sender_type: "cliente",
      sender_display_name: cliente?.nombre || "Tú",
      body,
      kind: "text",
      meta: null,
      created_at: new Date().toISOString(),
      pending: true,
    };

    try {
      setSending(true);
      setMsg("");
      setMessages((prev) => [...prev, optimisticMessage]);
      prevMessageCountRef.current += 1;
      setComposer("");

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/chat/login";
        return;
      }

      const res = await fetch("/api/cliente/chat/thread", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: selectedWorkerId, thread_id: thread?.id || undefined, body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMessages((prev) => prev.filter((item: any) => item.id !== optimisticId));
        prevMessageCountRef.current = Math.max(0, prevMessageCountRef.current - 1);
        setComposer(body);
        if (json?.need_payment) {
          setMsg("Te has quedado sin créditos. Compra más para seguir la consulta.");
        } else {
          throw new Error(json?.error || "No se pudo enviar el mensaje.");
        }
        return;
      }

      const inserted = json?.message || null;
      if (inserted) {
        setMessages((prev) => prev.map((item: any) => (item.id === optimisticId ? inserted : item)));
      }

      if (json?.thread_id && !thread?.id) {
        setThread((prev: any) => ({ ...(prev || {}), id: json.thread_id }));
      }
      if (typeof json?.creditos_restantes !== "undefined") {
        setCreditos(Number(json.creditos_restantes || 0));
      }

      await loadThread();
      await loadTarotistas();
    } catch (e: any) {
      setMessages((prev) => prev.filter((item: any) => item.id !== optimisticId));
      prevMessageCountRef.current = Math.max(0, prevMessageCountRef.current - 1);
      setComposer(body);
      setMsg(e?.message || "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/chat/login";
  }

  if (booting) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#fff", background: "#020617" }}>Cargando panel de chat…</div>;
  }

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <div>
          <div className="eyebrow">Tarot Celestial · chat privado</div>
          <h1>{mobileView === "chat" && activeTarotista ? activeTarotista.display_name : `Hola${cliente?.nombre ? `, ${cliente.nombre}` : ""}`}</h1>
          <p>
            {mobileView === "chat" && activeTarotista
              ? `Consulta con ${activeTarotista.display_name}. Mostramos solo los últimos mensajes para que el chat sea ágil y cómodo.`
              : "Elige tu tarotista disponible y entra al chat en un solo toque."}
          </p>
        </div>
        <div className="header-actions">
          <span className="header-chip"><Wallet size={14} /> {creditos} créditos</span>
          <button className="ghost-btn" onClick={logout}><LogOut size={14} /> Salir</button>
        </div>
      </header>

      {msg ? <div className="notice">{msg}</div> : null}

      <div className="chat-layout">
        <section className={`workers-panel ${mobileView === "chat" ? "mobile-hidden" : ""}`}>
          <div className="panel-head">
            <div>
              <div className="panel-title">Tarotistas</div>
              <div className="panel-sub">Solo se puede entrar con tarotistas libres.</div>
            </div>
          </div>

          <div className="workers-grid">
            {tarotistas.map((worker: any) => {
              const status = statusMeta(worker);
              const isAvailable = worker?.status_key === "libre";
              const hasHistory = Boolean(worker?.current_thread_id);
              return (
                <button
                  key={worker.id}
                  className={`worker-card ${selectedWorkerId === String(worker.id) ? "active" : ""}`}
                  onClick={() => isAvailable && setConfirmWorker(worker)}
                  disabled={!isAvailable}
                >
                  <div className="worker-top">
                    <div className="avatar">{initials(worker.display_name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="worker-name">{worker.display_name}</div>
                      <div className="worker-role">{worker.team ? `Especialidad: ${worker.team}` : "Tarotista disponible"}</div>
                    </div>
                    <span className="status-pill" style={{ background: status.bg }}>
                      <span className="dot" style={{ background: status.dot }} />
                      {status.label}
                    </span>
                  </div>

                  <div className="worker-copy">
                    {worker.welcome_message || "Consulta privada por chat. Respuestas claras, cómodas y sin esperas innecesarias."}
                  </div>

                  <div className="worker-footer">
                    <span className="soft-chip">{hasHistory ? "Ya hablaste con ella" : "Nueva consulta"}</span>
                    <span className="soft-chip">{hasHistory && worker.current_thread_last_message_at ? `Último chat ${fmt(worker.current_thread_last_message_at)}` : "Acceso inmediato"}</span>
                  </div>

                  {hasHistory ? (
                    <div className="preview-box">
                      <div className="preview-title">Último mensaje</div>
                      <div className="preview-copy">{worker.current_thread_last_message_preview || "Retoma la consulta donde la dejaste."}</div>
                    </div>
                  ) : null}

                  <div className="enter-row">
                    <span>{isAvailable ? "Entrar al chat" : worker.status_key === "ocupada" ? "Ahora está ocupada" : "No disponible"}</span>
                    <ChevronRight size={16} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`chat-panel ${mobileView === "workers" ? "mobile-chat-hidden" : ""}`}>
          {mobileView === "chat" && activeTarotista ? (
            <>
              <div className="chat-topbar">
                <button className="back-btn" onClick={() => setMobileView("workers")}><ArrowLeft size={16} /> Volver al inicio</button>
                <div>
                  <div className="panel-title">{activeTarotista.display_name}</div>
                  <div className="panel-sub">{statusMeta(activeTarotista).label} · {thread?.free_consulta_usada ? "La pregunta gratis ya está usada" : "Tu primera pregunta marcada será gratuita"}</div>
                </div>
              </div>

              <div className="chat-welcome">
                <Sparkles size={16} />
                {activeTarotista.welcome_message || thread?.tarotista_welcome_message || "Haz tu consulta con calma. Este chat está optimizado para leer solo lo importante."}
              </div>

              <div className="thread-summary">
                <div className="summary-card"><span>Créditos</span><b>{creditos}</b></div>
                <div className="summary-card"><span>Consulta gratis</span><b>{thread?.free_consulta_usada ? "Usada" : "Disponible"}</b></div>
                <div className="summary-card"><span>Vista</span><b>{visibleMessages.length ? `${visibleMessages.length} mensajes` : "Nuevo chat"}</b></div>
              </div>

              <div className="messages-box" ref={scrollRef}>
                {visibleMessages.length ? (
                  <div className="timeline-tip">Mostramos los últimos {visibleMessages.length} mensajes para que el chat sea más cómodo.</div>
                ) : (
                  <div className="empty-chat">Aún no hay mensajes. Escribe la primera consulta para empezar.</div>
                )}

                {visibleMessages.map((item: any) => {
                  const mine = item.sender_type === "cliente";
                  const paymentOptions = item.kind === "payment_link" ? normalizePaymentMeta(item) : [];
                  return (
                    <div key={item.id} className={`bubble-wrap ${mine ? "mine" : "theirs"}`}>
                      <div className={`bubble ${mine ? "mine" : "theirs"} ${item.kind === "payment_link" ? "payment-bubble" : ""} ${item.pending ? "pending" : ""}`}>
                        {item.kind === "payment_link" && paymentOptions.length ? (
                          <div className="payment-card">
                            <div className="payment-eyebrow">Pago seguro</div>
                            <div className="payment-title">Elige tu pack para seguir la consulta</div>
                            <div className="payment-copy">Selecciona una opción y entra directamente al pago.</div>
                            <div className="payment-options">
                              {paymentOptions.map((option: any, index: number) => (
                                <a
                                  key={`${item.id}-${index}`}
                                  href={option.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`payment-option ${option.highlight ? "highlight" : ""}`}
                                >
                                  <div>
                                    <div className="payment-option-title">{option.title}</div>
                                    <div className="payment-option-price">{option.price_label}</div>
                                  </div>
                                  <span className="payment-option-cta">Ir al pago <ExternalLink size={14} /></span>
                                </a>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{item.body}</div>
                        )}
                        <div className="bubble-time">{item.pending ? "Enviando…" : fmt(item.created_at)}</div>
                      </div>
                    </div>
                  );
                })}

                {isTyping ? <div className="typing">La tarotista está escribiendo…</div> : null}
                {hasPendingClientMessage ? <div className="typing">Tu mensaje se está enviando…</div> : null}
              </div>

              {locked ? (
                <div className="paywall-box">
                  <div>
                    <div className="panel-title" style={{ fontSize: 18 }}>Te has quedado sin créditos</div>
                    <div className="panel-sub">Tu tarotista podrá enviarte un enlace de pago para seguir la consulta sin salir del chat.</div>
                  </div>
                  <button className="pay-btn"><Lock size={14} /> Esperando propuesta de pago</button>
                </div>
              ) : null}

              <div className="composer-box">
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder={thread?.free_consulta_usada ? "Escribe tu siguiente mensaje…" : "Escribe tu primera consulta…"}
                  className="composer"
                />
                <button className="send-btn" disabled={sending || !composer.trim()} onClick={sendMessage}>
                  <Send size={15} /> {sending ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </>
          ) : (
            <div className="chat-placeholder">
              <Sparkles size={18} />
              <div>
                <div className="panel-title">Selecciona una tarotista</div>
                <div className="panel-sub">Verás una confirmación antes de entrar al chat.</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {confirmWorker ? (
        <div className="overlay" onClick={() => setConfirmWorker(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setConfirmWorker(null)}><X size={16} /></button>
            <div className="panel-title">¿Entrar al chat con {confirmWorker.display_name}?</div>
            <div className="panel-sub" style={{ marginTop: 8 }}>
              {confirmWorker.welcome_message || "Entrarás directamente al hilo privado con esta tarotista."}
            </div>
            <div className="confirm-row">
              <button className="ghost-btn" onClick={() => setConfirmWorker(null)}>Cancelar</button>
              <button className="send-btn" onClick={() => openWorker(confirmWorker)}>Sí, entrar</button>
            </div>
          </div>
        </div>
      ) : null}

      {showWelcome ? (
        <div className="overlay" onClick={() => {}}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Completa tu acceso</div>
            <div className="panel-sub" style={{ marginTop: 8 }}>Necesitamos tus datos básicos para terminar de activar el chat.</div>
            <div className="form-grid">
              <input className="input" placeholder="Nombre" value={welcomeForm.nombre} onChange={(e) => setWelcomeForm((p) => ({ ...p, nombre: e.target.value }))} />
              <input className="input" placeholder="E-mail" value={welcomeForm.email} onChange={(e) => setWelcomeForm((p) => ({ ...p, email: e.target.value }))} />
              <select className="input" value={welcomeForm.countryCode} onChange={(e) => setWelcomeForm((p) => ({ ...p, countryCode: e.target.value }))}>
                {COUNTRY_OPTIONS.map((item) => <option key={item.code} value={item.code}>{formatCountryOptionLabel(item)}</option>)}
              </select>
              <div className="phone-field">
                <span className="phone-prefix">{welcomeCountry.dialCode}</span>
                <input className="input phone-input" placeholder={welcomeCountry.hint || "600123123"} value={welcomeForm.telefono} onChange={(e) => setWelcomeForm((p) => ({ ...p, telefono: e.target.value }))} />
              </div>
              <input className="input" type="date" value={welcomeForm.fecha_nacimiento} onChange={(e) => setWelcomeForm((p) => ({ ...p, fecha_nacimiento: e.target.value }))} />
            </div>
            <button className="send-btn" style={{ width: "100%" }} onClick={saveWelcome} disabled={savingWelcome}>
              <CheckCircle2 size={16} /> {savingWelcome ? "Guardando…" : "Entrar al panel"}
            </button>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .chat-shell{min-height:100vh;padding:18px;background:radial-gradient(circle at top, rgba(124,58,237,.14), transparent 18%), #020617;color:#fff;display:grid;gap:16px;}
        .chat-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;padding:18px 20px;border-radius:24px;background:rgba(15,23,42,.88);border:1px solid rgba(255,255,255,.07);}
        .eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#c4b5fd;margin-bottom:6px;}
        h1{margin:0;font-size:34px;line-height:1.05;}
        p{margin:6px 0 0;color:#cbd5e1;max-width:780px;}
        .header-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
        .header-chip,.ghost-btn,.soft-chip,.status-pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:10px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;}
        .ghost-btn{cursor:pointer;}
        .notice{padding:12px 14px;border-radius:18px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.2);color:#fee2e2;}
        .chat-layout{display:grid;grid-template-columns:minmax(320px,420px) minmax(0,1fr);gap:16px;align-items:start;}
        .workers-panel,.chat-panel{padding:16px;border-radius:24px;background:rgba(15,23,42,.88);border:1px solid rgba(255,255,255,.07);display:grid;gap:14px;min-height:72vh;}
        .panel-head,.chat-topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;}
        .panel-title{font-weight:900;font-size:22px;}
        .panel-sub{color:#cbd5e1;line-height:1.5;}
        .workers-grid{display:grid;gap:12px;align-content:start;max-height:calc(72vh - 50px);overflow:auto;padding-right:4px;}
        .worker-card{display:grid;gap:12px;text-align:left;padding:16px;border-radius:22px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);color:#fff;cursor:pointer;transition:transform .18s ease,border-color .18s ease,opacity .18s ease;}
        .worker-card:hover{transform:translateY(-1px);border-color:rgba(196,181,253,.28);}
        .worker-card:disabled{opacity:.56;cursor:not-allowed;}
        .worker-card.active{border-color:rgba(196,181,253,.55);background:rgba(139,92,246,.10);}
        .worker-top{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;}
        .avatar{width:50px;height:50px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg, rgba(139,92,246,.95), rgba(217,70,239,.75));font-weight:900;}
        .worker-name{font-weight:900;font-size:18px;}
        .phone-field{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px;align-items:center;}
        .phone-prefix{height:48px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);font-weight:800;color:#f8fafc;}
        .phone-input{min-width:0;}
        .worker-role{color:#cbd5e1;font-size:13px;}
        .worker-copy{color:#e2e8f0;line-height:1.55;}
        .worker-footer{display:flex;gap:8px;flex-wrap:wrap;}
        .soft-chip{padding:8px 12px;font-size:12px;color:#e2e8f0;background:rgba(255,255,255,.04);}
        .preview-box{padding:12px 14px;border-radius:16px;background:rgba(2,6,23,.42);border:1px solid rgba(255,255,255,.06);}
        .preview-title{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#c4b5fd;margin-bottom:6px;}
        .preview-copy{color:#cbd5e1;line-height:1.5;}
        .enter-row{display:flex;justify-content:space-between;align-items:center;color:#f5f3ff;font-weight:700;}
        .status-pill{font-size:12px;padding:8px 12px;}
        .dot{width:8px;height:8px;border-radius:999px;display:inline-block;}
        .chat-topbar{padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.06);}
        .back-btn{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;}
        .chat-welcome,.chat-placeholder,.timeline-tip,.typing,.empty-chat,.paywall-box{padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);display:flex;gap:10px;align-items:flex-start;}
        .thread-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
        .summary-card{padding:14px;border-radius:18px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);display:grid;gap:6px;}
        .summary-card span{color:#cbd5e1;font-size:13px;}
        .summary-card b{font-size:19px;}
        .messages-box{flex:1;min-height:330px;max-height:54vh;overflow:auto;padding:14px;border-radius:22px;background:linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.07);display:grid;gap:12px;align-content:start;}
        .bubble-wrap{display:grid;}
        .bubble-wrap.mine{justify-items:end;}
        .bubble-wrap.theirs{justify-items:start;}
        .bubble{max-width:min(88%,520px);padding:12px 14px;border-radius:20px;display:grid;gap:8px;}
        .bubble.mine{background:linear-gradient(135deg, rgba(139,92,246,.92), rgba(124,58,237,.82));}
        .bubble.theirs{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);}
        .bubble.pending{opacity:.86;}
        .payment-bubble{background:linear-gradient(180deg, rgba(15,23,42,.96), rgba(30,41,59,.92));border:1px solid rgba(196,181,253,.24);min-width:min(100%,340px);}
        .payment-card{display:grid;gap:10px;}
        .payment-eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#c4b5fd;}
        .payment-title{font-weight:900;font-size:17px;}
        .payment-copy{color:#cbd5e1;line-height:1.45;}
        .payment-options{display:grid;gap:10px;}
        .payment-option{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;transition:transform .16s ease,border-color .16s ease,background .16s ease;}
        .payment-option:hover{transform:translateY(-1px);border-color:rgba(196,181,253,.42);background:rgba(139,92,246,.12);}
        .payment-option.highlight{border-color:rgba(196,181,253,.45);background:rgba(139,92,246,.16);}
        .payment-option-title{font-weight:800;font-size:15px;}
        .payment-option-price{color:#e9d5ff;font-size:14px;margin-top:3px;}
        .payment-option-cta{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:800;white-space:nowrap;}
        .bubble-time{font-size:11px;color:#e2e8f0;opacity:.86;justify-self:end;}
        .paywall-box{justify-content:space-between;flex-wrap:wrap;}
        .pay-btn,.send-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;padding:0 18px;border:none;border-radius:16px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;font-weight:800;cursor:pointer;}
        .composer-box{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end;}
        .composer{min-height:104px;padding:14px 16px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#fff;resize:none;outline:none;}
        .overlay{position:fixed;inset:0;background:rgba(2,6,23,.7);display:grid;place-items:center;padding:18px;z-index:40;}
        .modal-card{width:min(520px,100%);padding:22px;border-radius:24px;background:#0f172a;border:1px solid rgba(255,255,255,.09);display:grid;gap:14px;position:relative;}
        .modal-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;display:grid;place-items:center;}
        .confirm-row{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;}
        .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .input{height:48px;padding:0 14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#fff;outline:none;}
        .chat-placeholder{height:100%;justify-content:center;align-items:center;}
        @media (max-width: 980px){
          .chat-layout{grid-template-columns:1fr;}
          .thread-summary,.form-grid,.composer-box{grid-template-columns:1fr;}
          .workers-panel.mobile-hidden,.chat-panel.mobile-chat-hidden{display:none;}
          .phone-field{grid-template-columns:1fr;}
          h1{font-size:28px;}
          .messages-box{max-height:none;min-height:300px;}
          .payment-option{flex-direction:column;align-items:flex-start;}
          .payment-option-cta{margin-top:4px;}
        }
      `}</style>
    </div>
  );
}
