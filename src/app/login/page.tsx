"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function login() {
    if (loading) return;
    setErr(null);
    setLoading(true);

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      const token = data.session?.access_token;
      if (!token) throw new Error("No token");

      // ✅ Login manual (NO presencia): crea work_session y pone state=online
      await fetch("/api/work/login", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const me = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());

      if (!me?.ok || !me?.role) throw new Error(me?.error || "No role");

      if (me.role === "admin") window.location.href = "/admin";
      else if (me.role === "central") window.location.href = "/panel-central";
      else window.location.href = "/panel-tarotista";
    } catch (e: any) {
      setErr(e?.message || "Error de login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: "grid", placeItems: "center", gap: 10 }}>
          <Image
            src="/tarot-celestial-logo.png"
            alt="Tarot Celestial"
            width={110}
            height={110}
            style={{ borderRadius: 18 }}
            onError={(e) => ((e.target as any).style.display = "none")}
          />
          <div style={{ fontWeight: 800, fontSize: 22 }}>Tarot Celestial</div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Acceso al panel interno</div>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "14px 0" }} />

        <div style={{ display: "grid", gap: 10 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.25)",
              color: "white",
            }}
          />
          <input
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.25)",
              color: "white",
            }}
          />

          {err ? <div style={{ color: "#ff5a7a", fontSize: 12 }}>{err}</div> : null}

          <button
            onClick={login}
            disabled={loading || !email.trim() || !password.trim()}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(215,181,109,0.45)",
              background: "rgba(215,181,109,0.18)",
              color: "white",
              cursor: "pointer",
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
