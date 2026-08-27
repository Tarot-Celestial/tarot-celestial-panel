"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { loadPanelIdentityFromToken, panelPathForRole } from "@/lib/panel-access";

const sb = supabaseBrowser();

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("El acceso está tardando demasiado. Comprueba tu conexión y vuelve a intentarlo.")),
      timeoutMs
    );
    Promise.resolve(operation).then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); }
    );
  });
}

const TRUST_POINTS = [
  "Panel interno seguro",
  "Central · Admin · Tarotistas",
  "Operativa en tiempo real",
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => email.trim().length > 0 && password.length > 0 && !loading,
    [email, password, loading]
  );

  async function login() {
    if (loading) return;
    setErr(null);
    setLoading(true);

    try {
      // 🔐 LOGIN SUPABASE
      const { data, error } = await withTimeout(
        sb.auth.signInWithPassword({ email: email.trim(), password }),
        15000
      );

      if (error) throw error;

      const token = data.session?.access_token;
      if (!token) throw new Error("Supabase no devolvió una sesión válida");

      // El rol se resuelve en servidor con service role; el navegador no consulta
      // directamente workers y por tanto no depende de sus políticas RLS.
      const identity = await loadPanelIdentityFromToken(token);
      const role = String(identity.role || "").toLowerCase();
      if (!(["admin", "central", "tarotista"] as string[]).includes(role)) {
        throw new Error("Tu usuario no tiene un rol de panel válido");
      }
      window.location.replace(panelPathForRole(role));
    } catch (e: any) {
      const message = String(e?.message || "Error de login");
      if (message === "NO_WORKER") setErr("No se encontró tu usuario en trabajadores.");
      else if (message === "WORKER_DISABLED") setErr("Este usuario está dado de baja y no puede acceder al panel.");
      else setErr(message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    void login();
  }

  return (
    <main className="tc-login-shell">
      <div className="tc-login-bg" aria-hidden="true">
        <div className="tc-login-orb tc-login-orb-one" />
        <div className="tc-login-orb tc-login-orb-two" />
        <div className="tc-login-orb tc-login-orb-three" />
        <div className="tc-login-stars" />
        <div className="tc-login-grid" />
      </div>

      <section className="tc-login-hero" aria-label="Acceso Tarot Celestial">
        <div className="tc-login-brand-panel">
          <div className="tc-login-logo-wrap">
            <Image
              src="/Nuevo-logo-tarot.png"
              alt="Tarot Celestial"
              width={118}
              height={118}
              priority
              className="tc-login-logo"
            />
          </div>

          <div className="tc-login-kicker">Central Operativa Inteligente</div>
          <h1 className="tc-login-title">
            Tarot Celestial
            <span>Control total de llamadas, chats y equipo.</span>
          </h1>
          
          <div className="tc-login-trust-row">
            {TRUST_POINTS.map((item) => (
              <span key={item} className="tc-login-trust-chip">
                {item}
              </span>
            ))}
          </div>
        </div>

        <form className="tc-login-card" onSubmit={handleSubmit}>
          <div className="tc-login-card-glow" aria-hidden="true" />

          <div className="tc-login-card-head">
            <span className="tc-login-status-dot" />
            <div>
              <h2>Entrar al panel</h2>
              <p>Identificación segura para personal autorizado.</p>
            </div>
          </div>

          <label className="tc-login-field">
            <span>Email</span>
            <input
              className="tc-login-input"
              placeholder="tu@email.com"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="tc-login-field">
            <span>Contraseña</span>
            <input
              className="tc-login-input"
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {err && <div className="tc-login-error">{err}</div>}

          <button className="tc-login-button" type="submit" disabled={!canSubmit}>
            <span>{loading ? "Validando acceso..." : "Entrar al panel"}</span>
            <span className="tc-login-button-icon" aria-hidden="true">
              {loading ? "✦" : "→"}
            </span>
          </button>
        </form>
      </section>
    </main>
  );
}
