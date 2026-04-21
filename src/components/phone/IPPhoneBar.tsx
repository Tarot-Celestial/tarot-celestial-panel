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
.replace(/^wss?:///i, "")
.replace(/^/+/, "")
.replace(//ws$/i, "")
.replace(//$/, "");
}

function normalizeDomain(raw: string) {
const value = stripProtocol(raw);
if (!value) return "";
if (value.includes("@")) return value.split("@").pop()?.trim() || "";
return value;
}

function normalizeUsername(raw: string) {
return String(raw || "").trim().replace(/^sip:/i, "").replace(/@.*$/, "");
}

function normalizeServer(raw: string) {
const value = String(raw || "").trim();
if (!value) return "";
if (/^wss?:///i.test(value)) return value;
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
if (!username || !domain) return null;
return `sip:${username}@${domain}`;
}

function sanitizeDestination(raw: string, domain: string) {
const value = String(raw || "").trim();
if (!value) return "";
if (value.startsWith("sip:")) return value;
if (value.includes("@")) return `sip:${value.replace(/^sip:/i, "")}`;

const safeDomain = normalizeDomain(domain);
const normalizedNumber = value.replace(/[^\d+*#]/g, "");
if (!safeDomain) return normalizedNumber;

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
const [ready, setReady] = useState(false);

const normalizedConfig = useMemo(() => normalizeLoadedConfig(config), [config]);

useEffect(() => {
try {
const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
if (raw) setConfig(normalizeLoadedConfig(JSON.parse(raw)));
} catch {}
setReady(true);
}, []);

function saveConfig() {
const safeConfig = normalizeLoadedConfig(config);
setConfig(safeConfig);
localStorage.setItem(STORAGE_KEY, JSON.stringify(safeConfig));
setMessage("Configuración guardada");
}

async function buildClient() {
const SIP: any = await import("sip.js");
const SimpleUser = SIP.Web.SimpleUser;

```
const aor = buildAor(normalizedConfig.username, normalizedConfig.domain);
if (!aor) throw new Error("AOR inválido");

const options = {
  aor,
  userAgentOptions: {
    uri: SIP.UserAgent.makeURI(aor),
    authorizationUsername: normalizedConfig.username,
    authorizationPassword: normalizedConfig.password,
    displayName: normalizedConfig.displayName || normalizedConfig.username,
    transportOptions: {
      server: normalizedConfig.server,
    },
  },
  media: {
    constraints: { audio: true, video: false },
    remote: { audio: remoteAudioRef.current },
  },
};

return new SimpleUser(normalizedConfig.server, options);
```

}

async function connect() {
try {
setStatus("connecting");
const client = await buildClient();
simpleUserRef.current = client;

```
  await client.connect();
  await client.register();

  setStatus("registered");
  setMessage("Extensión registrada");
} catch (e: any) {
  setStatus("error");
  setMessage(e.message);
}
```

}

async function disconnect() {
try {
await simpleUserRef.current?.disconnect();
} catch {}
simpleUserRef.current = null;
setStatus("idle");
}

async function makeCall() {
const target = sanitizeDestination(destination, normalizedConfig.domain);
if (!target) return;

```
await simpleUserRef.current?.call(target);
```

}

if (!ready) return null;

return (
<div style={{ padding: 20 }}> <audio ref={remoteAudioRef} autoPlay />

```
  <div>
    <button onClick={connect}>Conectar</button>
    <button onClick={disconnect}>Desconectar</button>
  </div>

  <input
    value={destination}
    onChange={(e) => setDestination(e.target.value)}
    placeholder="Número"
  />

  <button onClick={makeCall}>Llamar</button>

  <div>{message}</div>
  <button onClick={saveConfig}>Guardar</button>
</div>
```

);
}

}

