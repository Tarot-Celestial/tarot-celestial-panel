"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, LogOut, Lock, Send, Sparkles, Wallet } from "lucide-react";
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
  if (worker?.status_key === "libre") return { label: "Libre", dot: "#4ade80", soft: "rgba(34,197,94,.16)" };
  if (worker?.status_key === "ocupada") return { label: "Ocupada", dot: "#fb923c", soft: "rgba(249,115,22,.16)" };
  return { label: "Vuelvo en 5 min", dot: "#c084fc", soft: "rgba(168,85,247,.16)" };
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

function isOnboardingComplete(cliente: any) {
  return Boolean(
    cliente?.onboarding_completado && cliente?.nombre && cliente?.telefono && cliente?.email && cliente?.pais && cliente?.fecha_nacimiento
  );
}

export default function ChatPage() {
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
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
  const [welcomeForm, setWelcomeForm] = useState({ nombre: "", telefono: "", email: "", pais: COUNTRY_OPTIONS[0], fecha_nacimiento: "" });
  const [sessionStartedAt, setSessionStartedAt] = useState<string>(new Date().toISOString());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeTarotista = useMemo(
    () => tarotistas.find((item: any) => String(item.id) === String(selectedWorkerId)) || null,
    [tarotistas, selectedWorkerId]
  );

  const visibleMessages = useMemo(() => {
    if (!sessionStartedAt) return [];
    const since = new Date(sessionStartedAt).getTime();
    return (messages || []).filter((m: any) => {
      const time = new Date(m?.created_at || 0).getTime();
      return Number.isFinite(time) ? time >= since : false;
    });
  }, [messages, sessionStartedAt]);

  const summaryItems = useMemo(
    () => [
      { label: "Créditos disponibles", value: String(creditos), meta: "Después del gratis, cada nuevo mensaje del cliente consume 1 crédito." },
      { label: "Tarotistas online", value: String(tarotistas.length), meta: "Solo se muestran las tarotistas disponibles para operar el chat." },
      { label: "Consulta gratis", value: thread?.free_consulta_usada ? "Usada" : "Disponible", meta: thread?.free_consulta_usada ? "Tu primer intercambio ya fue consumido." : "Tienes un primer intercambio sin coste." },
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
    setTarotistas(Array.isArray(json.tarotistas) ? json.tarotistas : []);

    const available = Array.isArray(json.tarotistas) ? json.tarotistas : [];
    if (!selectedWorkerId && available[0]?.id) setSelectedWorkerId(String(available[0].id));
    if (selectedWorkerId && !available.some((item: any) => String(item.id) === String(selectedWorkerId))) {
      setSelectedWorkerId(String(available[0]?.id || ""));
      setMobileView("workers");
      setMessages([]);
      setThread(null);
    }

    setBooting(false);
  }, [selectedWorkerId]);

  const loadThread = useCallback(async () => {
    if (!selectedWorkerId) {
      setThread(null);
      setMessages([]);
      return;
    }
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(`/api/cliente/chat/thread?worker_id=${encodeURIComponent(selectedWorkerId)}`,
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

  useEffect(() => { loadTarotistas(); }, [loadTarotistas]);
  useEffect(() => {
    if (!selectedWorkerId) return;
    loadThread();
    const id = window.setInterval(() => loadThread(), 5000);
    return () => window.clearInterval(id);
  }, [selectedWorkerId, loadThread]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleMessages]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "ok") {
      setMsg("✅ Pago completado. Tus créditos del chat se están actualizando.");
      window.history.replaceState({}, "", "/chat");
      window.setTimeout(() => {
        loadTarotistas();
        loadThread();
      }, 900);
    }
    if (params.get("checkout") === "cancelled") {
      setMsg("Has cancelado el pago del chat.");
      window.history.replaceState({}, "", "/chat");
    }
  }, [loadTarotistas, loadThread]);

  function openWorker(workerId: string) {
    setSelectedWorkerId(workerId);
    setSessionStartedAt(new Date().toISOString());
    setMessages([]);
    setThread(null);
    setMobileView("chat");
  }

  async function saveWelcome() {
    if (!welcomeForm.nombre.trim() || !welcomeForm.telefono.trim() || !welcomeForm.email.trim() || !welcomeForm.pais.trim() || !welcomeForm.fecha_nacimiento.trim()) {
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
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...welcomeForm, onboarding_completado: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo guardar tu bienvenida.");
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
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: selectedWorkerId, thread_id: thread?.id || null, body: text }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 402 || json?.need_payment) {
        setMsg("Tu consulta gratis ya se ha usado. Necesitas créditos para seguir escribiendo.");
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo enviar el mensaje.");
      setComposer("");
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
          <div className="brand-logo"><Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={54} height={54} priority /></div>
          <div>
            <div className="brand-over">Tarot Celestial · Chat Privado</div>
            <div className="brand-title">Tu consulta por chat, más íntima y más cuidada</div>
          </div>
        </div>
        <div className="topbar-actions">
          {summaryItems.map((item) => (
            <div key={item.label} className="summary-pill">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
          <button className="logout-btn" onClick={logout}><LogOut size={15} /> Salir</button>
        </div>
      </div>

      {msg ? <div className="flash-box">{msg}</div> : null}

      <div className="chat-layout" style={{ height: "100%" }}>
        <section className={`workers-panel ${mobileView === "chat" ? "mobile-hide" : ""}`}>
          <div className="panel-head">
            <div>
              <div className="panel-title">Tarotistas disponibles</div>
              <div className="panel-sub">Solo ves las tarotistas activas en este momento.</div>
            </div>
            <span className="count-chip">{tarotistas.length}</span>
          </div>

          <div className="workers-grid">
            {(tarotistas || []).map((worker: any) => {
              const chip = statusChip(worker);
              const active = String(worker.id) === String(selectedWorkerId);
              return (
                <button
                  key={worker.id}
                  type="button"
                  className={`worker-square ${active ? "worker-square-active" : ""}`}
                  onClick={() => openWorker(String(worker.id))}
                  style={{ boxShadow: active ? `0 0 0 1px ${chip.dot} inset` : undefined }}
                >
                  <div className="worker-square-top">
                    <div className="worker-square-avatar">{initials(worker.display_name)}</div>
                    <span className="status-dot" style={{ background: chip.dot, boxShadow: `0 0 0 10px ${chip.soft}` }} />
                  </div>
                  <div>
                    <div className="worker-square-name">{worker.display_name}</div>
                    <div className="worker-square-team">Equipo {worker.team || "—"}</div>
                  </div>
                  <div className="worker-square-status" style={{ color: chip.dot }}>{chip.label}</div>
                  <div className="worker-square-copy">
                    {worker.welcome_message || "Consulta amor, trabajo, energía y decisiones importantes."}
                  </div>
                </button>
              );
            })}

            {!tarotistas.length ? (
              <div className="empty-box">Ahora mismo no hay tarotistas conectadas para chat.</div>
            ) : null}
          </div>
        </section>

        <section className={`conversation-panel ${mobileView === "workers" ? "mobile-hide-chat" : ""}`}>
          <div className="panel-head conversation-head">
            <div className="conversation-ident">
              <button className="back-btn" onClick={() => setMobileView("workers")}><ChevronLeft size={16} /></button>
              <div className="hero-avatar">{initials(activeTarotista?.display_name)}</div>
              <div>
                <div className="panel-title">{activeTarotista?.display_name || "Elige una tarotista"}</div>
                <div className="panel-sub">{activeTarotista?.welcome_message || "Tu chat empieza limpio cada vez que entras. El historial completo queda solo en admin."}</div>
              </div>
            </div>
            {activeTarotista ? <span className="status-badge" style={{ color: statusChip(activeTarotista).dot }}>{statusChip(activeTarotista).label}</span> : null}
          </div>

          <div className="messages-surface" ref={scrollRef}>
            {!activeTarotista ? (
              <div className="empty-chat-box">Selecciona una tarotista para abrir tu espacio de consulta.</div>
            ) : !visibleMessages.length ? (
              <div className="empty-chat-box">
                <div className="hero-avatar hero-avatar-large">{initials(activeTarotista?.display_name)}</div>
                <div className="empty-chat-title">Tu consulta empieza limpia</div>
                <div className="panel-sub">
                  No mostramos aquí el historial anterior. Desde este momento vivirás una experiencia nueva, privada y enfocada en esta sesión.
                </div>
              </div>
            ) : (
              visibleMessages.map((m: any) => {
                const mine = m.sender_type === "cliente";
                return (
                  <div key={m.id} className={`bubble-row ${mine ? "bubble-row-mine" : ""}`}>
                    {!mine ? <div className="bubble-mini-avatar">{initials(activeTarotista?.display_name)}</div> : null}
                    <div className={`bubble ${mine ? "bubble-mine" : "bubble-worker"}`}>
                      <div>{m.body}</div>
                      <div className="bubble-time">{fmt(m.created_at)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="composer-shell">
            {locked ? (
              <div className="locked-banner">
                <div>
                  <div className="locked-title"><Lock size={16} /> Activa tu sesión para continuar</div>
                  <div className="panel-sub">Tu primer intercambio ya se ha usado. Necesitas créditos para seguir escribiendo.</div>
                </div>
                <span className="credits-pill"><Wallet size={14} /> {creditos} créditos</span>
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
              <div className="composer-hint"><Sparkles size={14} /> Chat privado con experiencia premium</div>
              <button className="send-btn" onClick={sendMessage} disabled={sending || locked || !activeTarotista || showWelcome}>
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
              <div className="brand-logo small"><Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={44} height={44} /></div>
              <div>
                <div className="panel-title">Bienvenida a tu chat privado</div>
                <div className="panel-sub">Antes de empezar, déjanos tus datos básicos una sola vez.</div>
              </div>
            </div>

            <div className="welcome-grid">
              <label><span>Nombre</span><input value={welcomeForm.nombre} onChange={(e) => setWelcomeForm((p) => ({ ...p, nombre: e.target.value }))} /></label>
              <label><span>Teléfono</span><input value={welcomeForm.telefono} onChange={(e) => setWelcomeForm((p) => ({ ...p, telefono: e.target.value }))} /></label>
              <label><span>E-mail</span><input type="email" value={welcomeForm.email} onChange={(e) => setWelcomeForm((p) => ({ ...p, email: e.target.value }))} /></label>
              <label><span>País</span><select value={welcomeForm.pais} onChange={(e) => setWelcomeForm((p) => ({ ...p, pais: e.target.value }))}>{COUNTRY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="full"><span>Fecha de nacimiento</span><input type="date" value={welcomeForm.fecha_nacimiento} onChange={(e) => setWelcomeForm((p) => ({ ...p, fecha_nacimiento: e.target.value }))} /></label>
            </div>

            <button className="send-btn wide" disabled={savingWelcome} onClick={saveWelcome}>{savingWelcome ? "Guardando…" : "Entrar al chat"}</button>
          </div>
        </div>
      ) : null}

     <style jsx>{`
.chat-page-shell{
  height:100dvh;
  overflow:hidden;
  padding:0;
  background:#020617;
  color:#fff;
  display:flex;
  flex-direction:column;
}

.chat-loading{
  min-height:100vh;
  display:grid;
  place-items:center;
  background:#020617;
  color:#fff;
}

.chat-topbar{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:16px;
  align-items:center;
  padding:14px;
}

.topbar-actions{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

.chat-layout{
  flex:1;
  display:flex;
  overflow:hidden;
}

/* PANELS */
.workers-panel,
.conversation-panel{
  flex:1;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

/* WORKERS */
.workers-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  padding:12px;
  overflow:auto;
}

.worker-square{
  padding:14px;
  border-radius:18px;
  border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.04);
}

/* CHAT */
.messages-surface{
  flex:1;
  overflow-y:auto;
  padding:14px;
}

/* BURBUJAS */
.bubble{
  max-width:80%;
  padding:12px;
  border-radius:18px;
}

.bubble-worker{
  background:rgba(255,255,255,.06);
}

.bubble-mine{
  background:#8b5cf6;
}

/* COMPOSER */
.composer-shell{
  padding:10px;
  border-top:1px solid rgba(255,255,255,.08);
}

.composer{
  width:100%;
  min-height:80px;
  padding:12px;
  border-radius:14px;
  border:1px solid rgba(255,255,255,.1);
  background:#020617;
  color:#fff;
}

.send-btn{
  margin-top:8px;
  width:100%;
  height:44px;
  border-radius:12px;
  border:none;
  background:#8b5cf6;
  color:white;
  font-weight:700;
}

/* MOBILE */
@media (max-width: 860px){

  .chat-layout{
    flex-direction:column;
  }

  .workers-panel,
  .conversation-panel{
    width:100%;
    height:100%;
  }

  .mobile-hide{
    display:none;
  }

  .mobile-hide-chat{
    display:none;
  }

  .workers-grid{
    grid-template-columns:1fr;
  }

  .back-btn{
    display:block;
  }
}
`}</style>
    </div>
  );
}
