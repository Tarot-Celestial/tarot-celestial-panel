"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function login() {
    setLoading(true);
    setErr("");

    // 🔥 LOGIN REAL CON SUPABASE
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }

    const user = data.user;

    if (!user) {
      setErr("No user");
      setLoading(false);
      return;
    }

    // 🔥 OBTENER ROL DESDE TU TABLA workers
    const { data: worker, error: wErr } = await sb
      .from("workers")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (wErr || !worker) {
      setErr("No se pudo obtener el rol");
      setLoading(false);
      return;
    }

    // 🔥 REDIRECCIÓN POR ROL
    if (worker.role === "admin") {
      window.location.href = "/admin";
    } else if (worker.role === "central") {
      window.location.href = "/panel-central";
    } else {
      window.location.href = "/panel-tarotista";
    }
  }

  return (
    <div className="tc-card" style={{ maxWidth: 420, margin: "80px auto" }}>
      <div className="tc-title">🔮 Tarot Celestial</div>

      <div style={{ marginTop: 16 }}>
        <input
          className="tc-input"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 10 }}>
        <input
          type="password"
          className="tc-input"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {err && (
        <div style={{ color: "red", marginTop: 10 }}>
          {err}
        </div>
      )}

      <button
        className="tc-btn tc-btn-ok"
        style={{ marginTop: 16, width: "100%" }}
        onClick={login}
        disabled={loading}
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </div>
  );
}
