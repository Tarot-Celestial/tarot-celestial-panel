"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Mail, Lock, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export default function ChatLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizedEmail = useMemo(() => String(email || "").trim().toLowerCase(), [email]);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) router.replace("/chat");
    });
  }, [router]);

  async function handleAuth() {
    if (!normalizedEmail || !password) {
      setMsg("Introduce e-mail y contraseña.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      // 1. intentar login
      const { error: loginError } = await sb.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (!loginError) {
        router.replace("/chat");
        return;
      }

      // 2. si falla → crear usuario
      const { data, error: signUpError } = await sb.auth.signUp({
  email: normalizedEmail,
  password,
  options: {
    data: {
      email_confirmed: true
    }
  }
});
      if (data?.user && !data.session) {
  // usuario creado pero requiere confirmación → forzamos login igualmente
  const { error: loginAfter } = await sb.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (loginAfter) throw loginAfter;

  router.replace("/chat");
  return;
}

      if (signUpError) throw signUpError;

      // 3. login después de registro
      const { error: loginAfter } = await sb.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (loginAfter) throw loginAfter;

      router.replace("/chat");

    } catch (e: any) {
      setMsg(e?.message || "Error en login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-login-shell">
      <div className="chat-login-card">
        <div className="chat-login-hero">
          <div className="chat-logo-wrap">
            <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={84} height={84} priority />
          </div>
          <div className="chat-login-badge"><Sparkles size={14} /> Acceso privado al chat</div>
          <h1>Accede a tu consulta</h1>
          <p>Introduce tu e-mail y contraseña. Si es tu primera vez, crearemos tu cuenta automáticamente.</p>
        </div>

        <div className="chat-login-form">
          <label className="field">
            <span>E-mail</span>
            <div className="field-wrap">
              <Mail size={16} />
              <input
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </label>

          <label className="field">
            <span>Contraseña</span>
            <div className="field-wrap">
              <Lock size={16} />
              <input
                type="password"
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </label>

          <button className="primary-btn" disabled={loading} onClick={handleAuth}>
            {loading ? "Entrando…" : "Entrar / Registrarse"}
          </button>

          {msg ? <div className="hint-card">{msg}</div> : null}
        </div>
      </div>

      <style jsx>{`
        .chat-login-shell{min-height:100vh;display:grid;place-items:center;padding:24px;background:#020617;color:#fff;}
        .chat-login-card{width:min(900px,100%);display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px;border-radius:24px;background:rgba(255,255,255,.04);}
        .chat-login-hero{display:grid;gap:14px;}
        .chat-logo-wrap{width:80px;height:80px;}
        h1{font-size:32px;}
        .chat-login-form{display:grid;gap:14px;}
        .field{display:grid;gap:6px;}
        .field-wrap{display:flex;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#111;}
        .field-wrap input{flex:1;background:transparent;border:none;color:#fff;outline:none;}
        .primary-btn{height:44px;border-radius:12px;border:none;background:#8b5cf6;color:#fff;font-weight:700;}
        .hint-card{padding:10px;border-radius:10px;background:#222;}
        @media(max-width:840px){.chat-login-card{grid-template-columns:1fr;}}
      `}</style>
    </div>
  );
}
