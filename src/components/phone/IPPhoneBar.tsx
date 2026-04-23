"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  Clock3,
  Copy,
  GripHorizontal,
  History,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  RefreshCw,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

const sb = supabaseBrowser();
const STORAGE_KEY = "tc_softphone_config_v4";
const HISTORY_STORAGE_KEY = "tc_softphone_history_v1";
const POSITION_STORAGE_KEY = "tc_softphone_position_v1";
const DEFAULT_SERVER = "wss://sip.clientestarotcelestial.es:8089/ws";
const DEFAULT_DOMAIN = "sip.clientestarotcelestial.es";

type PhoneStatus = "offline" | "connecting" | "registered" | "calling" | "ringing" | "in_call" | "ended" | "error";

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

type SoftphonePosition = { x: number; y: number };

type SipRuntime = {
  userAgent: any | null;
  registerer: any | null;
  activeSession: any | null;
  incomingInvitation: any | null;
  manualDisconnect: boolean;
  reconnectAttempts: number;
};

type ActiveClientContext = {
  cliente_id?: string | null;
  telefono?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  minutos_free_pendientes?: number | null;
  minutos_normales_pendientes?: number | null;
  tarotista_worker_id?: string | null;
  tarotista_nombre?: string | null;
  source?: string | null;
};

