"use client";

import { useEffect, useRef, useState } from "react";

export default function IPPhoneBar() {
  const simpleUserRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [number, setNumber] = useState("");
  const [status, setStatus] = useState("Desconectado");

  const config = {
    server: "wss://sip.clientestarotcelestial.es:8089/ws",
    domain: "sip.clientestarotcelestial.es",
    username: "1000",
    password: "123456",
  };

  async function initSip() {
    const SIP: any = await import("sip.js");
    const SimpleUser =
      SIP?.Web?.SimpleUser || SIP?.SimpleUser || SIP?.default?.Web?.SimpleUser;

    const aor = `sip:${config.username}@${config.domain}`;

    const user = new SimpleUser(config.server, {
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
    });

    simpleUserRef.current = user;

    await user.connect();
    await user.register();

    setStatus("Conectado");
  }

  async function call() {
    if (!number) return;
    await simpleUserRef.current.call(`sip:${number}@${config.domain}`);
    setStatus("Llamando...");
  }

  async function hangup() {
    await simpleUserRef.current.hangup();
    setStatus("Colgado");
  }

  function addDigit(d: string) {
    setNumber((prev) => prev + d);
  }

  function clear() {
    setNumber("");
  }

  useEffect(() => {
    initSip();
  }, []);

  return (
    <div style={styles.container}>
      <audio ref={audioRef} autoPlay />

      <div style={styles.display}>{number || "—"}</div>

      <div style={styles.keypad}>
        {["1","2","3","4","5","6","7","8","9","*","0","#"].map((d) => (
          <button key={d} style={styles.key} onClick={() => addDigit(d)}>
            {d}
          </button>
        ))}
      </div>

      <div style={styles.actions}>
        <button style={styles.call} onClick={call}>📞</button>
        <button style={styles.hang} onClick={hangup}>❌</button>
        <button style={styles.clear} onClick={clear}>⌫</button>
      </div>

      <div style={styles.status}>{status}</div>
    </div>
  );
}

const styles: any = {
  container: {
    width: 260,
    padding: 20,
    background: "#0e0e11",
    borderRadius: 16,
    color: "white",
    fontFamily: "sans-serif",
    boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  },
  display: {
    height: 50,
    background: "#1a1a1f",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 10px",
    fontSize: 20,
    marginBottom: 15,
  },
  keypad: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
  },
  key: {
    height: 50,
    borderRadius: 10,
    background: "#2a2a33",
    color: "white",
    fontSize: 18,
    border: "none",
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 15,
  },
  call: {
    flex: 1,
    marginRight: 5,
    background: "#00c853",
    border: "none",
    borderRadius: 10,
    height: 50,
    fontSize: 18,
    cursor: "pointer",
  },
  hang: {
    flex: 1,
    marginRight: 5,
    background: "#d50000",
    border: "none",
    borderRadius: 10,
    height: 50,
    fontSize: 18,
    cursor: "pointer",
  },
  clear: {
    flex: 1,
    background: "#444",
    border: "none",
    borderRadius: 10,
    height: 50,
    fontSize: 18,
    cursor: "pointer",
  },
  status: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.7,
    textAlign: "center",
  },
};
