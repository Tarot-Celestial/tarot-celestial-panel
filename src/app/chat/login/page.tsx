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

  const normalizedEmail = useMemo(
    () => String(email || "").trim().toLowerCase(),
    [email]
  );

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) router.replace("/chat");
    });
  }, [router]);

  // 🔐 LOGIN
  async function handleLogin() {
    if (!normalizedEmail || !password) {
      setMsg("Introduce e-mail y contraseña.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      const { error } = await sb.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setMsg("Usuario no encontrado o contraseña incorrecta.");
        return;
      }

      router.replace("/chat");
    } catch (e: any) {
      setMsg(e?.message || "Error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  // 🆕 REGISTRO (SIN EMAIL, SIN BLOQUEOS)
  async function handleRegister() {
    if (!normalizedEmail || !password) {
      setMsg("Introduce e-mail y contraseña.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/chat/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "No se pudo crear la cuenta.");
      }

      // login automático
      const { error } = await sb.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) throw error;

      router.replace("/chat");

    } catch (e: any) {
      setMsg(e?.message || "Error al crear la cuenta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-login-shell">
      <div className="chat-login-card">
        <div className="chat-login-hero">
          <div className="chat-logo-wrap">
            <Image
              src="/Nuevo-logo-tarot.png"
              alt="Tarot Celestial"
              width={84}
              height={84}
              priority
            />
          </div>
          <div className="chat-login-badge">
            <Sparkles size={14} /> Acceso privado al chat
          </div>
          <h1>Accede a tu consulta</h1>
          <p>
            Entra con tu e-mail y contraseña. Si es tu primera vez, crea tu cuenta en segundos.
          </p>
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

          <button className="primary-btn" disabled={loading} onClick={handleLogin}>
            {loading ? "Entrando…" : "Entrar"}
          </button>

          <button className="ghost-btn" disabled={loading} onClick={handleRegister}>
            Crear cuenta
          </button>

          {msg ? <div className="hint-card">{msg}</div> : null}
        </div>
      </div>

      <style jsx>{`
        .chat-login-shell{
          min-height:100vh;
          display:grid;
          place-items:center;
          padding:24px;
          background:#020617;
          color:#fff;
        }
        .chat-login-card{
          width:min(900px,100%);
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:24px;
          padding:24px;
          border-radius:24px;
          background:rgba(255,255,255,.04);
        }
        .chat-login-hero{display:grid;gap:14px;}
        .chat-logo-wrap{width:80px;height:80px;}
        h1{font-size:32px;}
        .chat-login-form{display:grid;gap:14px;}
        .field{display:grid;gap:6px;}
        .field-wrap{
          display:flex;
          align-items:center;
          gap:8px;
          padding:10px;
          border-radius:12px;
          background:#111;
        }
        .field-wrap input{
          flex:1;
          background:transparent;
          border:none;
          color:#fff;
          outline:none;
        }
        .primary-btn{
          height:44px;
          border-radius:12px;
          border:none;
          background:#8b5cf6;
          color:#fff;
          font-weight:700;
        }
        .ghost-btn{
          height:44px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.2);
          background:transparent;
          color:#fff;
          font-weight:700;
        }
        .hint-card{
          padding:10px;
          border-radius:10px;
          background:#222;
        }
        @media(max-width:840px){
          .chat-login-card{
            grid-template-columns:1fr;
          }
        }
      `}</style>
    </div>
  );
}
