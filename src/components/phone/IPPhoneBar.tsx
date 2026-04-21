"use client";

import { useRef, useState } from "react";

export default function IPPhoneBar() {
  const simpleUserRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [number, setNumber] = useState("");
  const [status, setStatus] = useState("Offline");
  const [open, setOpen] = useState(false);

  const [config, setConfig] = useState({
    server: "wss://sip.clientestarotcelestial.es:8089/ws",
    domain: "sip.clientestarotcelestial.es",
    username: "",
    password: "",
  });

  // =========================
  // SIP CONNECT
  // =========================
  async function connect() {
    try {
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

      user.delegate = {
        onCallCreated: () => setStatus("📞 Llamando"),
        onCallAnswered: () => setStatus("🟢 En llamada"),
        onCallHangup: () => setStatus("🔴 Colgado"),
        onRegistered: () => setStatus("🟢 Conectado"),
      };

      simpleUserRef.current = user;

      await user.connect();
      await user.register();

      setStatus("🟢 Conectado");
    } catch (e) {
      console.error(e);
      setStatus("❌ Error conexión");
    }
  }

  async function disconnect() {
    try {
      await simpleUserRef.current?.disconnect();
      simpleUserRef.current = null;
      setStatus("Offline");
    } catch (e) {
      console.error(e);
    }
  }

  // =========================
  // CALL
  // =========================
  async function call() {
    if (!number || !simpleUserRef.current) return;

    try {
      setStatus("📞 Llamando...");
      await simpleUserRef.current.call(`sip:${number}@${config.domain}`);
    } catch (e) {
      console.error(e);
      setStatus("❌ Error llamada");
    }
  }

  async function hangup() {
    try {
      await simpleUserRef.current?.hangup();
      setStatus("🔴 Colgado");
    } catch (e) {
      console.error(e);
    }
  }

  // =========================
  // UI
  // =========================
  function addDigit(d: string) {
    setNumber((prev) => prev + d);
  }

  function clear() {
    setNumber("");
  }

  return (
    <>
      <audio ref={audioRef} autoPlay />

      {!open && (
        <button onClick={() => setOpen(true)} style={styles.floatingBtn}>
          📞
        </button>
      )}

      {open && (
        <div style={styles.container}>
          <div style={styles.header}>
            <span>Softphone</span>
            <button onClick={() => setOpen(false)}>✖</button>
          </div>

          {/* CONFIG */}
          <div style={styles.config}>
            <input
              placeholder="Usuario (1000, 1001...)"
              value={config.username}
              onChange={(e) =>
                setConfig({ ...config, username: e.target.value })
              }
            />
            <input
              placeholder="Password"
              type="password"
              value={config.password}
              onChange={(e) =>
                setConfig({ ...config, password: e.target.value })
              }
            />

            <div style={{ display: "flex", gap: 5 }}>
              <button style={styles.connect} onClick={connect}>
                Conectar
              </button>
              <button style={styles.disconnect} onClick={disconnect}>
                Desconectar
              </button>
            </div>
          </div>

          {/* DISPLAY */}
          <div style={styles.display}>{number || "—"}</div>

          {/* KEYPAD */}
          <div style={styles.keypad}>
            {["1","2","3","4","5","6","7","8","9","*","0","#"].map((d) => (
              <button key={d} style={styles.key} onClick={() => addDigit(d)}>
                {d}
              </button>
            ))}
          </div>

          {/* ACTIONS */}
          <div style={styles.actions}>
            <button style={styles.call} onClick={call}>📞</button>
            <button style={styles.hang} onClick={hangup}>❌</button>
            <button style={styles.clear} onClick={clear}>⌫</button>
          </div>

          <div style={styles.status}>{status}</div>
        </div>
      )}
    </>
  );
}

const styles: any = {
  floatingBtn: {
    position: "fixed",
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: "50%",
    background: "#00c853",
    color: "white",
    fontSize: 24,
    border: "none",
    cursor: "pointer",
    zIndex: 9999,
  },

  container: {
    position: "fixed",
    bottom: 20,
    right: 20,
    width: 260,
    padding: 15,
    background: "#111",
    borderRadius: 16,
    color: "white",
    boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
    zIndex: 9999,
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  config: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    marginBottom: 10,
  },

  connect: {
    flex: 1,
    background: "#00c853",
    border: "none",
    borderRadius: 6,
    height: 35,
  },

  disconnect: {
    flex: 1,
    background: "#555",
    border: "none",
    borderRadius: 6,
    height: 35,
    color: "white",
  },

  display: {
    height: 40,
    background: "#1a1a1f",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 10px",
    marginBottom: 10,
  },

  keypad: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 8,
  },

  key: {
    height: 45,
    borderRadius: 8,
    background: "#2a2a33",
    color: "white",
    border: "none",
    cursor: "pointer",
  },

  actions: {
    display: "flex",
    gap: 5,
    marginTop: 10,
  },

  call: {
    flex: 1,
    background: "#00c853",
    border: "none",
    borderRadius: 8,
    height: 45,
  },

  hang: {
    flex: 1,
    background: "#d50000",
    border: "none",
    borderRadius: 8,
    height: 45,
  },

  clear: {
    flex: 1,
    background: "#444",
    border: "none",
    borderRadius: 8,
    height: 45,
    color: "white",
  },

  status: {
    marginTop: 8,
    fontSize: 12,
    textAlign: "center",
    opacity: 0.7,
  },
};
