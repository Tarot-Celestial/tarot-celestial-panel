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
        .chat-page-shell{height:100vh;overflow:hidden;padding:0;background:#020617;color:#fff;display:flex;flex-direction:column;}
        .chat-loading{min-height:100vh;display:grid;place-items:center;background:#020617;color:#fff;font-size:16px;}
        .chat-topbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:18px 20px;border-radius:24px;border:1px solid rgba(255,255,255,.08);background:rgba(8,11,26,.76);backdrop-filter:blur(18px);}
        .brand-block{display:flex;align-items:center;gap:14px;min-width:0;}
        .brand-logo{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(180deg, rgba(255,255,255,.1), rgba(255,255,255,.04));overflow:hidden;}
        .brand-logo.small{width:54px;height:54px;border-radius:16px;}
        .brand-over{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#d7b56d;}
        .brand-title{font-size:24px;font-weight:900;line-height:1.08;}
        .topbar-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;}
        .summary-pill,.logout-btn,.status-badge,.count-chip,.credits-pill{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;}
        .summary-pill{flex-direction:column;align-items:flex-start;padding:12px 14px;border-radius:18px;min-width:132px;}
        .summary-pill span{font-size:11px;color:rgba(255,255,255,.62);}
        .summary-pill strong{font-size:18px;}
        .logout-btn{cursor:pointer;background:rgba(255,255,255,.06);}
        .flash-box{padding:14px 16px;border-radius:18px;border:1px solid rgba(215,181,109,.18);background:rgba(215,181,109,.1);}
        .chat-layout{flex:1;display:flex;overflow:hidden;}
        .workers-panel,.conversation-panel{display:flex;flex-direction:column;overflow:hidden;border-radius:0;border:none;background:#020617;}
        .workers-panel{grid-template-rows:auto 1fr;}
        .conversation-panel{grid-template-rows:auto 1fr auto;}
        .panel-head{display:flex;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.06);background:linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01));}
        .panel-title{font-size:22px;font-weight:900;}
        .panel-sub{font-size:13px;line-height:1.55;color:rgba(255,255,255,.7);}
        .workers-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:16px;align-content:start;overflow:auto;}
        .worker-square{aspect-ratio:1 / 1;padding:16px;border-radius:24px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));display:grid;grid-template-rows:auto auto auto 1fr;gap:10px;text-align:left;cursor:pointer;transition:transform .18s ease,border-color .18s ease, box-shadow .18s ease;}
        .worker-square:hover{transform:translateY(-2px);box-shadow:0 18px 40px rgba(0,0,0,.22);}
        .worker-square-active{border-color:rgba(215,181,109,.42);}
        .worker-square-top{display:flex;justify-content:space-between;align-items:flex-start;}
        .worker-square-avatar,.hero-avatar,.bubble-mini-avatar,.hero-avatar-large{display:grid;place-items:center;border-radius:999px;font-weight:900;color:#fff7ed;background:radial-gradient(circle at top, rgba(215,181,109,.88), rgba(107,33,168,.9));}
        .worker-square-avatar{width:52px;height:52px;}
        .hero-avatar{width:52px;height:52px;font-size:18px;}
        .hero-avatar-large{width:64px;height:64px;font-size:20px;margin-bottom:10px;}
        .bubble-mini-avatar{width:34px;height:34px;font-size:12px;flex:0 0 auto;}
        .status-dot{width:12px;height:12px;border-radius:999px;display:inline-block;}
        .worker-square-name{font-size:18px;font-weight:900;line-height:1.1;}
        .worker-square-team{font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;}
        .worker-square-status{font-size:12px;font-weight:800;}
        .worker-square-copy{font-size:13px;line-height:1.55;color:rgba(255,255,255,.76);align-self:end;}
        .conversation-head{align-items:center;}
        .conversation-ident{display:flex;align-items:center;gap:12px;min-width:0;}
        .back-btn{width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;display:none;place-items:center;cursor:pointer;}
        .messages-surface{flex:1;overflow-y:auto;padding:16px;}
        .empty-chat-box,.empty-box{border-radius:22px;border:1px dashed rgba(255,255,255,.14);background:rgba(255,255,255,.03);padding:22px;display:grid;place-items:center;text-align:center;gap:8px;color:rgba(255,255,255,.74);min-height:180px;}
        .empty-chat-title{font-size:20px;font-weight:900;}
        .bubble-row{display:flex;gap:10px;align-items:flex-end;}
        .bubble-row-mine{justify-content:flex-end;}
        .bubble{max-width:min(78%, 620px);padding:14px 16px;border-radius:20px;display:grid;gap:8px;font-size:14px;line-height:1.6;}
        .bubble-worker{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);}
        .bubble-mine{background:linear-gradient(135deg, rgba(139,92,246,.9), rgba(107,33,168,.88));border:1px solid rgba(168,85,247,.32);}
        .bubble-time{font-size:11px;color:rgba(255,255,255,.58);}
        .composer-shell{border-top:1px solid rgba(255,255,255,.06);background:#020617;padding:12px;}
        .composer{width:100%;min-height:120px;padding:16px;border-radius:22px;border:1px solid rgba(255,255,255,.08);background:rgba(2,6,23,.72);color:#fff;resize:none;outline:none;}
        .composer-footer{display:flex;justify-content:space-between;gap:12px;align-items:center;}
        .composer-hint{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.68);}
        .send-btn{height:50px;padding:0 18px;border:none;border-radius:16px;background:linear-gradient(135deg,#d7b56d,#8b5cf6);color:#fff;font-weight:900;display:inline-flex;align-items:center;gap:8px;cursor:pointer;}
        .send-btn.wide{width:100%;justify-content:center;}
        .locked-banner{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:14px 16px;border-radius:18px;border:1px solid rgba(215,181,109,.24);background:rgba(215,181,109,.12);}
        .locked-title{display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:900;}
        .modal-overlay{position:fixed;inset:0;background:rgba(2,6,23,.72);backdrop-filter:blur(10px);display:grid;place-items:center;padding:18px;z-index:50;}
        .welcome-modal{width:min(720px,100%);padding:22px;border-radius:28px;border:1px solid rgba(255,255,255,.08);background:rgba(10,14,29,.94);display:grid;gap:18px;box-shadow:0 32px 90px rgba(0,0,0,.38);}
        .welcome-head{display:flex;gap:14px;align-items:center;}
        .welcome-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
        .welcome-grid label{display:grid;gap:8px;}
        .welcome-grid label.full{grid-column:1 / -1;}
        .welcome-grid span{font-size:13px;color:rgba(255,255,255,.72);}
        .welcome-grid input,.welcome-grid select{height:50px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(2,6,23,.72);color:#fff;padding:0 14px;outline:none;}
        @media (max-width: 1100px){.chat-layout{grid-template-columns:360px minmax(0,1fr);}.workers-grid{grid-template-columns:1fr 1fr;}}
        @media (max-width: 860px){.chat-topbar{grid-template-columns:1fr;}.topbar-actions{justify-content:flex-start;}.chat-layout{grid-template-columns:1fr;min-height:auto;}.workers-panel,.conversation-panel{height:100%;}.mobile-hide{display:none;}

.mobile-hide-chat{
  display:none;
} .mobile-hide{display:none;} .mobile-hide-chat{display:none;} .back-btn{display:grid;} .workers-grid{grid-template-columns:1fr 1fr;} .summary-pill{min-width:unset;} .welcome-grid{grid-template-columns:1fr;} }
        @media (max-width: 560px){.chat-page-shell{padding:10px;} .brand-title{font-size:20px;} .workers-grid{grid-template-columns:1fr;} .worker-square{aspect-ratio:auto;min-height:220px;} .panel-head,.messages-surface,.composer-shell{padding:14px;} .bubble{max-width:88%;} .summary-pill{width:calc(50% - 5px);} .locked-banner,.composer-footer{flex-direction:column;align-items:stretch;} }
      `}</style>
    </div>
  );
}
