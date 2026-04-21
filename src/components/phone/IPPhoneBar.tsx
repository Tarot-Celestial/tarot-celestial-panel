"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Copy, Mic, MicOff, Minimize2, Phone, PhoneCall, PhoneIncoming, PhoneOff, Settings2, Volume2, VolumeX, X } from "lucide-react";

const sb = supabaseBrowser();
const STORAGE_KEY = "tc_softphone_config_v2";

type PhoneConfig = {
  server: string;
  domain: string;
  username: string;
  password: string;
};

type CallHistoryItem = {
  id: string;
  number: string;
  direction: "incoming" | "outgoing";
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
  return String(value || "").replace(/[^0-9*#]/g, "");
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

export default function IPPhoneBar() {
  const simpleUserRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneLoopRef = useRef<number | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const historyRef = useRef<CallHistoryItem[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [number, setNumber] = useState("");
  const [status, setStatus] = useState<"offline" | "connecting" | "registered" | "ringing" | "calling" | "in_call" | "ended" | "error">("offline");
  const [statusText, setStatusText] = useState("Offline");
  const [incoming, setIncoming] = useState(false);
  const [incomingNumber, setIncomingNumber] = useState("");
  const [callNumber, setCallNumber] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<CallHistoryItem[]>([]);
  const [config, setConfig] = useState<PhoneConfig>(loadStoredConfig);

  const inCall = status === "in_call" || status === "calling" || status === "ringing";
  const displayNumber = useMemo(() => incomingNumber || callNumber || number, [incomingNumber, callNumber, number]);

  useEffect(() => {
    setHydrated(true);
    try {
      const saved = loadStoredConfig();
      setConfig(saved);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, hydrated]);

  useEffect(() => {
    async function prefillAssignedExtension() {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/operator/panel", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) return;
        const myWorkerId = String(json?.me?.id || "");
        const assigned = (Array.isArray(json?.extensions) ? json.extensions : []).find((item: any) => String(item?.worker_id || "") === myWorkerId);
        if (!assigned) return;
        setConfig((prev) => ({
          server: prev.server || String(assigned.ws_server || ""),
          domain: prev.domain || String(assigned.domain || ""),
          username: prev.username || String(assigned.extension || ""),
          password: prev.password || String(assigned.secret || ""),
        }));
      } catch {
        // noop
      }
    }

    if (hydrated) prefillAssignedExtension();
  }, [hydrated]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!callStartedAtRef.current) {
        setElapsed(0);
        return;
      }
      setElapsed(Math.max(0, Math.round((Date.now() - callStartedAtRef.current) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    async function onKeydown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (!open) return;

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
      if (event.key === "Enter" && !incoming && !inCall) {
        event.preventDefault();
        call();
      }
      if (event.key === "Escape" && inCall) {
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
      registered: status === "registered" || status === "calling" || status === "ringing" || status === "in_call",
      status,
      active_call_count: status === "calling" || status === "ringing" || status === "in_call" ? 1 : 0,
      active_call_started_at: callStartedAtRef.current ? new Date(callStartedAtRef.current).toISOString() : null,
      incoming_number: incomingNumber || null,
    });
  }, [status, incomingNumber, config.username]);

  function addHistory(item: Omit<CallHistoryItem, "id">) {
    const next: CallHistoryItem = { id: `${Date.now()}-${Math.random()}`, ...item };
    historyRef.current = [next, ...historyRef.current].slice(0, 8);
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
      const now = ctx.currentTime;
      [0, 0.28].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.08, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      });
    } catch {
      // noop
    }
  }

  function startRingtone() {
    try {
      playBeepSequence();
      if (ringAudioRef.current) {
        ringAudioRef.current.currentTime = 0;
        ringAudioRef.current.volume = 1;
        ringAudioRef.current.play().catch(() => null);
      }
      if (ringtoneLoopRef.current) window.clearInterval(ringtoneLoopRef.current);
      ringtoneLoopRef.current = window.setInterval(() => {
        playBeepSequence();
        ringAudioRef.current?.play().catch(() => null);
      }, 3500);
    } catch {
      // noop
    }
  }

  function stopRingtone() {
    try {
      if (ringtoneLoopRef.current) {
        window.clearInterval(ringtoneLoopRef.current);
        ringtoneLoopRef.current = null;
      }
      if (ringAudioRef.current) {
        ringAudioRef.current.pause();
        ringAudioRef.current.currentTime = 0;
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

  async function connect() {
    try {
      setStatus("connecting");
      setStatusText("Conectando…");
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
          remote: { audio: audioRef.current },
        },
      });

      user.delegate = {
        onCallCreated: () => {
          setOpen(true);
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
          stopRingtone();
          const endedNumber = incomingNumber || callNumber || number;
          if (endedNumber) {
            addHistory({
              number: endedNumber,
              direction: incoming ? "incoming" : "outgoing",
              createdAt: new Date().toISOString(),
              result: "colgada",
            });
          }
          setIncoming(false);
          setIncomingNumber("");
          setCallNumber("");
          callStartedAtRef.current = null;
          setElapsed(0);
          setStatus("ended");
          setStatusText("Colgado");
        },
        onRegistered: () => {
          setStatus("registered");
          setStatusText("Conectado");
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
      await syncRuntime({ registered: false, status: "offline", active_call_count: 0, active_call_started_at: null, incoming_number: null });
    } catch (e) {
      console.error(e);
    }
  }

  async function call() {
    if (!number || !simpleUserRef.current) return;
    try {
      setCallNumber(number);
      setStatus("calling");
      setStatusText(`Llamando a ${number}…`);
      await simpleUserRef.current.call(`sip:${number}@${config.domain}`);
      addHistory({ number, direction: "outgoing", createdAt: new Date().toISOString(), result: "saliente" });
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
    } catch (e) {
      console.error(e);
    }
  }

  async function hangup() {
    try {
      stopRingtone();
      await simpleUserRef.current?.hangup();
      setIncoming(false);
      setIncomingNumber("");
      callStartedAtRef.current = null;
      setElapsed(0);
      setStatus("ended");
      setStatusText("Colgado");
    } catch (e) {
      console.error(e);
    }
  }

  async function toggleMute() {
    try {
      const session = simpleUserRef.current?.session;
      const pc = session?.sessionDescriptionHandler?.peerConnection;
      const senders = pc?.getSenders?.() || [];
      const next = !isMuted;
      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track?.kind === "audio") sender.track.enabled = !next;
      });
      setIsMuted(next);
    } catch (e) {
      console.error(e);
    }
  }

  function toggleSpeaker() {
    const next = !isSpeakerMuted;
    setIsSpeakerMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  }

  async function copyCurrentNumber() {
    try {
      if (!displayNumber) return;
      await navigator.clipboard.writeText(displayNumber);
      setStatusText(`Número copiado: ${displayNumber}`);
    } catch {
      setStatusText("No se pudo copiar el número");
    }
  }

  function addDigit(value: string) {
    setNumber((prev) => sanitizeNumber(prev + value));
  }

  function backspace() {
    setNumber((prev) => prev.slice(0, -1));
  }

  if (!hydrated) return null;

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      <audio
        ref={ringAudioRef}
        preload="auto"
        src="data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAAEAAP//AAD//wAA//8AAP//AAD//wAA"
      />

      {!open ? (
        <button onClick={() => setOpen(true)} style={styles.floatingBtn} title="Abrir softphone">
          <Phone size={20} />
        </button>
      ) : null}

      {open ? (
        <div style={{ ...styles.container, width: compact && !incoming && !inCall ? 330 : 380 }}>
          <div style={styles.header}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Softphone Pro</div>
              <div style={{ color: "rgba(255,255,255,.66)", fontSize: 12 }}>{statusText}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={styles.iconBtn} onClick={() => setShowConfig((v) => !v)} title="Configuración"><Settings2 size={16} /></button>
              <button style={styles.iconBtn} onClick={() => setCompact((v) => !v)} title="Minimizar"><Minimize2 size={16} /></button>
              <button style={styles.iconBtn} onClick={() => setOpen(false)} title="Cerrar"><X size={16} /></button>
            </div>
          </div>

          {showConfig ? (
            <div style={styles.configCard}>
              <div style={styles.grid2}>
                <input style={styles.input} placeholder="Usuario / extensión" value={config.username} onChange={(e) => setConfig((prev) => ({ ...prev, username: sanitizeNumber(e.target.value) }))} />
                <input style={styles.input} placeholder="Password SIP" type="password" value={config.password} onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))} />
              </div>
              <input style={styles.input} placeholder="Dominio SIP" value={config.domain} onChange={(e) => setConfig((prev) => ({ ...prev, domain: e.target.value }))} />
              <input style={styles.input} placeholder="Servidor WSS" value={config.server} onChange={(e) => setConfig((prev) => ({ ...prev, server: e.target.value }))} />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...styles.primaryBtn, flex: 1 }} onClick={connect}>Conectar</button>
                <button style={{ ...styles.secondaryBtn, flex: 1 }} onClick={disconnect}>Desconectar</button>
              </div>
            </div>
          ) : null}

          {incoming ? (
            <div style={styles.incomingPopup}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <PhoneIncoming size={18} />
                <div>
                  <div style={{ fontWeight: 900 }}>Llamada entrante</div>
                  <div style={{ color: "rgba(255,255,255,.72)", fontSize: 13 }}>{incomingNumber || "Número oculto"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...styles.primaryBtn, flex: 1 }} onClick={answer}>Aceptar</button>
                <button style={{ ...styles.dangerBtn, flex: 1 }} onClick={hangup}>Rechazar</button>
              </div>
            </div>
          ) : null}

          {!compact || incoming || inCall ? (
            <>
              <div style={styles.displayCard}>
                <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12 }}>Número</div>
                <input
                  style={styles.displayInput}
                  value={number}
                  onChange={(e) => setNumber(sanitizeNumber(e.target.value))}
                  placeholder="Escribe con teclado o pulsa abajo"
                  inputMode="tel"
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <div style={{ color: "rgba(255,255,255,.72)", fontSize: 12 }}>
                    {inCall ? `Duración: ${formatDuration(elapsed)}` : config.username ? `Extensión ${config.username}` : "Sin configurar"}
                  </div>
                  <button style={styles.iconBtn} onClick={copyCurrentNumber} title="Copiar número"><Copy size={15} /></button>
                </div>
              </div>

              {inCall ? (
                <div style={styles.callPopup}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}><PhoneCall size={18} /> En llamada</div>
                      <div style={{ fontSize: 14, color: "rgba(255,255,255,.76)", marginTop: 4 }}>{displayNumber || "Sin número"}</div>
                    </div>
                    <span style={styles.badge}>{formatDuration(elapsed)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button style={styles.secondaryBtn} onClick={copyCurrentNumber}><Copy size={15} style={{ marginRight: 6 }} /> Copiar</button>
                    <button style={styles.secondaryBtn} onClick={toggleMute}>{isMuted ? <MicOff size={15} style={{ marginRight: 6 }} /> : <Mic size={15} style={{ marginRight: 6 }} />}{isMuted ? "Activar mic" : "Mute"}</button>
                    <button style={styles.secondaryBtn} onClick={toggleSpeaker}>{isSpeakerMuted ? <VolumeX size={15} style={{ marginRight: 6 }} /> : <Volume2 size={15} style={{ marginRight: 6 }} />}{isSpeakerMuted ? "Audio off" : "Audio on"}</button>
                    <button style={styles.dangerBtn} onClick={hangup}><PhoneOff size={15} style={{ marginRight: 6 }} /> Colgar</button>
                  </div>
                </div>
              ) : null}

              <div style={styles.keypad}>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit) => (
                  <button key={digit} style={styles.key} onClick={() => addDigit(digit)}>{digit}</button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...styles.primaryBtn, flex: 1 }} onClick={call}><Phone size={16} style={{ marginRight: 6 }} /> Llamar</button>
                <button style={{ ...styles.dangerBtn, flex: 1 }} onClick={hangup}><PhoneOff size={16} style={{ marginRight: 6 }} /> Colgar</button>
                <button style={{ ...styles.secondaryBtn, width: 60 }} onClick={backspace}>⌫</button>
              </div>

              {!!history.length ? (
                <div style={styles.historyWrap}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Historial reciente</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {history.map((item) => (
                      <button key={item.id} style={styles.historyItem} onClick={() => setNumber(sanitizeNumber(item.number))}>
                        <div style={{ fontWeight: 700 }}>{item.number}</div>
                        <div style={{ color: "rgba(255,255,255,.66)", fontSize: 12 }}>{item.direction === "incoming" ? "Entrante" : "Saliente"} · {item.result}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ marginTop: 14, color: "rgba(255,255,255,.72)", fontSize: 13 }}>
              Widget minimizado. Vuelve a abrirlo para marcar, responder o ver el popup de llamada.
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  floatingBtn: {
    position: "fixed",
    right: 22,
    bottom: 22,
    width: 58,
    height: 58,
    borderRadius: 999,
    border: "1px solid rgba(215,181,109,.35)",
    background: "linear-gradient(135deg, rgba(215,181,109,.95), rgba(139,92,246,.82))",
    color: "#180f05",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    boxShadow: "0 16px 44px rgba(0,0,0,.45)",
    zIndex: 1000,
  },
  container: {
    position: "fixed",
    right: 20,
    bottom: 20,
    padding: 16,
    borderRadius: 24,
    border: "1px solid rgba(255,255,255,.12)",
    background: "linear-gradient(180deg, rgba(10,8,16,.96), rgba(17,16,24,.94))",
    color: "white",
    boxShadow: "0 26px 80px rgba(0,0,0,.55)",
    zIndex: 1000,
    backdropFilter: "blur(14px)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "white",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  configCard: {
    display: "grid",
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.10)",
    background: "rgba(255,255,255,.04)",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  input: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.05)",
    color: "white",
    padding: "12px 13px",
    outline: "none",
  },
  primaryBtn: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(244,216,159,.42)",
    background: "linear-gradient(135deg, rgba(244,216,159,.94), rgba(215,181,109,.88))",
    color: "#221405",
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtn: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.16)",
    background: "rgba(255,255,255,.07)",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 12px",
  },
  dangerBtn: {
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(255,90,106,.32)",
    background: "rgba(255,90,106,.14)",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 12px",
  },
  incomingPopup: {
    marginTop: 14,
    borderRadius: 18,
    border: "1px solid rgba(255,90,106,.30)",
    background: "rgba(255,90,106,.12)",
    padding: 14,
  },
  displayCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.10)",
    background: "rgba(255,255,255,.04)",
  },
  displayInput: {
    width: "100%",
    background: "transparent",
    border: "none",
    color: "white",
    fontSize: 22,
    fontWeight: 800,
    marginTop: 4,
    outline: "none",
  },
  callPopup: {
    marginTop: 14,
    borderRadius: 18,
    border: "1px solid rgba(105,240,177,.24)",
    background: "rgba(105,240,177,.08)",
    padding: 14,
  },
  badge: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(0,0,0,.18)",
    fontWeight: 900,
    fontSize: 12,
  },
  keypad: {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
  },
  key: {
    height: 54,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.05)",
    color: "white",
    cursor: "pointer",
    fontSize: 18,
    fontWeight: 900,
  },
  historyWrap: {
    marginTop: 14,
    borderTop: "1px solid rgba(255,255,255,.08)",
    paddingTop: 14,
  },
  historyItem: {
    width: "100%",
    textAlign: "left",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.10)",
    background: "rgba(255,255,255,.04)",
    color: "white",
    padding: 10,
    cursor: "pointer",
  },
};
