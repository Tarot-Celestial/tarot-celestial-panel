"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, PhoneCall, PhoneIncoming, PhoneOff, Save, Settings2 } from "lucide-react";

type SipConfig = {
  server: string;
  domain: string;
  username: string;
  password: string;
  displayName: string;
  autoRegister: boolean;
};

type SipStatus = "idle" | "connecting" | "registered" | "calling" | "incoming" | "in-call" | "error";

const STORAGE_KEY = "tc-ip-phone-config-v2";
const LEGACY_STORAGE_KEY = "tc-ip-phone-config-v1";
const DEFAULT_CONFIG: SipConfig = {
  server: "",
  domain: "",
  username: "",
  password: "",
  displayName: "",
  autoRegister: true,
};

function stripProtocol(value: string) {
  return String(value || "")
    .trim()
    .replace(/^sips?:/i, "")
    .replace(/^wss?:\/\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/ws$/i, "")
    .replace(/\/$/, "");
}

function normalizeDomain(raw: string) {
  const value = stripProtocol(raw);
  if (!value) return "";
  if (value.includes("@")) {
    return value.split("@").pop()?.trim() || "";
  }
  return value;
}

function normalizeUsername(raw: string) {
  return String(raw || "").trim().replace(/^sip:/i, "").replace(/@.*$/, "");
}

function normalizeServer(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^wss?:\/\//i.test(value)) return value;
  return `wss://${stripProtocol(value)}`;
}

function normalizeLoadedConfig(raw: Partial<SipConfig> | null | undefined): SipConfig {
  const incoming = raw || {};
  return {
    server: normalizeServer(String(incoming.server || "")),
    domain: normalizeDomain(String(incoming.domain || "")),
    username: normalizeUsername(String(incoming.username || "")),
    password: String(incoming.password || ""),
    displayName: String(incoming.displayName || ""),
    autoRegister: incoming.autoRegister !== false,
  };
}

function buildAor(username: string, domain: string) {
  const safeUser = normalizeUsername(username);
  const safeDomain = normalizeDomain(domain);
  if (!safeUser || !safeDomain) return "";
  return `sip:${safeUser}@${safeDomain}`;
}

