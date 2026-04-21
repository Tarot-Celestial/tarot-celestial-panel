"use client";

import { useRef, useState } from "react";

type SipConfig = {
server: string;
domain: string;
username: string;
password: string;
};

type SipStatus = "idle" | "connecting" | "registered" | "error";

const DEFAULT_CONFIG: SipConfig = {
server: "",
domain: "",
username: "",
password: "",
};

function buildAor(username: string, domain: string) {
if (!username || !domain) return null;
return `sip:${username}@${domain}`;
}

export default function IPPhoneBar() {
const simpleUserRef = useRef<any>(null);
const audioRef = useRef<HTMLAudioElement | null>(null);

const [config, setConfig] = useState<SipConfig>(DEFAULT_CONFIG);
const [status, setStatus] = useState<SipStatus>("idle");
const [message, setMessage] = useState("Listo");

async function buildClient() {
const SIP: any = await import("sip.js");
const SimpleUser = SIP.Web.SimpleUser;

```
const aor = buildAor(config.username, config.domain);
if (!aor) throw new Error("AOR inválido");

const options = {
  aor,
  userAgentOptions: {
    uri: SIP.UserAgent.makeURI(aor),
    authorizationUsername: config.username,
    authorizationPassword: config.password,
    transportOptions: {
      server: config.server,
    },
  },
  media: {
    constraints: { audio: true, video: false },
    remote: { audio: audioRef.current },
  },
};

return new SimpleUser(config.server, options);
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
  setMessage("Conectado correctamente");
} catch (e: any) {
  setStatus("error");
  setMessage(e?.message || "Error al conectar");
}
```

}

async function disconnect() {
try {
await simpleUserRef.current?.disconnect();
} catch {}
simpleUserRef.current = null;
setStatus("idle");
setMessage("Desconectado");
}

return (
<div style={{ padding: 20 }}> <audio ref={audioRef} autoPlay />

```
  <div style={{ display: "flex", gap: 10 }}>
    <button onClick={connect}>Conectar</button>
    <button onClick={disconnect}>Desconectar</button>
  </div>

  <div style={{ marginTop: 10 }}>
    <input
      placeholder="Servidor WSS (wss://dominio:8089/ws)"
      value={config.server}
      onChange={(e) => setConfig({ ...config, server: e.target.value })}
    />
  </div>

  <div>
    <input
      placeholder="Dominio SIP"
      value={config.domain}
      onChange={(e) => setConfig({ ...config, domain: e.target.value })}
    />
  </div>

  <div>
    <input
      placeholder="Usuario"
      value={config.username}
      onChange={(e) => setConfig({ ...config, username: e.target.value })}
    />
  </div>

  <div>
    <input
      type="password"
      placeholder="Password"
      value={config.password}
      onChange={(e) => setConfig({ ...config, password: e.target.value })}
    />
  </div>

  <div style={{ marginTop: 10 }}>
    Estado: {status}
  </div>

  <div>{message}</div>
</div>
```

);
}
