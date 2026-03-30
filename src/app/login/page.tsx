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

      const user = data.user;
      if (!user) throw new Error("No user");

      const { data: worker, error: wErr } = await sb
        .from("workers")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (wErr || !worker) throw new Error("No se pudo obtener el rol");

      if (worker.role === "admin") {
        window.location.href = "/admin";
      } else if (worker.role === "central") {
        window.location.href = "/panel-central";
      } else {
        window.location.href = "/panel-tarotista";
      }
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

          {err && <div style={{ color: "#ff5a7a", fontSize: 12 }}>{err}</div>}

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