function sanitizeDestination(raw: string, domain: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("sip:")) return value;
  if (value.includes("@")) return `sip:${value.replace(/^sip:/i, "")}`;

  const safeDomain = normalizeDomain(domain);
  const normalizedNumber = value.replace(/[^\d+*#]/g, "");
  if (!safeDomain) return normalizedNumber;

  if (normalizedNumber.startsWith("+")) {
    return `sip:${normalizedNumber.slice(1)}@${safeDomain}`;
  }

  return `sip:${normalizedNumber}@${safeDomain}`;
}

export default function IPPhoneBar() {
  const simpleUserRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSignatureRef = useRef("");
  const [config, setConfig] = useState<SipConfig>(DEFAULT_CONFIG);
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState<SipStatus>("idle");
  const [message, setMessage] = useState("Teléfono IP listo para configurar");
  const [expanded, setExpanded] = useState(false);
  const [incomingFrom, setIncomingFrom] = useState("");
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [ready, setReady] = useState(false);

  const normalizedConfig = useMemo(() => normalizeLoadedConfig(config), [config]);
  const activeAor = useMemo(
    () => buildAor(normalizedConfig.username, normalizedConfig.domain),
    [normalizedConfig.username, normalizedConfig.domain],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setConfig(normalizeLoadedConfig(parsed));
      }
    } catch {
      // noop
    }
    setReady(true);
  }, []);

  useEffect(() => {
    return () => {
      void disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canConnect = useMemo(() => {
    return Boolean(
      normalizedConfig.server && normalizedConfig.domain && normalizedConfig.username && normalizedConfig.password,
    );
  }, [normalizedConfig]);

  function configSignature() {
    return JSON.stringify({
      server: normalizedConfig.server,
      domain: normalizedConfig.domain,
      username: normalizedConfig.username,
      password: normalizedConfig.password,
      autoRegister: normalizedConfig.autoRegister,
    });
  }

  function saveConfig() {
    try {
      const safeConfig = normalizeLoadedConfig(config);
      setConfig(safeConfig);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safeConfig));
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      setMessage(
        safeConfig.username
          ? `Configuración SIP guardada · usuario activo: ${safeConfig.username}`
          : "Configuración SIP guardada en este navegador",
      );
    } catch {
      setMessage("No he podido guardar la configuración SIP");
      setStatus("error");
    }
  }

  async function buildClient() {
    if (!remoteAudioRef.current) throw new Error("Audio remoto no preparado");
    const SIP: any = await import("sip.js");
    const SimpleUser = SIP?.Web?.SimpleUser || SIP?.SimpleUser || SIP?.default?.Web?.SimpleUser;
    if (!SimpleUser) throw new Error("No he encontrado SimpleUser en sip.js");

    const aor = buildAor(normalizedConfig.username, normalizedConfig.domain);
    if (!aor) throw new Error("Falta el AOR SIP válido");

    const delegate = {
      onCallCreated: () => {
        setStatus("calling");
        setMessage(`Llamada iniciada desde ${normalizeUsername(normalizedConfig.username)}`);
      },
      onCallAnswered: () => {
        setStatus("in-call");
        setIncomingFrom("");
        setMessage("Llamada conectada");
      },
      onCallHangup: () => {
        setStatus(normalizedConfig.autoRegister ? "registered" : "idle");
        setIncomingFrom("");
        setOnHold(false);
        setMuted(false);
        setMessage("Llamada finalizada");
      },
      onCallReceived: async () => {
        try {
          const session = simpleUserRef.current?.session;
          const from = session?.remoteIdentity?.uri?.toString?.() || "Llamada entrante";
          setIncomingFrom(from);
        } catch {
          setIncomingFrom("Llamada entrante");
        }
        setStatus("incoming");
        setMessage("Tienes una llamada entrante");
      },
      onRegistered: () => {
        setStatus("registered");
        setMessage(`Extensión SIP registrada como ${normalizeUsername(normalizedConfig.username)}`);
      },
      onServerDisconnect: () => {
        setStatus("idle");
        setOnHold(false);
        setMuted(false);
        setMessage("Conexión SIP cerrada");
      },
    };

    const options = {
      aor,
      userAgentOptions: {
        uri: SIP?.UserAgent?.makeURI ? SIP.UserAgent.makeURI(aor) : undefined,
        authorizationUsername: normalizeUsername(normalizedConfig.username),
        authorizationPassword: normalizedConfig.password,
        displayName: normalizedConfig.displayName || normalizeUsername(normalizedConfig.username),
      },
      media: {
        constraints: { audio: true, video: false },
        remote: { audio: remoteAudioRef.current },
      },
      delegate,
    };

    currentSignatureRef.current = configSignature();
    return new SimpleUser(normalizedConfig.server, options);
  }

  async function connect() {
    if (!canConnect) {
      setStatus("error");
      setMessage("Rellena servidor WSS, dominio, usuario y contraseña SIP");
      setExpanded(true);
      return;
    }

    try {
      setStatus("connecting");
      setMessage(`Conectando como ${normalizeUsername(normalizedConfig.username)}...`);

      const nextSignature = configSignature();
      if (simpleUserRef.current && currentSignatureRef.current !== nextSignature) {
        await disconnect();
      }

      if (!simpleUserRef.current) {
        simpleUserRef.current = await buildClient();
      }

      await simpleUserRef.current.connect();
      if (normalizedConfig.autoRegister) {
        await simpleUserRef.current.register();
        setStatus("registered");
        setMessage(`Extensión conectada y registrada como ${normalizeUsername(normalizedConfig.username)}`);
      } else {
        setStatus("idle");
        setMessage("Conectado al servidor SIP");
      }
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "No he podido conectar con la central SIP");
    }
  }

  async function disconnect() {
    try {
      if (simpleUserRef.current?.hangup) {
        try {
          await simpleUserRef.current.hangup();
        } catch {
          // noop
        }
      }
      if (simpleUserRef.current?.unregister) {
        try {
          await simpleUserRef.current.unregister();
        } catch {
          // noop
        }
      }
      if (simpleUserRef.current?.disconnect) {
        await simpleUserRef.current.disconnect();
      }
    } catch {
      // noop
    } finally {
      simpleUserRef.current = null;
      currentSignatureRef.current = "";
      setStatus("idle");
      setIncomingFrom("");
      setOnHold(false);
      setMuted(false);
      setMessage("Teléfono IP desconectado");
    }
  }

  async function makeCall() {
    const target = sanitizeDestination(destination, normalizedConfig.domain);
    if (!target) {
      setStatus("error");
      setMessage("Escribe una extensión o destino SIP");
      return;
    }

    try {
      if (!simpleUserRef.current) {
        await connect();
      }
      if (!simpleUserRef.current) return;
      setStatus("calling");
      setMessage(`Llamando a ${target} desde ${normalizeUsername(normalizedConfig.username)}...`);
      await simpleUserRef.current.call(target);
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "No he podido iniciar la llamada");
    }
  }

  async function answerCall() {
    try {
      if (!simpleUserRef.current) return;
      await simpleUserRef.current.answer();
      setStatus("in-call");
      setMessage("Llamada contestada");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "No he podido contestar la llamada");
    }
  }

  async function hangup() {
    try {
      if (!simpleUserRef.current) return;
      await simpleUserRef.current.hangup();
      setStatus(normalizedConfig.autoRegister ? "registered" : "idle");
      setOnHold(false);
      setMuted(false);
      setMessage("Llamada colgada");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "No he podido colgar la llamada");
    }
  }

  async function toggleHold() {
    try {
      if (!simpleUserRef.current) return;
      if (onHold) {
        await simpleUserRef.current.unhold();
        setOnHold(false);
        setMessage("Llamada reanudada");
      } else {
        await simpleUserRef.current.hold();
        setOnHold(true);
        setMessage("Llamada en espera");
      }
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "No he podido cambiar la espera");
    }
  }

  async function sendTone(tone: string) {
    try {
      if (!simpleUserRef.current) return;
      await simpleUserRef.current.sendDTMF(String(tone));
    } catch {
      // noop
    }
  }

  function toggleMute() {
    const audioEl = remoteAudioRef.current;
    if (!audioEl) return;
    const next = !muted;
    audioEl.muted = next;
    setMuted(next);
    setMessage(next ? "Audio remoto silenciado" : "Audio remoto activado");
  }

  if (!ready) return null;

  const isConnected = ["registered", "calling", "incoming", "in-call"].includes(status);
  const showCallControls = ["calling", "incoming", "in-call"].includes(status);

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg, rgba(30,20,48,0.96), rgba(18,12,32,0.92))",
        boxShadow: "0 10px 30px rgba(0,0,0,.22)",
      }}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline />
      <div className="tc-container" style={{ padding: expanded ? "10px 18px 14px" : "10px 18px" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div className="tc-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="tc-chip" style={{ fontWeight: 800 }}>
              <Phone size={14} style={{ marginRight: 6 }} /> Teléfono IP
            </div>
            <div className="tc-sub" style={{ fontSize: 13 }}>
              {message}
              {activeAor ? ` · ${activeAor}` : ""}
              {incomingFrom ? ` · ${incomingFrom}` : ""}
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              className="tc-input"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Extensión o destino SIP"
              style={{ minWidth: 180, height: 40 }}
            />
            {!isConnected ? (
              <button className="tc-btn tc-btn-ok" onClick={connect}>
                <PhoneCall size={16} style={{ marginRight: 6 }} /> Conectar
              </button>
            ) : (
              <button className="tc-btn tc-btn-danger" onClick={disconnect}>
                <PhoneOff size={16} style={{ marginRight: 6 }} /> Desconectar
              </button>
            )}
            <button className="tc-btn" onClick={makeCall} disabled={!destination.trim()}>
              <Phone size={16} style={{ marginRight: 6 }} /> Llamar
            </button>
            <button className="tc-btn" onClick={() => setExpanded((v) => !v)}>
              <Settings2 size={16} style={{ marginRight: 6 }} /> SIP
            </button>
          </div>
        </div>

        {showCallControls ? (
          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {status === "incoming" ? (
              <>
                <button className="tc-btn tc-btn-ok" onClick={answerCall}>
                  <PhoneIncoming size={16} style={{ marginRight: 6 }} /> Contestar
                </button>
                <button className="tc-btn tc-btn-danger" onClick={hangup}>Rechazar</button>
              </>
            ) : (
              <>
                <button className="tc-btn tc-btn-danger" onClick={hangup}>Colgar</button>
                <button className="tc-btn" onClick={toggleHold}>{onHold ? "Quitar espera" : "Poner en espera"}</button>
                <button className="tc-btn" onClick={toggleMute}>{muted ? "Activar audio" : "Silenciar audio"}</button>
                {Array.from(["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]).map((tone) => (
                  <button key={tone} className="tc-btn" onClick={() => sendTone(tone)} style={{ minWidth: 42 }}>
                    {tone}
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}

        {expanded ? (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="tc-grid tc-grid-4" style={{ gap: 10 }}>
              <div>
                <div className="tc-sub">Servidor WSS</div>
                <input
                  className="tc-input"
                  value={config.server}
                  onChange={(e) => setConfig((prev) => ({ ...prev, server: e.target.value }))}
                  placeholder="wss://pbx.tudominio.com:8089/ws"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
              <div>
                <div className="tc-sub">Dominio SIP</div>
                <input
                  className="tc-input"
                  value={config.domain}
                  onChange={(e) => setConfig((prev) => ({ ...prev, domain: e.target.value }))}
                  placeholder="pbx.tudominio.com"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
              <div>
                <div className="tc-sub">Usuario / extensión</div>
                <input
                  className="tc-input"
                  value={config.username}
                  onChange={(e) => setConfig((prev) => ({ ...prev, username: e.target.value }))}
                  placeholder="1001"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
              <div>
                <div className="tc-sub">Contraseña SIP</div>
                <input
                  type="password"
                  className="tc-input"
                  value={config.password}
                  onChange={(e) => setConfig((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
            </div>

            <div className="tc-grid tc-grid-3" style={{ gap: 10, marginTop: 10 }}>
              <div>
                <div className="tc-sub">Nombre mostrado</div>
                <input
                  className="tc-input"
                  value={config.displayName}
                  onChange={(e) => setConfig((prev) => ({ ...prev, displayName: e.target.value }))}
                  placeholder="Tarot Celestial · Central"
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
              <label className="tc-sub" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 28 }}>
                <input
                  type="checkbox"
                  checked={config.autoRegister}
                  onChange={(e) => setConfig((prev) => ({ ...prev, autoRegister: e.target.checked }))}
                />
                Registrar extensión al conectar
              </label>
              <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 24 }}>
                <button className="tc-btn tc-btn-gold" onClick={saveConfig}>
                  <Save size={16} style={{ marginRight: 6 }} /> Guardar configuración
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

}
