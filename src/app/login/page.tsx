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
          />
          <div style={{ fontWeight: 800, fontSize: 22 }}>Tarot Celestial</div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            Acceso al panel interno
          </div>
        </div>

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.12)",
            margin: "14px 0",
          }}
        />

        <div style={{ display: "grid", gap: 10 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {err && (
            <div style={{ color: "#ff5a7a", fontSize: 12 }}>
              {err}
            </div>
          )}

          <button onClick={login} disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
