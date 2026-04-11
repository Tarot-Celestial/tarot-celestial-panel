"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Mail, ShieldCheck, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export default function ChatLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizedEmail = useMemo(() => String(email || "").trim().toLowerCase(), [email]);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) router.replace("/chat");
    });
  }, [router]);

  async function sendOtp() {
    if (!normalizedEmail) {
      setMsg("Introduce un e-mail válido.");
      return;
    }
    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStep("otp");
      setMsg("Te hemos enviado un código a tu e-mail.");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido enviar el código.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!normalizedEmail || !token.trim()) {
      setMsg("Introduce el código que has recibido por e-mail.");
      return;
    }
    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.verifyOtp({ email: normalizedEmail, token: token.trim(), type: "email" });
      if (error) throw error;
      router.replace("/chat");
    } catch (e: any) {
      setMsg(e?.message || "Código incorrecto.");
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
          <h1>Entra a tu consulta por e-mail</h1>
          <p>
            Accede a una experiencia más privada y elegante. Tu sesión de chat vive separada del panel cliente.
          </p>
        </div>

        <div className="chat-login-form">
          {step === "email" ? (
            <>
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
              <button className="primary-btn" disabled={loading} onClick={sendOtp}>
                {loading ? "Enviando…" : "Recibir código"}
              </button>
            </>
          ) : (
            <>
              <div className="hint-card">Código enviado a <strong>{normalizedEmail}</strong></div>
              <label className="field">
                <span>Código de acceso</span>
                <div className="field-wrap">
                  <ShieldCheck size={16} />
                  <input
                    inputMode="numeric"
                    placeholder="123456"
                    value={token}
                    onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </label>
              <div className="actions-row">
                <button className="ghost-btn" disabled={loading} onClick={() => setStep("email")}>Cambiar e-mail</button>
                <button className="primary-btn" disabled={loading} onClick={verifyOtp}>
                  {loading ? "Verificando…" : "Entrar al chat"}
                </button>
              </div>
            </>
          )}

          {msg ? <div className="hint-card">{msg}</div> : null}
        </div>
      </div>

      <style jsx>{`
        .chat-login-shell{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top, rgba(107,33,168,.28), rgba(2,6,23,1) 52%), #020617;color:#fff;}
        .chat-login-card{width:min(980px,100%);display:grid;grid-template-columns:1.1fr .9fr;gap:24px;padding:24px;border-radius:28px;border:1px solid rgba(255,255,255,.08);background:rgba(9,12,25,.78);backdrop-filter:blur(18px);box-shadow:0 24px 80px rgba(0,0,0,.35);}
        .chat-login-hero{display:grid;align-content:start;gap:16px;padding:18px;}
        .chat-logo-wrap{width:92px;height:92px;border-radius:24px;display:grid;place-items:center;background:linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.04));}
        .chat-login-badge{display:inline-flex;align-items:center;gap:8px;width:fit-content;padding:8px 12px;border-radius:999px;border:1px solid rgba(215,181,109,.26);background:rgba(215,181,109,.12);color:#f8e7b0;font-size:13px;}
        h1{margin:0;font-size:42px;line-height:1.04;}
        p{margin:0;color:rgba(255,255,255,.72);font-size:15px;line-height:1.7;max-width:52ch;}
        .chat-login-form{display:grid;align-content:center;gap:16px;padding:18px;border-radius:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);}
        .field{display:grid;gap:8px;}
        .field span{font-size:13px;color:rgba(255,255,255,.78);}
        .field-wrap{display:flex;align-items:center;gap:10px;padding:0 14px;height:54px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(2,6,23,.6);}
        .field-wrap input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:15px;}
        .primary-btn,.ghost-btn{height:52px;border-radius:16px;font-weight:800;border:none;cursor:pointer;}
        .primary-btn{background:linear-gradient(135deg,#d7b56d,#8b5cf6);color:#fff;}
        .ghost-btn{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.1);}
        .hint-card{padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.82);font-size:14px;}
        .actions-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        @media (max-width: 840px){.chat-login-card{grid-template-columns:1fr;}h1{font-size:34px;}}
      `}</style>
    </div>
  );
}