type PresenceInfo = {
  online: boolean;
  status: string;
  role?: string | null;
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

function normalizePhoneForSearch(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function loadStoredConfig(): PhoneConfig {
  const fallback = {
    server: DEFAULT_SERVER,
    domain: DEFAULT_DOMAIN,
    username: "",
    password: "",
  };

  if (typeof window === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function getDefaultPosition() {
  if (typeof window === "undefined") return { x: 18, y: 18 };
  return {
    x: Math.max(8, window.innerWidth - 408),
    y: Math.max(8, window.innerHeight - 540),
  };
}

function loadStoredPosition(): SoftphonePosition {
  if (typeof window === "undefined") return { x: 18, y: 18 };
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") throw new Error("invalid");
    return parsed;
  } catch {
    return getDefaultPosition();
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
  const sipModuleRef = useRef<any>(null);
  const runtimeRef = useRef<SipRuntime>({
    userAgent: null,
    registerer: null,
    activeSession: null,
    incomingInvitation: null,
    manualDisconnect: false,
    reconnectAttempts: 0,
  });
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneLoopRef = useRef<number | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const historyRef = useRef<CallHistoryItem[]>([]);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const connectingRef = useRef(false);
  const statusRef = useRef<PhoneStatus>("offline");
  const incomingNumberRef = useRef("");
  const callNumberRef = useRef("");
  const numberRef = useRef("");
  const callDirectionRef = useRef<"incoming" | "outgoing">("outgoing");
  const callAnsweredRef = useRef(false);
  const callFinalizedRef = useRef(false);
  const activeClientContextRef = useRef<ActiveClientContext | null>(null);
  const panelConfigHydratedRef = useRef(false);
  const crmPopupWindowRef = useRef<Window | null>(null);
  const dragStateRef = useRef<{ dragging: boolean; startX: number; startY: number; originX: number; originY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [status, setStatus] = useState<PhoneStatus>("offline");
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
  const [position, setPosition] = useState<SoftphonePosition>(loadStoredPosition());
  const [presence, setPresence] = useState<PresenceInfo>({ online: true, status: "working", role: null });
  const [incomingClientKnown, setIncomingClientKnown] = useState(false);
  const [incomingDisplayName, setIncomingDisplayName] = useState("");

  const registered = status === "registered" || status === "calling" || status === "ringing" || status === "in_call";
  const inCall = status === "calling" || status === "ringing" || status === "in_call";
  const crmDisplayName = [activeClientContextRef.current?.nombre, activeClientContextRef.current?.apellido].filter(Boolean).join(" ").trim();
  const visiblePeer = incoming ? (incomingDisplayName || incomingNumber) : crmDisplayName || callNumber || number;
  const showHangupButton = incoming || inCall || Boolean(runtimeRef.current.activeSession || runtimeRef.current.incomingInvitation);

  useEffect(() => {
    setHydrated(true);
    setOpen(true);
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        historyRef.current = parsed;
        setHistory(parsed);
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 12)));
  }, [history, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  }, [position, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (config.username && config.password) return;
    if (panelConfigHydratedRef.current) return;
    panelConfigHydratedRef.current = true;
    void hydrateFromPanel(true);
  }, [hydrated, config.username, config.password]);

  useEffect(() => {
    if (!hydrated) return;
    const shouldRegister = presence.online && presence.status === "working";
    if (!shouldRegister) return;
    if (!config.username || !config.password) return;
    if (runtimeRef.current.userAgent || connectingRef.current) return;
    void connect(true);
  }, [hydrated, presence.online, presence.status, config.username, config.password]);

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
    statusRef.current = status;
    incomingNumberRef.current = incomingNumber;
    callNumberRef.current = callNumber;
    numberRef.current = number;
  }, [status, incomingNumber, callNumber, number]);

  useEffect(() => {
    if (!config.username) return;
    syncRuntime({
      registered,
      status,
      active_call_count: showHangupButton ? 1 : 0,
      active_call_started_at: callStartedAtRef.current ? new Date(callStartedAtRef.current).toISOString() : null,
      incoming_number: incoming ? incomingNumber || null : null,
      talking_to: visiblePeer || null,
    });
  }, [status, incomingNumber, callNumber, number, config.username, registered, incoming, visiblePeer, showHangupButton]);

  useEffect(() => {
    return () => {
      stopRingtone();
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      void disconnect(true);
    };
  }, []);

  useEffect(() => {
    const onDial = async (event: Event) => {
      const detail = (event as CustomEvent<{ number?: string; label?: string; autoCall?: boolean; openFicha?: boolean }>).detail || {};
      const nextNumber = sanitizeNumber(detail.number || "");
      if (!nextNumber) return;
      setOpen(true);
      setCompact(false);
      setNumber(nextNumber);
      if (detail.autoCall && !showHangupButton) {
        window.setTimeout(() => {
          void call(nextNumber, { openFicha: detail.openFicha !== false });
        }, 120);
        return;
      }
      if (showHangupButton) {
        const ok = await transfer(nextNumber);
        setMsg(ok ? `Transferencia enviada a ${nextNumber}.` : `No se pudo transferir a ${nextNumber}.`);
      } else {
        setMsg(`Número ${nextNumber} preparado para marcar.`);
      }
    };

    window.addEventListener("tc-softphone-dial", onDial as EventListener);
    return () => window.removeEventListener("tc-softphone-dial", onDial as EventListener);
  }, [showHangupButton]);

  useEffect(() => {
    const onClientContext = (event: Event) => {
      const detail = (event as CustomEvent<ActiveClientContext>).detail || {};
      activeClientContextRef.current = {
        cliente_id: detail?.cliente_id ? String(detail.cliente_id) : null,
        telefono: detail?.telefono ? String(detail.telefono) : null,
        nombre: detail?.nombre ? String(detail.nombre) : null,
        apellido: detail?.apellido ? String(detail.apellido) : null,
        minutos_free_pendientes: Number(detail?.minutos_free_pendientes || 0) || 0,
        minutos_normales_pendientes: Number(detail?.minutos_normales_pendientes || 0) || 0,
        tarotista_worker_id: detail?.tarotista_worker_id ? String(detail.tarotista_worker_id) : null,
        tarotista_nombre: detail?.tarotista_nombre ? String(detail.tarotista_nombre) : null,
        source: detail?.source ? String(detail.source) : null,
      };
    };

    window.addEventListener("tc-softphone-client-context", onClientContext as EventListener);
    return () => window.removeEventListener("tc-softphone-client-context", onClientContext as EventListener);
  }, []);

  useEffect(() => {
    const onKeydown = async (event: KeyboardEvent) => {
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

      if (event.key === "Enter" && !incoming && !showHangupButton) {
        event.preventDefault();
        await call();
      }
      if (event.key === "Escape" && showHangupButton) {
        event.preventDefault();
        await hangup();
      }
    };

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [open, incoming, showHangupButton, number]);

  useEffect(() => {
    if (!hydrated) return;
    const id = window.setInterval(() => {
      if (runtimeRef.current.manualDisconnect) return;
      if (!config.username || !config.password || !config.domain || !config.server) return;
      const ua = runtimeRef.current.userAgent;
      const transportConnected = Boolean(ua?.transport && String(ua.transport.state || "").includes("Connected"));
      const hasActive = Boolean(runtimeRef.current.activeSession && isSessionAlive(runtimeRef.current.activeSession));
      if ((!ua || !transportConnected || ["offline", "error"].includes(statusRef.current)) && !connectingRef.current && !hasActive) {
        void connect(true);
      }
    }, 15000);
    return () => window.clearInterval(id);
  }, [hydrated, config.username, config.password, config.domain, config.server]);

  useEffect(() => {
    let cancelled = false;

    const syncPresence = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/attendance/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!json?.ok || cancelled) return;
        const nextPresence = {
          online: !!json.online,
          status: String(json.status || (json.online ? "working" : "offline")),
          role: json?.worker?.role ? String(json.worker.role) : null,
        };
        setPresence(nextPresence);
        const shouldRegister = nextPresence.online && nextPresence.status === "working";
        const hasCreds = Boolean(config.username && config.password);
        const isConnected = Boolean(runtimeRef.current.userAgent && runtimeRef.current.registerer);

        if (shouldRegister && !hasCreds && !connectingRef.current) {
          await hydrateFromPanel(true);
        }

        if (shouldRegister && !isConnected && !connectingRef.current && (config.username && config.password)) {
          void connect(true);
        }
        if (!shouldRegister && isConnected && !showHangupButton) {
          void disconnect(true);
          setStatus("offline");
          setStatusText(nextPresence.status === "offline" ? "Softphone pausado" : `Pausado · ${nextPresence.status}`);
        }
      } catch {
        // noop
      }
    };

    void syncPresence();
    const id = window.setInterval(syncPresence, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [config.username, config.password, showHangupButton]);

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

  function addHistory(item: Omit<CallHistoryItem, "id">) {
    const next: CallHistoryItem = { id: `${Date.now()}-${Math.random()}`, ...item };
    historyRef.current = [next, ...historyRef.current].slice(0, 12);
    setHistory(historyRef.current);
  }

  function parseIncomingNumber(session: any) {
    try {
      const fromHeader = session?.request?.getHeader?.("From") || session?.request?.from?.uri?.toString?.() || "";
      const headerMatch = String(fromHeader).match(/sip:(\+?\d+)/);
      if (headerMatch?.[1]) return headerMatch[1];

      const uri = session?.remoteIdentity?.uri?.toString?.();
      if (uri) {
        const match = String(uri).match(/sip:(\+?\d+)/);
        if (match?.[1]) return match[1];
      }

      const user = session?.remoteIdentity?.uri?.user;
      if (user && user !== "anonymous") return sanitizeNumber(user) || String(user);

      const display = session?.remoteIdentity?.displayName;
      if (display && display !== "Anonymous") {
        const clean = String(display).replace(/[^0-9+]/g, "");
        if (clean) return clean;
      }
    } catch {
      // noop
    }
    return "Número oculto";
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
        gain.gain.exponentialRampToValueAtTime(0.1, now + offset + 0.03);
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
    if (ringtoneLoopRef.current) {
      window.clearInterval(ringtoneLoopRef.current);
      ringtoneLoopRef.current = null;
    }
  }

  async function ensureRemoteAudioPlayback() {
    try {
      const el = remoteAudioRef.current;
      if (!el) return;
      el.autoplay = true;
      el.setAttribute("playsinline", "true");
      el.muted = !speakerOn;
      el.volume = 1;
      await el.play().catch(() => null);
    } catch {
      // noop
    }
  }

  function cleanupRemoteAudio() {
    const audio = remoteAudioRef.current;
    if (!audio) return;
    try {
      audio.pause();
    } catch {
      // noop
    }
    audio.srcObject = null;
  }

  function getSipStateValue(stateName: string) {
    return sipModuleRef.current?.SessionState?.[stateName];
  }

  function isSessionState(session: any, stateName: string) {
    if (!session) return false;
    const direct = getSipStateValue(stateName);
    if (direct !== undefined && session.state === direct) return true;
    const asString = String(session.state);
    return asString === stateName || asString.endsWith(`.${stateName}`);
  }

  function isSessionAlive(session: any) {
    return isSessionState(session, "Initial") || isSessionState(session, "Establishing") || isSessionState(session, "Established");
  }

  function getSessionPeerConnection(session: any) {
    return session?.sessionDescriptionHandler?.peerConnection || null;
  }

  function attachRemoteAudioFromSession(session: any) {
    try {
      const pc = getSessionPeerConnection(session);
      const audio = remoteAudioRef.current;
      if (!pc || !audio) return;

      const syncRemoteStream = async () => {
        try {
          const stream = new MediaStream();
          const receivers = pc.getReceivers?.() || [];
          for (const receiver of receivers) {
            const track = receiver?.track;
            if (track && track.kind === "audio") stream.addTrack(track);
          }
          if (!stream.getTracks().length) return;
          audio.srcObject = stream;
          await ensureRemoteAudioPlayback();
        } catch {
          // noop
        }
      };

      const onTrack = async (event: any) => {
        try {
          const [stream] = event?.streams || [];
          if (stream) {
            audio.srcObject = stream;
          } else {
            await syncRemoteStream();
            return;
          }
          await ensureRemoteAudioPlayback();
        } catch {
          // noop
        }
      };

      if (!pc.__tcSoftphoneTrackBound && typeof pc.addEventListener === "function") {
        pc.addEventListener("track", onTrack);
        pc.__tcSoftphoneTrackBound = true;
      }

      const handler = session?.sessionDescriptionHandler;
      if (handler && !handler.__tcSoftphoneDelegateBound) {
        handler.peerConnectionDelegate = {
          ...(handler.peerConnectionDelegate || {}),
          ontrack: onTrack,
        };
        handler.__tcSoftphoneDelegateBound = true;
      }

      void syncRemoteStream();
    } catch {
      // noop
    }
  }

  function resetCallState(nextStatus: PhoneStatus = "registered", nextText = "Conectado") {
    stopRingtone();
    cleanupRemoteAudio();
    callStartedAtRef.current = null;
    callAnsweredRef.current = false;
    callFinalizedRef.current = false;
    setElapsed(0);
    setIncoming(false);
    setIncomingNumber("");
    setIncomingDisplayName("");
    setIncomingClientKnown(false);
    setCallNumber("");
    setMuted(false);
    activeClientContextRef.current = null;
    setStatus(nextStatus);
    setStatusText(nextText);
  }

  function finalizeCall(resultOverride?: string) {
    if (callFinalizedRef.current) return;
    callFinalizedRef.current = true;

    const endedNumber = incomingNumberRef.current || callNumberRef.current || numberRef.current;
    const result =
      resultOverride ||
      (callAnsweredRef.current ? "finalizada" : callDirectionRef.current === "incoming" ? "perdida" : "fallida");

    if (endedNumber) {
      addHistory({
        number: endedNumber,
        direction: callDirectionRef.current,
        createdAt: new Date().toISOString(),
        result,
      });
    }

    const nextOnline = Boolean(runtimeRef.current.userAgent && runtimeRef.current.registerer);
    resetCallState(nextOnline ? "registered" : "offline", nextOnline ? "Conectado" : "Desconectado");
  }

  function cleanupSessionRefs(session?: any | null) {
    if (!session) {
      runtimeRef.current.activeSession = null;
      runtimeRef.current.incomingInvitation = null;
      return;
    }
    if (runtimeRef.current.activeSession === session) runtimeRef.current.activeSession = null;
    if (runtimeRef.current.incomingInvitation === session) runtimeRef.current.incomingInvitation = null;
  }

  function scheduleReconnect(reason = "Reconectando SIP…") {
    if (runtimeRef.current.manualDisconnect || !config.username || !config.password) return;
    if (reconnectTimeoutRef.current) return;

    const attempt = Math.min(runtimeRef.current.reconnectAttempts + 1, 6);
    runtimeRef.current.reconnectAttempts = attempt;
    const delay = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
    setStatus("connecting");
    setStatusText(reason);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      void connect(true);
    }, delay);
  }

  function buildSessionOptions() {
    return {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    };
  }

  async function bindSession(session: any, direction: "incoming" | "outgoing", peerNumber: string) {
    callDirectionRef.current = direction;
    callFinalizedRef.current = false;
    if (direction === "incoming") {
      runtimeRef.current.incomingInvitation = session;
    }
    runtimeRef.current.activeSession = session;

    try {
      const handler = session.stateChange;
      handler?.addListener?.((state: any) => {
        const established = isSessionState({ state }, "Established") || isSessionState(session, "Established");
        const terminated = isSessionState({ state }, "Terminated") || isSessionState(session, "Terminated");
        const establishing = isSessionState({ state }, "Establishing") || isSessionState(session, "Establishing");

        if (establishing && !callAnsweredRef.current) {
          setStatus(direction === "incoming" ? "ringing" : "calling");
        }

        if (established) {
          stopRingtone();
          callAnsweredRef.current = true;
          callStartedAtRef.current = callStartedAtRef.current || Date.now();
          setIncoming(false);
          setCallNumber(peerNumber);
          setStatus("in_call");
          setStatusText("En llamada");
          attachRemoteAudioFromSession(session);
          void ensureRemoteAudioPlayback();
        }

        if (terminated) {
          stopRingtone();
          cleanupSessionRefs(session);
          finalizeCall(callAnsweredRef.current ? "finalizada" : direction === "incoming" ? "perdida" : "fallida");
        }
      });
    } catch {
      // noop
    }
  }

  async function hydrateFromPanel(silent = false) {
    try {
      const token = await getToken();
      if (!token) throw new Error("No hay sesión activa.");
      const res = await fetch("/api/operator/panel", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo leer la configuración.");
      const mine =
        (json.extensions || []).find((item: any) => String(item.worker_id || "") === String(json.me?.id || "")) ||
        json.extensions?.[0];
      if (!mine) throw new Error("No tienes extensión asignada todavía.");
      setConfig((prev) => ({
  ...prev,
  username: String(mine?.extension || prev.username),
  password: String(mine?.password || prev.password),
}));
      panelConfigHydratedRef.current = true;
      if (!silent) setMsg(`Configuración cargada desde panel: ${mine.extension}`);
    } catch (e: any) {
      if (!silent) setMsg(e?.message || "No se pudo cargar la configuración desde panel.");
    }
  }

  async function connect(isReconnect = false) {
    if (connectingRef.current) return true;
    if (!config.username || !config.password || !config.domain || !config.server) {
      setStatus("error");
      setStatusText("Falta configuración SIP");
      setMsg("Completa extensión, password, dominio y servidor WSS.");
      return false;
    }

    try {
      const shouldRegister = presence.online && presence.status === "working";
      if (!shouldRegister && !isReconnect) {
        setStatus("offline");
        setStatusText(presence.status === "offline" ? "Softphone pausado" : `Pausado · ${presence.status}`);
        setMsg("El softphone sigue tu estado laboral y solo se registra cuando estás conectada.");
        return false;
      }
      connectingRef.current = true;
      runtimeRef.current.manualDisconnect = false;
      setStatus("connecting");
      setStatusText(isReconnect ? "Reconectando SIP…" : "Conectando SIP…");
      setMsg("");

      if (!sipModuleRef.current) {
        sipModuleRef.current = await import("sip.js");
      }
      const SIP = sipModuleRef.current;

      if (runtimeRef.current.userAgent) {
        await disconnect(true);
      }

      const uri = SIP.UserAgent.makeURI(`sip:${config.username}@${config.domain}`);
      if (!uri) throw new Error("URI SIP inválida");

    const userAgent = new SIP.UserAgent({
  uri,

  transportConstructor: SIP.WebSocketTransport, // 🔥 OK

  transportOptions: {
    server: config.server,
    traceSip: true,
    keepAliveInterval: 25,
  },

  authorizationUsername: config.username,
  authorizationPassword: config.password,

  // ✅ ESTO VA DENTRO
  sessionDescriptionHandlerFactoryOptions: {
    constraints: { audio: true, video: false },
    peerConnectionConfiguration: {
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    },
  },

  // ✅ ESTO TAMBIÉN
  delegate: {
    onInvite: async (invitation: any) => {
      try {
        if (runtimeRef.current.activeSession && isSessionAlive(runtimeRef.current.activeSession)) {
          await invitation.reject().catch(() => null);
          return;
        }

        const realCaller = parseIncomingNumber(invitation);
        const caller = presence.role === "tarotista" ? "Número oculto" : realCaller;

        callDirectionRef.current = "incoming";
        callAnsweredRef.current = false;
        callFinalizedRef.current = false;

        setOpen(true);
        setCompact(false);
        setIncoming(true);
        setIncomingNumber(caller);
        setIncomingDisplayName("");
        setIncomingClientKnown(false);
        setCallNumber(caller);
        setStatus("ringing");
        setStatusText(`Llamada entrante · ${caller}`);

        startRingtone();

        await bindSession(invitation, "incoming", caller);

        if (realCaller && realCaller !== "Número oculto") {
          void lookupClientContextByPhone(realCaller, { openCRM: false });
        }
      } catch (error) {
        console.error("Error gestionando onInvite", error);
        try {
          await invitation.reject().catch(() => null);
        } catch {}
      }
    },
  },
});

      const registerer = new SIP.Registerer(userAgent, {
        requestOptions: {
          extraHeaders: ["X-Softphone: TarotCelestial"],
        },
        expires: 90,
      });

      registerer.stateChange?.addListener?.((state: any) => {
        const txt = String(state || "");
        if (txt.includes("Registered")) {
          runtimeRef.current.reconnectAttempts = 0;
          setStatus((prev) => (prev === "in_call" || prev === "calling" || prev === "ringing" ? prev : "registered"));
          setStatusText((prev) => (prev === "En llamada" || prev.startsWith("Llamando") || prev.startsWith("Llamada entrante") ? prev : "Conectado"));
          return;
        }
        if (txt.includes("Unregistered") || txt.includes("Terminated")) {
          if (!runtimeRef.current.manualDisconnect) {
            scheduleReconnect("Registro SIP perdido. Reconectando…");
          }
        }
      });

      userAgent.transport.stateChange.addListener((state: any) => {
        const txt = String(state);
        if (txt.includes("Connected")) {
          runtimeRef.current.reconnectAttempts = 0;
          if (!showHangupButton && statusRef.current !== "registered") {
            setStatus("registered");
            setStatusText("Conectado");
          }
        }
        if (txt.includes("Disconnected")) {
          const hasActive = Boolean(runtimeRef.current.activeSession && isSessionAlive(runtimeRef.current.activeSession));
          if (hasActive) {
            setStatusText("Transporte SIP inestable · reintentando");
          } else {
            resetCallState("offline", "Transporte SIP caído");
          }
          scheduleReconnect("Reconectando transporte SIP…");
        }
      });

      await userAgent.start();
      await registerer.register();

      runtimeRef.current.userAgent = userAgent;
      runtimeRef.current.registerer = registerer;
      runtimeRef.current.reconnectAttempts = 0;
      setStatus("registered");
setStatusText("Conectado");
setMsg(isReconnect ? "Conexión SIP restaurada." : "Softphone conectado.");

await syncRuntime({
  registered: true,
  status: "registered",
  active_call_count: 0,
  active_call_started_at: null,
  incoming_number: null,
  talking_to: null,
});

return true;
    } catch (e: any) {
      console.error("Error conectando SIP", e);
      setStatus("error");
      setStatusText(e?.message || "No se pudo conectar");
      setMsg(e?.message || "No se pudo conectar la extensión SIP.");
      scheduleReconnect("Reintentando registro SIP…");
      return false;
    } finally {
      connectingRef.current = false;
    }
  }

  async function disconnect(silent = false) {
    try {
      runtimeRef.current.manualDisconnect = true;
      stopRingtone();
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const session = runtimeRef.current.activeSession || runtimeRef.current.incomingInvitation;
      if (session && isSessionAlive(session)) {
        try {
          if (isSessionState(session, "Established")) {
            await session.bye?.().catch(() => null);
          } else if (typeof session.cancel === "function") {
            await session.cancel().catch(() => null);
          } else if (typeof session.reject === "function") {
            await session.reject().catch(() => null);
          }
        } catch {
          // noop
        }
      }

      try {
        await runtimeRef.current.registerer?.unregister?.().catch(() => null);
      } catch {
        // noop
      }
      try {
        await runtimeRef.current.userAgent?.stop?.().catch(() => null);
      } catch {
        // noop
      }
    } catch (e) {
      console.error(e);
    } finally {
      runtimeRef.current.userAgent = null;
      runtimeRef.current.registerer = null;
      runtimeRef.current.activeSession = null;
      runtimeRef.current.incomingInvitation = null;
      cleanupRemoteAudio();
      if (!silent) {
        resetCallState("offline", "Offline");
      } else {
        setStatus("offline");
        setStatusText("Offline");
      }
      await syncRuntime({
        registered: false,
        status: "offline",
        active_call_count: 0,
        active_call_started_at: null,
        incoming_number: null,
        talking_to: null,
      });
    }
  }

  async function ensureReadyToCall() {
    if (!runtimeRef.current.userAgent || !runtimeRef.current.registerer) {
      const ok = await connect();
      if (!ok) return false;
    }

    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (["registered", "calling", "ringing", "in_call"].includes(statusRef.current)) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }

    return ["registered", "calling", "ringing", "in_call"].includes(statusRef.current);
  }

  function openCRMTabForClient(clienteId?: string | null, rawNumber?: string | null, mode: "associate" | "new" | "lookup" = "lookup") {
    const digits = normalizePhoneForSearch(rawNumber || "");
    const basePath = window.location.pathname.startsWith("/admin") ? "/admin" : "/panel-central";
    let url = `${basePath}?tab=crm`;
    if (clienteId) {
      url += `&open_cliente_id=${encodeURIComponent(String(clienteId))}`;
    } else if (digits) {
      url += `&telefono=${encodeURIComponent(digits)}`;
      if (mode === "new") url += `&new_cliente=1`;
      if (mode === "associate") url += `&associate_phone=1`;
    }
    const popup = window.open(url, "tc-crm-popup", "popup=yes,width=1420,height=960,left=60,top=40");
    crmPopupWindowRef.current = popup || null;
    window.setTimeout(() => {
      try {
        window.focus();
      } catch {
        // noop
      }
    }, 80);
  }

  async function lookupClientContextByPhone(rawNumber: string, options?: { openCRM?: boolean }) {
    try {
      const digits = normalizePhoneForSearch(rawNumber);
      if (!digits) return { found: false, cliente: null };
      const token = await getToken();
      if (!token) return { found: false, cliente: null };
      const res = await fetch(`/api/crm/clientes/buscar?telefono=${encodeURIComponent(digits)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) return { found: false, cliente: null };
      const cliente = Array.isArray(json?.clientes) ? json.clientes[0] : null;
      if (cliente) {
        activeClientContextRef.current = {
          cliente_id: cliente?.id ? String(cliente.id) : null,
          telefono: cliente?.telefono ? String(cliente.telefono) : digits,
          nombre: cliente?.nombre ? String(cliente.nombre) : null,
          apellido: cliente?.apellido ? String(cliente.apellido) : null,
          minutos_free_pendientes: Number(cliente?.minutos_free_pendientes || 0) || 0,
          minutos_normales_pendientes: Number(cliente?.minutos_normales_pendientes || 0) || 0,
          source: "lookup",
        };
        if (digits === normalizePhoneForSearch(incomingNumberRef.current || "")) {
          setIncomingClientKnown(true);
          setIncomingDisplayName([cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim());
        }
      } else if (digits === normalizePhoneForSearch(incomingNumberRef.current || "")) {
        setIncomingClientKnown(false);
        setIncomingDisplayName("");
      }
      if (options?.openCRM) {
        openCRMTabForClient(cliente?.id ? String(cliente.id) : null, digits, cliente ? "lookup" : "associate");
      }
      return { found: Boolean(cliente), cliente };
    } catch (e) {
      console.error("No se pudo buscar cliente", e);
      return { found: false, cliente: null };
    }
  }

  async function maybeOpenCRMForNumber(rawNumber: string) {
    await lookupClientContextByPhone(rawNumber, { openCRM: true });
  }

  async function dispatchTransferPopup(targetExtension: string, allocation?: { minutos_free_pendientes?: number; minutos_normales_pendientes?: number }) {
    try {
      const ctx = activeClientContextRef.current;
      const cleanTarget = sanitizeNumber(targetExtension);
      if (!ctx?.cliente_id || !cleanTarget) return { ok: false, reason: "missing_context" };

      const token = await getToken();
      if (!token) return { ok: false, reason: "no_auth" };

      const operatorRes = await fetch("/api/operator/panel", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const operatorJson = await operatorRes.json().catch(() => null);

const ext = Array.isArray(operatorJson?.extensions)
  ? operatorJson.extensions.find(
      (item: any) => String(item?.extension || "") === String(cleanTarget)
    )
  : null;

const tarotistaWorkerId =
  ctx?.tarotista_worker_id || ext?.worker_id || null;

if (!tarotistaWorkerId)
  return { ok: false, reason: "target_not_found" };


// ✅ BIEN: variables fuera del objeto
const minutosFree =
  allocation?.minutos_free_pendientes ??
  ctx.minutos_free_pendientes ??
  0;

const minutosNormales =
  allocation?.minutos_normales_pendientes ??
  ctx.minutos_normales_pendientes ??
  0;


// ✅ OBJETO LIMPIO
const payload = {
  tarotista_worker_id: String(tarotistaWorkerId),
  cliente_id: String(ctx.cliente_id),

  telefono: String(
  ctx.telefono ?? callNumberRef.current ?? numberRef.current ?? ""
),

  nombre: String(ctx.nombre ?? ""),
  apellido: String(ctx.apellido ?? ""),

  minutos_free_pendientes: Number(minutosFree),
  minutos_normales_pendientes: Number(minutosNormales),
};

      const popupRes = await fetch("/api/crm/call-popups/enviar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const popupJson = await popupRes.json().catch(() => null);
      return { ok: Boolean(popupJson?.ok), popup: popupJson?.popup || null, reason: popupJson?.error || null };
    } catch (error) {
      console.error("Error enviando popup de transferencia", error);
      return { ok: false, reason: "exception" };
    }
  }

  async function call(overrideNumber?: string, options?: { openFicha?: boolean }) {
    const dialed = sanitizeNumber(overrideNumber || number);
    if (!dialed) return;

    try {
      const ready = await ensureReadyToCall();
      if (!ready || !runtimeRef.current.userAgent) {
        setMsg("Softphone no conectado");
        setStatus("error");
        setStatusText("No se pudo registrar la extensión");
        return;
      }

      if (runtimeRef.current.activeSession && isSessionAlive(runtimeRef.current.activeSession)) {
        setMsg("Ya hay una llamada activa.");
        return;
      }

      const SIP = sipModuleRef.current || (sipModuleRef.current = await import("sip.js"));
      const target = SIP.UserAgent.makeURI(`sip:${dialed}@${config.domain}`);
      if (!target) throw new Error("Destino SIP inválido");

      const inviter = new SIP.Inviter(runtimeRef.current.userAgent, target, buildSessionOptions());
      await bindSession(inviter, "outgoing", dialed);

      callDirectionRef.current = "outgoing";
      callAnsweredRef.current = false;
      callFinalizedRef.current = false;
      setMsg("");
      setOpen(true);
      setCompact(false);
      setIncoming(false);
      setCallNumber(dialed);
      setStatus("calling");
      setStatusText(`Llamando a ${dialed}…`);

      await inviter.invite();
      attachRemoteAudioFromSession(inviter);
      await ensureRemoteAudioPlayback();

      if (options?.openFicha) {
        void maybeOpenCRMForNumber(dialed);
      }
    } catch (e: any) {
      console.error("Error en call:", e);
      cleanupSessionRefs();
      callAnsweredRef.current = false;
      callFinalizedRef.current = false;
      setCallNumber("");
      setStatus("error");
      setStatusText(e?.message || "Error al llamar");
      setMsg(e?.message || "La llamada no se pudo iniciar.");
      addHistory({
        number: dialed,
        direction: "outgoing",
        createdAt: new Date().toISOString(),
        result: "fallida",
      });
    }
  }

  async function answer() {
    try {
      const invitation = runtimeRef.current.incomingInvitation || runtimeRef.current.activeSession;
      if (!invitation) return;
      if (!isSessionState(invitation, "Initial") && !isSessionState(invitation, "Establishing")) {
        cleanupSessionRefs(invitation);
        finalizeCall("perdida");
        return;
      }

      await invitation.accept(buildSessionOptions());
      callAnsweredRef.current = true;
      callStartedAtRef.current = Date.now();
      setIncoming(false);
      setStatus("in_call");
      setStatusText("En llamada");
      attachRemoteAudioFromSession(invitation);
      await ensureRemoteAudioPlayback();
      void maybeOpenCRMForNumber(incomingNumberRef.current || callNumberRef.current);
    } catch (e: any) {
      console.error("Error al contestar:", e);
      setMsg(e?.message || "No se pudo contestar la llamada.");
      cleanupSessionRefs();
      finalizeCall("perdida");
    }
  }

  async function hangup() {
    try {
      const session = runtimeRef.current.activeSession || runtimeRef.current.incomingInvitation;
      if (!session) {
        finalizeCall("cancelada");
        return;
      }

      stopRingtone();
      if (isSessionState(session, "Established")) {
        await session.bye?.().catch(() => null);
      } else if (isSessionState(session, "Initial") || isSessionState(session, "Establishing")) {
        if (typeof session.cancel === "function") {
          await session.cancel().catch(() => null);
        } else if (typeof session.reject === "function") {
          await session.reject().catch(() => null);
        } else if (typeof session.bye === "function") {
          await session.bye().catch(() => null);
        }
      }

      cleanupSessionRefs(session);
      finalizeCall(callAnsweredRef.current ? "finalizada" : callDirectionRef.current === "incoming" ? "rechazada" : "cancelada");
    } catch (e) {
      console.error("Error al colgar:", e);
      cleanupSessionRefs();
      finalizeCall(callAnsweredRef.current ? "finalizada" : "cancelada");
    }
  }

  async function toggleMute() {
    try {
      const session = runtimeRef.current.activeSession;
      const pc = getSessionPeerConnection(session);
      if (!pc) return;
      const nextMuted = !muted;
      const senders = pc.getSenders?.() || [];
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
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = !next;
        if (next) await ensureRemoteAudioPlayback();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function transfer(target: string) {
    try {
      const cleanTarget = sanitizeNumber(target);
      if (!cleanTarget) return false;
      const session = runtimeRef.current.activeSession;
      if (!session || !isSessionAlive(session)) {
        setMsg("No hay una llamada activa para transferir.");
        return false;
      }
      if (!isSessionState(session, "Established")) {
        setMsg("La transferencia solo se puede lanzar cuando la llamada ya está conectada.");
        return false;
      }
      if (typeof session.refer !== "function") {
        setMsg("Tu sesión SIP no soporta transferencias REFER.");
        return false;
      }

      const token = await getToken();
      if (!token) {
        setMsg("Tu sesión ha caducado.");
        return false;
      }

      const operatorRes = await fetch("/api/operator/panel", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const operatorJson = await operatorRes.json().catch(() => null);
      const ext = Array.isArray(operatorJson?.extensions)
        ? operatorJson.extensions.find((item: any) => String(item?.extension || "") === String(cleanTarget))
        : null;
      const workers = Array.isArray(operatorJson?.workers) ? operatorJson.workers : [];
      const targetWorker = ext?.worker_id ? workers.find((item: any) => String(item?.id || "") === String(ext.worker_id)) : null;
      const targetRole = String(targetWorker?.role || "").toLowerCase();
      const isTarotistaTarget = targetRole === "tarotista";

      let allocation: { minutos_free_pendientes?: number; minutos_normales_pendientes?: number } | undefined;
      let popupResult: { ok?: boolean; reason?: string | null } | null = null;
      const ctx = activeClientContextRef.current;

      if (isTarotistaTarget && ctx?.cliente_id) {
        const freeAvail = Math.max(0, Number(ctx.minutos_free_pendientes || 0));
        const normalAvail = Math.max(0, Number(ctx.minutos_normales_pendientes || 0));
        const totalDisponibles = freeAvail + normalAvail;
        const asked = window.prompt(
          `¿Cuántos minutos quieres enviar a la tarotista ${cleanTarget}?\nSe consumirán primero los minutos free y luego los normales.`,
          String(totalDisponibles)
        );
        if (asked === null) return false;
        const totalAsignados = Math.max(0, Number(String(asked).replace(",", ".")) || 0);
        const usedFree = Math.min(freeAvail, totalAsignados);
        allocation = {
          minutos_free_pendientes: usedFree,
          minutos_normales_pendientes: Math.min(normalAvail, Math.max(0, totalAsignados - usedFree)),
        };
        popupResult = await dispatchTransferPopup(cleanTarget, allocation);
      }

      const confirmed = window.confirm(
        isTarotistaTarget
          ? `¿Transferir la llamada a la tarotista ${cleanTarget}?`
          : `¿Transferir la llamada a la central ${cleanTarget}?`
      );
      if (!confirmed) return false;

      const SIP = sipModuleRef.current || (sipModuleRef.current = await import("sip.js"));
      const referTarget = SIP.UserAgent.makeURI(`sip:${cleanTarget}@${config.domain}`);
      if (!referTarget) {
        setMsg("Destino SIP inválido para la transferencia.");
        return false;
      }

      await session.refer(referTarget);

      addHistory({
        number: cleanTarget,
        direction: "transfer",
        createdAt: new Date().toISOString(),
        result: popupResult?.ok ? "transferida + ficha" : "transferida",
      });

      if (isTarotistaTarget) {
        if (popupResult?.ok) {
          setMsg(`Transferencia enviada a ${cleanTarget}. Se consumirán primero los minutos free y luego los normales.`);
        } else if (ctx?.cliente_id) {
          setMsg(`Transferencia SIP enviada a ${cleanTarget}, pero el popup CRM falló (${String(popupResult?.reason || "sin detalle")}).`);
        } else {
          setMsg(`Transferencia SIP enviada a ${cleanTarget}.`);
        }
      } else {
        setMsg(`Transferencia SIP enviada a ${cleanTarget}.`);
      }
      return true;
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message || "No se pudo transferir la llamada.");
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

  function startDragging(event: any) {
    dragStateRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragStateRef.current.dragging) return;
      const nextX = dragStateRef.current.originX + (moveEvent.clientX - dragStateRef.current.startX);
      const nextY = dragStateRef.current.originY + (moveEvent.clientY - dragStateRef.current.startY);
      const width = compact ? 320 : 390;
      const maxX = Math.max(8, window.innerWidth - width - 8);
      const maxY = Math.max(8, window.innerHeight - 72);
      setPosition({
        x: Math.min(Math.max(8, nextX), maxX),
        y: Math.min(Math.max(8, nextY), maxY),
      });
    };

    const onUp = () => {
      dragStateRef.current.dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
            <div style={{ fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.62)" }}>
              Llamada entrante
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: "#fff", marginTop: 10 }}>{incomingDisplayName || incomingNumber || "Número oculto"}</div>
            <div style={{ marginTop: 10, color: "rgba(255,255,255,.72)" }}>
              Contesta o rechaza desde el centro de la pantalla para que sea imposible ignorarla.
            </div>
            <div style={{ marginTop: 8, color: "rgba(255,255,255,.62)", fontSize: 14 }}>
              {incomingDisplayName && incomingNumber ? incomingNumber : incomingClientKnown ? "Cliente identificado en agenda" : "Número sin identificar en CRM"}
            </div>

            {!incomingClientKnown && incomingNumber && incomingNumber !== "Número oculto" ? (
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <button className="tc-chip" type="button" onClick={() => openCRMTabForClient(null, incomingNumber, "associate")} style={{ cursor: "pointer" }}>
                  Asociar a cliente
                </button>
                <button className="tc-chip" type="button" onClick={() => openCRMTabForClient(null, incomingNumber, "new")} style={{ cursor: "pointer" }}>
                  Nuevo cliente
                </button>
              </div>
            ) : null}
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
          left: position.x,
          top: position.y,
          zIndex: 140,
          width: compact ? 320 : 390,
          maxWidth: "calc(100vw - 16px)",
          transition: dragStateRef.current.dragging ? "none" : "box-shadow .18s ease, width .18s ease",
        }}
      >
        <div style={{ ...cardStyle(), overflow: "hidden", boxShadow: inCall ? "0 30px 80px rgba(0,0,0,.42)" : "0 20px 50px rgba(0,0,0,.28)" }}>
          <div
            style={{
              padding: 14,
              borderBottom: "1px solid rgba(255,255,255,.08)",
              background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,0))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              cursor: open ? "grab" : "default",
              userSelect: "none",
            }}
            onMouseDown={startDragging}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
                <GripHorizontal size={16} /> Softphone SIP
              </div>
              <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: statusTone.dot, boxShadow: `0 0 0 6px ${statusTone.bg}` }} />
                {statusText}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
              <button onClick={() => setSettingsOpen((v) => !v)} style={iconBtnStyle}><Settings2 size={16} /></button>
              <button onClick={() => setHistoryOpen((v) => !v)} style={iconBtnStyle}><History size={16} /></button>
              <button onClick={() => setCompact((v) => !v)} style={iconBtnStyle}><Minimize2 size={16} /></button>
              <button onClick={() => setOpen((v) => !v)} style={iconBtnStyle}>{open ? <X size={16} /> : <PhoneCall size={16} />}</button>
            </div>
          </div>

          {open ? (
            <div style={{ padding: compact ? 12 : 14, display: "grid", gap: 12 }}>
              {msg ? (
                <div style={{ ...cardStyle({ padding: "10px 12px", borderRadius: 16, background: "rgba(255,255,255,.04)" }) }}>
                  <div style={{ color: "rgba(255,255,255,.82)", fontSize: 13 }}>{msg}</div>
                </div>
              ) : null}

             {settingsOpen ? (
  <div style={{ ...cardStyle({ padding: 12, borderRadius: 18, background: "rgba(255,255,255,.03)" }) }}>
    <div style={{ display: "grid", gap: 10 }}>

      <button onClick={() => hydrateFromPanel()} style={softBtnStyle}>
        <RefreshCw size={14} style={{ marginRight: 6 }} />
        Cargar desde panel
      </button>

      <input
        value={config.username}
        onChange={(e) =>
          setConfig((p) => ({
            ...p,
            username: sanitizeNumber(e.target.value),
          }))
        }
        placeholder="Extensión"
        style={inputStyle}
      />
                    <input
                      value={config.password}
                      onChange={(e) => setConfig((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Password SIP"
                      type="password"
                      style={inputStyle}
                    />
                    <input
                      value={config.domain}
                      onChange={(e) => setConfig((p) => ({ ...p, domain: e.target.value }))}
                      placeholder="Dominio SIP"
                      style={inputStyle}
                    />
                    <input
                      value={config.server}
                      onChange={(e) => setConfig((p) => ({ ...p, server: e.target.value }))}
                      placeholder="Servidor WSS"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {!registered ? (
                      <button onClick={() => void connect()} style={goldBtnStyle}>
                        <Phone size={16} style={{ marginRight: 8 }} /> Conectar
                      </button>
                    ) : (
                      <button onClick={() => void disconnect()} style={dangerBtnStyle}>
                        <PhoneOff size={16} style={{ marginRight: 8 }} /> Desconectar
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  ...cardStyle({
                    padding: compact ? 12 : 14,
                    borderRadius: 20,
                    background: inCall ? "rgba(255,159,67,.10)" : "rgba(255,255,255,.03)",
                  }),
                }}
              >
                <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
                  {incoming ? "Entrante" : inCall ? "Conversación activa" : "Marcador"}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "#fff",
                        fontWeight: 900,
                        fontSize: 28,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {visiblePeer || number || "—"}
                    </div>
                    <div style={{ color: "rgba(255,255,255,.62)", fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <Clock3 size={13} /> {showHangupButton ? formatDuration(elapsed) : "Listo para llamar"}
                    </div>
                  </div>
                  <button onClick={copyCurrentNumber} style={iconBtnStyle}>
                    <Copy size={16} />
                  </button>
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
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit) => (
                      <button key={digit} onClick={() => setNumber((prev) => sanitizeNumber(prev + digit))} style={dialBtnStyle}>
                        {digit}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : `repeat(${showHangupButton ? 5 : 4}, minmax(0, 1fr))`, gap: 8 }}>
                {!showHangupButton ? (
                  <button onClick={() => void call()} disabled={!registered || !number} style={{ ...goldBtnStyle, opacity: !registered || !number ? 0.6 : 1 }}>
                    <Phone size={17} style={{ marginRight: 8 }} /> Llamar
                  </button>
                ) : (
                  <button onClick={() => void hangup()} style={dangerBtnStyle}>
                    <PhoneOff size={17} style={{ marginRight: 8 }} /> Colgar
                  </button>
                )}
                <button onClick={() => void toggleMute()} disabled={!showHangupButton} style={{ ...softBtnStyle, opacity: !showHangupButton ? 0.6 : 1 }}>
                  {muted ? <MicOff size={16} style={{ marginRight: 8 }} /> : <Mic size={16} style={{ marginRight: 8 }} />}
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button onClick={() => void toggleSpeaker()} style={softBtnStyle}>
                  {speakerOn ? <Volume2 size={16} style={{ marginRight: 8 }} /> : <VolumeX size={16} style={{ marginRight: 8 }} />}
                  Audio
                </button>
                {showHangupButton ? (
                  <button onClick={() => void transfer(number)} disabled={!number} style={{ ...softBtnStyle, opacity: number ? 1 : 0.6 }}>
                    Transferir
                  </button>
                ) : null}
                <button onClick={() => setNumber((prev) => prev.slice(0, -1))} style={softBtnStyle}>
                  ⌫ Borrar
                </button>
              </div>

              {historyOpen ? (
                <div style={{ ...cardStyle({ padding: 12, borderRadius: 18, background: "rgba(255,255,255,.03)" }) }}>
                  <div style={{ color: "#fff", fontWeight: 800, marginBottom: 10 }}>Historial reciente</div>
                  <div style={{ display: "grid", gap: 8, maxHeight: 210, overflowY: "auto" }}>
                    {history.length ? (
                      history.map((item) => (
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
                            <span style={{ color: "rgba(255,255,255,.58)", fontSize: 12 }}>
                              {new Date(item.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div style={{ color: "rgba(255,255,255,.60)", fontSize: 12, marginTop: 4 }}>
                            {item.direction} · {item.result}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div style={{ color: "rgba(255,255,255,.58)", fontSize: 13 }}>Todavía no hay llamadas recientes.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              onClick={() => setOpen(true)}
              style={{ width: "100%", padding: 14, background: "transparent", color: "#fff", border: 0, cursor: "pointer", fontWeight: 800 }}
            >
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
