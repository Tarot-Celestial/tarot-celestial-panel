"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Clock3, Copy, History, Mic, MicOff, Minimize2, Phone, PhoneCall, PhoneIncoming, PhoneOff, RefreshCw, Settings2, Volume2, VolumeX, X } from "lucide-react";

const sb = supabaseBrowser();
const STORAGE_KEY = "tc_softphone_config_v3";

type PhoneConfig = {
  server: string;
  domain: string;
  username: string;
  password: string;
};

type CallHistoryItem = {
  id: string;
  number: string;
  direction: "incoming" | "outgoing" | "transfer";
  createdAt: string;
  result: string;
};

function formatDuration(totalSeconds: number) {
  const value = Math.max(0, Math.round(totalSeconds || 0));
  const hh = Math.floor(value / 3600);
  const mm = Math.floor((value % 3600) / 60);
  const ss = value % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function sanitizeNumber(value: string) {
  return String(value || "").replace(/[^0-9*#+]/g, "");
}

function loadStoredConfig(): PhoneConfig {
  if (typeof window === "undefined") {
    return {
      server: "wss://sip.clientestarotcelestial.es:8089/ws",
      domain: "sip.clientestarotcelestial.es",
      username: "",
      password: "",
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    return JSON.parse(raw);
  } catch {
    return {
      server: "wss://sip.clientestarotcelestial.es:8089/ws",
      domain: "sip.clientestarotcelestial.es",
      username: "",
      password: "",
    };
  }
}

function cardStyle(extra?: CSSProperties): CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(13,13,20,.92)",
    borderRadius: 22,
    backdropFilter: "blur(16px)",
    ...extra,
  };
}

export default function IPPhoneBar() {
  const simpleUserRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneLoopRef = useRef<number | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const historyRef = useRef<CallHistoryItem[]>([]);
  const callNumberRef = useRef("");
  const incomingNumberRef = useRef("");
  const inCallRef = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [status, setStatus] = useState<"offline" | "connecting" | "registered" | "calling" | "ringing" | "in_call" | "ended" | "error">("offline");
  const [statusText, setStatusText] = useState("Desconectado");
  const [number, setNumber] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [incomingNumber, setIncomingNumber] = useState("");
  const [callNumber, setCallNumber] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [msg, setMsg] = useState("");
  const [history, setHistory] = useState<CallHistoryItem[]>([]);
  const [config, setConfig] = useState<PhoneConfig>(loadStoredConfig());

  const registered = status === "registered" || status === "calling" || status === "ringing" || status === "in_call";
  const inCall = status === "calling" || status === "ringing" || status === "in_call";
  const visiblePeer = incoming ? incomingNumber : callNumber || number;

  useEffect(() => {
    setHydrated(true);
    setOpen(true);
    try {
      const raw = localStorage.getItem("tc_softphone_history_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          historyRef.current = parsed;
          setHistory(parsed);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("tc_softphone_history_v1", JSON.stringify(history.slice(0, 12)));
  }, [history, hydrated]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!callStartedAtRef.current) return setElapsed(0);
      setElapsed(Math.max(0, Math.round((Date.now() - callStartedAtRef.current) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    callNumberRef.current = callNumber;
    incomingNumberRef.current = incomingNumber;
    inCallRef.current = inCall;
  }, [callNumber, incomingNumber, inCall]);

  useEffect(() => {
    const onDial = async (event: Event) => {
      const detail = (event as CustomEvent<{ number?: string; label?: string }>).detail || {};
      const nextNumber = sanitizeNumber(detail.number || "");
      if (!nextNumber) return;
      setOpen(true);
      setCompact(false);
      setNumber(nextNumber);
      if (inCallRef.current) {
        const ok = await transfer(nextNumber);
        setMsg(ok ? `Transferencia enviada a ${nextNumber}.` : `No se pudo transferir a ${nextNumber}.`);
      } else {
        setMsg(`Extensión ${nextNumber} preparada para marcar.`);
      }
    };

    window.addEventListener("tc-softphone-dial", onDial as EventListener);
    return () => window.removeEventListener("tc-softphone-dial", onDial as EventListener);
  }, []);

  useEffect(() => {
    async function onKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable = target?.getAttribute("contenteditable") === "true";
      if (tag === "textarea" || editable) return;
      if (!open) return;

      if (tag !== "input") {
        if (/^[0-9]$/.test(event.key) || ["*", "#"].includes(event.key)) {
          event.preventDefault();
          setNumber((prev) => sanitizeNumber(prev + event.key));
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          setNumber((prev) => prev.slice(0, -1));
          return;
        }
      }

      if (event.key === "Enter" && !incoming && !inCall) {
        event.preventDefault();
        call();
      }
      if (event.key === "Escape" && (inCall || incoming)) {
        event.preventDefault();
        hangup();
      }
    }

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [open, incoming, inCall, number, config]);

  useEffect(() => {
    if (!config.username) return;
    syncRuntime({
      registered,
      status,
      active_call_count: inCall ? 1 : 0,
      active_call_started_at: callStartedAtRef.current ? new Date(callStartedAtRef.current).toISOString() : null,
      incoming_number: incoming ? incomingNumber || null : null,
      talking_to: visiblePeer || null,
    });
  }, [status, incomingNumber, callNumber, number, config.username, registered, inCall, visiblePeer, incoming]);

  function addHistory(item: Omit<CallHistoryItem, "id">) {
    const next: CallHistoryItem = { id: `${Date.now()}-${Math.random()}`, ...item };
    historyRef.current = [next, ...historyRef.current].slice(0, 12);
    setHistory(historyRef.current);
  }

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || "";
  }

  async function syncRuntime(payload: Record<string, any>) {
    try {
      const token = await getToken();
      if (!token || !config.username) return;
      await fetch("/api/operator/panel", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "update_runtime", extension: config.username, ...payload }),
      });
    } catch {
      // noop
    }
  }

  function playBeepSequence() {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioContextRef.current || new Ctx();
      audioContextRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => null);
      const now = ctx.currentTime;
      [0, 0.35, 0.7].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.10, now + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.24);
      });
    } catch {
      // noop
    }
  }

  function startRingtone() {
    stopRingtone();
    playBeepSequence();
    ringtoneLoopRef.current = window.setInterval(() => {
      playBeepSequence();
    }, 2300);
  }

  function stopRingtone() {
    try {
      if (ringtoneLoopRef.current) {
        window.clearInterval(ringtoneLoopRef.current);
        ringtoneLoopRef.current = null;
      }
    } catch {
      // noop
    }
  }

  function parseIncomingNumber(session: any) {
    try {
      const from = session?.remoteIdentity?.uri?.user || session?.request?.from?.uri?.user || session?.request?.from?.displayName || "";
      return String(from || "").trim();
    } catch {
      return "";
    }
  }

  async function hydrateFromPanel() {
    try {
      const token = await getToken();
      if (!token) throw new Error("No hay sesión activa.");
      const res = await fetch("/api/operator/panel", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo leer la configuración.");
      const mine = (json.extensions || []).find((item: any) => String(item.worker_id || "") === String(json.me?.id || "")) || json.extensions?.[0];
      if (!mine) throw new Error("No tienes extensión asignada todavía.");
      setConfig((prev) => ({
        ...prev,
        server: String(mine.ws_server || prev.server),
        domain: String(mine.domain || prev.domain),
        username: String(mine.extension || prev.username),
        password: String(mine.secret || prev.password),
      }));
      setMsg(`Configuración cargada desde panel: ${mine.extension}`);
    } catch (e: any) {
      setMsg(e?.message || "No se pudo cargar la configuración desde panel.");
    }
  }

  async function connect() {
    try {
      if (!config.server || !config.domain || !config.username || !config.password) {
        throw new Error("Completa servidor, dominio, extensión y password SIP.");
      }
      setStatus("connecting");
      setStatusText("Conectando…");
      setMsg("");

      try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        // si el navegador lo bloquea, seguimos y SIP.js volverá a pedirlo al contestar
      }

      const SIP: any = await import("sip.js");
      const SimpleUser = SIP?.Web?.SimpleUser || SIP?.SimpleUser || SIP?.default?.Web?.SimpleUser;
      if (!SimpleUser) throw new Error("No se pudo cargar SIP.js");

      const aor = `sip:${config.username}@${config.domain}`;
      const user = new SimpleUser(config.server, {
        aor,
        userAgentOptions: {
          uri: SIP.UserAgent.makeURI(aor),
          authorizationUsername: config.username,
          authorizationPassword: config.password,
          transportOptions: { server: config.server },
        },
        media: {
          constraints: { audio: true, video: false },
          remote: { audio: remoteAudioRef.current },
        },
      });

      user.delegate = {
        onCallCreated: () => {
          setOpen(true);
          setCompact(false);
          setStatus("calling");
          setStatusText("Llamando…");
        },
        onCallAnswered: () => {
          stopRingtone();
          callStartedAtRef.current = Date.now();
          setStatus("in_call");
          setStatusText("En llamada");
          setIncoming(false);
        },
        onCallHangup: () => {
          const endedNumber = incomingNumberRef.current || callNumberRef.current || number;
          stopRingtone();
          if (endedNumber) {
            addHistory({
              number: endedNumber,
              direction: incomingNumberRef.current ? "incoming" : "outgoing",
              createdAt: new Date().toISOString(),
              result: "finalizada",
            });
          }
          setIncoming(false);
          setIncomingNumber("");
          setCallNumber("");
          callStartedAtRef.current = null;
          setElapsed(0);
          setStatus("registered");
          setStatusText("Conectado");
        },
        onRegistered: () => {
          setStatus("registered");
          setStatusText("Conectado");
        },
        onServerConnect: () => {
          setStatusText("Conectando transporte…");
        },
        onServerDisconnect: () => {
          stopRingtone();
          setStatus("offline");
          setStatusText("Desconectado");
        },
        onCallReceived: (...args: any[]) => {
          const maybeSession = args?.[0];
          const caller = parseIncomingNumber(maybeSession);
          setOpen(true);
          setCompact(false);
          setIncoming(true);
          setIncomingNumber(caller);
          setStatus("ringing");
          setStatusText(caller ? `Llamada entrante · ${caller}` : "Llamada entrante");
          startRingtone();
          addHistory({
            number: caller || "Desconocido",
            direction: "incoming",
            createdAt: new Date().toISOString(),
            result: "entrante",
          });
        },
      };

      simpleUserRef.current = user;
      await user.connect();
      await user.register();
      setStatus("registered");
      setStatusText("Conectado");
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setStatusText(e?.message || "Error de conexión");
      setMsg(e?.message || "No se pudo conectar.");
    }
  }

  async function disconnect() {
    try {
      stopRingtone();
      await simpleUserRef.current?.disconnect();
      simpleUserRef.current = null;
      callStartedAtRef.current = null;
      setElapsed(0);
      setIncoming(false);
      setIncomingNumber("");
      setCallNumber("");
      setStatus("offline");
      setStatusText("Offline");
      await syncRuntime({ registered: false, status: "offline", active_call_count: 0, active_call_started_at: null, incoming_number: null, talking_to: null });
    } catch (e) {
      console.error(e);
    }
  }

  async function call() {
    const dialed = sanitizeNumber(number);
    if (!dialed || !simpleUserRef.current) return;
    try {
      setCallNumber(dialed);
      setStatus("calling");
      setStatusText(`Llamando a ${dialed}…`);
      await simpleUserRef.current.call(`sip:${dialed}@${config.domain}`);
      addHistory({ number: dialed, direction: "outgoing", createdAt: new Date().toISOString(), result: "saliente" });
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setStatusText(e?.message || "Error al llamar");
    }
  }

  async function answer() {
    try {
      stopRingtone();
      await simpleUserRef.current?.answer();
      setIncoming(false);
      callStartedAtRef.current = Date.now();
      setCallNumber(incomingNumber);
      setStatus("in_call");
      setStatusText("En llamada");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message || "No se pudo contestar.");
    }
  }

  async function hangup() {
    try {
      stopRingtone();
      await simpleUserRef.current?.hangup();
      setIncoming(false);
      setIncomingNumber("");
      setCallNumber("");
      callStartedAtRef.current = null;
      setElapsed(0);
      setStatus(registered ? "registered" : "ended");
      setStatusText(registered ? "Conectado" : "Colgado");
    } catch (e) {
      console.error(e);
    }
  }

  async function toggleMute() {
    try {
      const session = simpleUserRef.current?.session;
      if (!session?.sessionDescriptionHandler?.peerConnection) return;
      const pc = session.sessionDescriptionHandler.peerConnection;
      const senders = pc.getSenders?.() || [];
      const nextMuted = !muted;
      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track?.kind === "audio") sender.track.enabled = !nextMuted;
      });
      setMuted(nextMuted);
    } catch (e) {
      console.error(e);
    }
  }

  async function toggleSpeaker() {
    try {
      const next = !speakerOn;
      setSpeakerOn(next);
      if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
    } catch (e) {
      console.error(e);
    }
  }

  async function transfer(target: string) {
    try {
      const cleanTarget = sanitizeNumber(target);
      if (!cleanTarget) return false;
      const session = simpleUserRef.current?.session;
      if (!session) return false;
      if (typeof session.refer === "function") {
        await session.refer(`sip:${cleanTarget}@${config.domain}`);
      } else if (typeof simpleUserRef.current?.refer === "function") {
        await simpleUserRef.current.refer(`sip:${cleanTarget}@${config.domain}`);
      } else {
        return false;
      }
      addHistory({ number: cleanTarget, direction: "transfer", createdAt: new Date().toISOString(), result: "transferida" });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async function copyCurrentNumber() {
    const value = visiblePeer || number;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMsg(`Copiado: ${value}`);
    } catch {
      setMsg("No se pudo copiar el número.");
    }
  }

  const statusTone = useMemo(() => {
    if (status === "in_call" || status === "calling") return { dot: "#ff9f43", bg: "rgba(255,159,67,.16)" };
    if (status === "ringing") return { dot: "#ff5d7a", bg: "rgba(255,93,122,.16)" };
    if (registered) return { dot: "#59e39f", bg: "rgba(89,227,159,.16)" };
    return { dot: "rgba(255,255,255,.48)", bg: "rgba(255,255,255,.10)" };
  }, [status, registered]);

  if (!hydrated) return null;

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {incoming ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 151, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(4,4,10,.44)", backdropFilter: "blur(5px)", pointerEvents: "auto" }} />
          <div
            style={{
              ...cardStyle({
                position: "relative",
                zIndex: 152,
                width: "min(520px, calc(100vw - 24px))",
                padding: 24,
                boxShadow: "0 30px 80px rgba(0,0,0,.42)",
                pointerEvents: "auto",
              }),
            }}
          >
            <div style={{ fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.62)" }}>Llamada entrante</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: "#fff", marginTop: 10 }}>{incomingNumber || "Número oculto"}</div>
            <div style={{ marginTop: 10, color: "rgba(255,255,255,.72)" }}>Contesta o rechaza desde el centro de la pantalla para que sea imposible ignorarla.</div>
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button onClick={hangup} style={dangerBtnStyle}>
                <PhoneOff size={18} style={{ marginRight: 8 }} /> Rechazar
              </button>
              <button onClick={answer} style={goldBtnStyle}>
                <PhoneIncoming size={18} style={{ marginRight: 8 }} /> Contestar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 140,
          width: compact ? 320 : 390,
          maxWidth: "calc(100vw - 16px)",
          transition: "all .18s ease",
        }}
      >
        <div style={{ ...cardStyle(), overflow: "hidden", boxShadow: inCall ? "0 30px 80px rgba(0,0,0,.42)" : "0 20px 50px rgba(0,0,0,.28)" }}>
          <div style={{ padding: 14, borderBottom: "1px solid rgba(255,255,255,.08)", background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,0))" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 900 }}>
                  <PhoneCall size={16} /> Softphone Pro
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "6px 10px", background: statusTone.bg, fontSize: 12, fontWeight: 700 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: statusTone.dot, display: "inline-block" }} />
                    {statusText}
                  </span>
                </div>
                <div style={{ color: "rgba(255,255,255,.58)", fontSize: 12, marginTop: 5 }}>
                  {config.username ? `Ext. ${config.username}` : "Sin extensión cargada"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setHistoryOpen((v) => !v)} style={iconBtnStyle}><History size={16} /></button>
                <button onClick={() => setSettingsOpen((v) => !v)} style={iconBtnStyle}><Settings2 size={16} /></button>
                <button onClick={() => setCompact((v) => !v)} style={iconBtnStyle}>{compact ? <Phone size={16} /> : <Minimize2 size={16} />}</button>
                <button onClick={() => setOpen((v) => !v)} style={iconBtnStyle}><X size={16} /></button>
              </div>
            </div>
          </div>

          {open ? (
            <div style={{ padding: compact ? 12 : 14, display: "grid", gap: 12 }}>
              {msg ? <div style={{ color: "#fff", fontSize: 12, padding: "10px 12px", borderRadius: 14, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)" }}>{msg}</div> : null}

              {settingsOpen ? (
                <div style={{ ...cardStyle({ padding: 12, borderRadius: 18, background: "rgba(255,255,255,.03)" }) }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <button onClick={hydrateFromPanel} style={softBtnStyle}><RefreshCw size={14} style={{ marginRight: 6 }} /> Cargar desde panel</button>
                    <input value={config.username} onChange={(e) => setConfig((p) => ({ ...p, username: sanitizeNumber(e.target.value) }))} placeholder="Extensión" style={inputStyle} />
                    <input value={config.password} onChange={(e) => setConfig((p) => ({ ...p, password: e.target.value }))} placeholder="Password SIP" type="password" style={inputStyle} />
                    <input value={config.domain} onChange={(e) => setConfig((p) => ({ ...p, domain: e.target.value }))} placeholder="Dominio SIP" style={inputStyle} />
                    <input value={config.server} onChange={(e) => setConfig((p) => ({ ...p, server: e.target.value }))} placeholder="Servidor WSS" style={inputStyle} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {!registered ? (
                      <button onClick={connect} style={goldBtnStyle}><Phone size={16} style={{ marginRight: 8 }} /> Conectar</button>
                    ) : (
                      <button onClick={disconnect} style={dangerBtnStyle}><PhoneOff size={16} style={{ marginRight: 8 }} /> Desconectar</button>
                    )}
                  </div>
                </div>
              ) : null}

              <div style={{ ...cardStyle({ padding: compact ? 12 : 14, borderRadius: 20, background: inCall ? "rgba(255,159,67,.10)" : "rgba(255,255,255,.03)" }) }}>
                <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
                  {incoming ? "Entrante" : inCall ? "Conversación activa" : "Marcador"}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#fff", fontWeight: 900, fontSize: 28, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{visiblePeer || number || "—"}</div>
                    <div style={{ color: "rgba(255,255,255,.62)", fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <Clock3 size={13} /> {inCall ? formatDuration(elapsed) : "Listo para llamar"}
                    </div>
                  </div>
                  <button onClick={copyCurrentNumber} style={iconBtnStyle}><Copy size={16} /></button>
                </div>
              </div>

              {!compact ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    value={number}
                    onChange={(e) => setNumber(sanitizeNumber(e.target.value))}
                    placeholder="Escribe número o extensión con teclado"
                    style={{ ...inputStyle, fontSize: 20, textAlign: "center", fontWeight: 800 }}
                  />

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                    {["1","2","3","4","5","6","7","8","9","*","0","#"].map((digit) => (
                      <button key={digit} onClick={() => setNumber((prev) => sanitizeNumber(prev + digit))} style={dialBtnStyle}>{digit}</button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                {!inCall && !incoming ? (
                  <button onClick={call} disabled={!registered || !number} style={{ ...goldBtnStyle, opacity: !registered || !number ? 0.6 : 1 }}>
                    <Phone size={17} style={{ marginRight: 8 }} /> Llamar
                  </button>
                ) : null}
                {inCall || incoming ? (
                  <button onClick={hangup} style={dangerBtnStyle}><PhoneOff size={17} style={{ marginRight: 8 }} /> Colgar</button>
                ) : null}
                <button onClick={toggleMute} disabled={!inCall} style={{ ...softBtnStyle, opacity: !inCall ? 0.6 : 1 }}>
                  {muted ? <MicOff size={16} style={{ marginRight: 8 }} /> : <Mic size={16} style={{ marginRight: 8 }} />}
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button onClick={toggleSpeaker} style={softBtnStyle}>
                  {speakerOn ? <Volume2 size={16} style={{ marginRight: 8 }} /> : <VolumeX size={16} style={{ marginRight: 8 }} />}
                  Audio
                </button>
                <button onClick={() => setNumber((prev) => prev.slice(0, -1))} style={softBtnStyle}>⌫ Borrar</button>
              </div>

              {historyOpen ? (
                <div style={{ ...cardStyle({ padding: 12, borderRadius: 18, background: "rgba(255,255,255,.03)" }) }}>
                  <div style={{ color: "#fff", fontWeight: 800, marginBottom: 10 }}>Historial reciente</div>
                  <div style={{ display: "grid", gap: 8, maxHeight: 210, overflowY: "auto" }}>
                    {history.length ? history.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setNumber(sanitizeNumber(item.number))}
                        style={{
                          textAlign: "left",
                          borderRadius: 14,
                          border: "1px solid rgba(255,255,255,.10)",
                          background: "rgba(255,255,255,.04)",
                          padding: 10,
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <strong>{item.number}</strong>
                          <span style={{ color: "rgba(255,255,255,.58)", fontSize: 12 }}>{new Date(item.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div style={{ color: "rgba(255,255,255,.60)", fontSize: 12, marginTop: 4 }}>{item.direction} · {item.result}</div>
                      </button>
                    )) : <div style={{ color: "rgba(255,255,255,.58)", fontSize: 13 }}>Todavía no hay llamadas recientes.</div>}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <button onClick={() => setOpen(true)} style={{ width: "100%", padding: 14, background: "transparent", color: "#fff", border: 0, cursor: "pointer", fontWeight: 800 }}>
              Abrir softphone
            </button>
          )}
        </div>
      </div>
    </>
  );
}

const iconBtnStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.05)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.06)",
  color: "#fff",
  padding: "12px 14px",
  outline: "none",
};

const softBtnStyle: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.06)",
  color: "#fff",
  padding: "12px 14px",
  fontWeight: 800,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const goldBtnStyle: CSSProperties = {
  ...softBtnStyle,
  background: "linear-gradient(180deg, #f0d68d, #d7b56d)",
  color: "#201709",
  border: "1px solid rgba(215,181,109,.34)",
};

const dangerBtnStyle: CSSProperties = {
  ...softBtnStyle,
  background: "linear-gradient(180deg, #ff6e7f, #d54558)",
  color: "#fff",
  border: "1px solid rgba(255,95,125,.34)",
};

const dialBtnStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.05)",
  color: "#fff",
  fontWeight: 900,
  fontSize: 22,
  padding: "14px 0",
  cursor: "pointer",
};
