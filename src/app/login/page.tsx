"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      const user = data.user;
      if (!user) throw new Error("No user");

      // 🔍 BUSCAR WORKER
      const { data: worker, error: workerError } = await sb
        .from("workers")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      console.log("USER ID:", user.id);
      console.log("ROLE REAL:", worker?.role);
      console.log("WORKER ERROR:", workerError);

      if (!worker) {
        setErr("No se encontró tu usuario en workers");
        setLoading(false);
        return;
      }

      // 🔥 NORMALIZAR ROLE
      const role = worker?.role?.toLowerCase();

      // 🚀 REDIRECCIÓN
      if (role === "admin") {
        window.location.href = "/admin";
      } else if (role === "central") {
        window.location.href = "/panel-central";
      } else if (role === "tarotista") {
        window.location.href = "/panel-tarotista";
      } else {
        alert("ROL DESCONOCIDO: " + role);
      }
    } catch (e: any) {
      setErr(e?.message || "Error de login");
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
