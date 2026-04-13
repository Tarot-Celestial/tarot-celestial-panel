"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Globe2, Lock, Mail, Phone, Sparkles, User2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY_CODE, buildInternationalPhone, formatCountryOptionLabel, getCountryByCode, guessDefaultCountry, normalizeLocalPhone } from "@/lib/countries";

const sb = supabaseBrowser();

export default function ChatLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [telefono, setTelefono] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizedEmail = useMemo(() => String(email || "").trim().toLowerCase(), [email]);
  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const telefonoInternacional = useMemo(() => buildInternationalPhone(selectedCountry, telefono), [selectedCountry, telefono]);
  const telefonoPlaceholder = useMemo(() => selectedCountry.hint || "600123123", [selectedCountry]);

  useEffect(() => {
    setCountryCode(guessDefaultCountry().code);
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) router.replace("/chat");
    });
  }, [router]);

  async function handleLogin() {
    if (!normalizedEmail || !password) {
      setMsg("Introduce e-mail y contraseña.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.signInWithPassword({ email: normalizedEmail, password });
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

  async function handleRegister() {
    if (!nombre.trim() || !normalizedEmail || !password || !selectedCountry.label.trim() || !normalizeLocalPhone(telefono)) {
      setMsg("Para crear la cuenta necesitamos nombre, e-mail, país, teléfono y contraseña.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/chat/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          email: normalizedEmail,
          password,
          pais: selectedCountry.label,
          telefono: telefonoInternacional,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo crear la cuenta.");

      const { error } = await sb.auth.signInWithPassword({ email: normalizedEmail, password });
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
        <section className="chat-login-hero">
          <div className="chat-logo-wrap">
            <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={88} height={88} priority />
          </div>
          <div className="chat-login-badge">
            <Sparkles size={14} /> Tarot Celestial · Chat privado
          </div>
          <h1>Consulta por chat con tu tarotista</h1>
          <p>
            Entra con tu cuenta o crea una nueva para acceder al panel de tarotistas, retomar conversaciones y comprar créditos cuando los necesites.
          </p>
          <div className="chat-login-benefits">
            <div className="benefit">✅ Registro rápido con nombre, país y teléfono</div>
            <div className="benefit">✅ Códigos internacionales para todos los países</div>
            <div className="benefit">✅ Acceso desde móvil tipo WhatsApp</div>
          </div>
        </section>

        <section className="chat-login-form">
          <div className="switcher">
            <button className={mode === "login" ? "switcher-btn active" : "switcher-btn"} onClick={() => setMode("login")}>
              Iniciar sesión
            </button>
            <button className={mode === "register" ? "switcher-btn active" : "switcher-btn"} onClick={() => setMode("register")}>
              Crear cuenta
            </button>
          </div>

          {mode === "register" ? (
            <>
              <label className="field">
                <span>Nombre</span>
                <div className="field-wrap">
                  <User2 size={16} />
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
                </div>
              </label>

              <label className="field">
                <span>País</span>
                <div className="field-wrap">
                  <Globe2 size={16} />
                  <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                    {COUNTRY_OPTIONS.map((item) => (
                      <option key={item.code} value={item.code}>{formatCountryOptionLabel(item)}</option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="field">
                <span>Teléfono</span>
                <div className="phone-row">
                  <div className="phone-prefix">{selectedCountry.dialCode}</div>
                  <div className="field-wrap phone-input-wrap">
                    <Phone size={16} />
                    <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder={telefonoPlaceholder} inputMode="tel" autoComplete="tel-national" />
                  </div>
                </div>
              </label>
            </>
          ) : null}

          <label className="field">
            <span>E-mail</span>
            <div className="field-wrap">
              <Mail size={16} />
              <input type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </label>

          <label className="field">
            <span>Contraseña</span>
            <div className="field-wrap">
              <Lock size={16} />
              <input type="password" placeholder="Tu contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </label>

          <button className="primary-btn" disabled={loading} onClick={mode === "login" ? handleLogin : handleRegister}>
            {loading ? (mode === "login" ? "Entrando…" : "Creando cuenta…") : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>

          {msg ? <div className="hint-card">{msg}</div> : null}
        </section>
      </div>

      <style jsx>{`
        .chat-login-shell{min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at top, rgba(124,58,237,.16), transparent 22%), #020617;color:#fff;}
        .chat-login-card{width:min(980px,100%);display:grid;grid-template-columns:1.05fr .95fr;gap:24px;padding:24px;border-radius:28px;background:rgba(15,23,42,.92);border:1px solid rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.35);}
        .chat-login-hero,.chat-login-form{display:grid;gap:14px;align-content:start;}
        .chat-logo-wrap{width:88px;height:88px;}
        .chat-login-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(139,92,246,.18);border:1px solid rgba(139,92,246,.28);width:max-content;color:#f5f3ff;font-size:13px;}
        h1{font-size:34px;line-height:1.05;margin:0;}
        p{color:#cbd5e1;line-height:1.6;margin:0;}
        .chat-login-benefits{display:grid;gap:10px;margin-top:8px;}
        .benefit{padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#e5e7eb;}
        .switcher{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);}
        .switcher-btn{height:46px;border:none;border-radius:12px;background:transparent;color:#cbd5e1;font-weight:800;cursor:pointer;}
        .switcher-btn.active{background:linear-gradient(135deg, rgba(139,92,246,.95), rgba(124,58,237,.95));color:#fff;}
        .field{display:grid;gap:6px;}
        .field span{font-size:13px;color:#cbd5e1;}
        .field-wrap{display:flex;align-items:center;gap:10px;padding:0 14px;height:52px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);}
        .field-wrap input,.field-wrap select{flex:1;background:transparent;border:none;color:#fff;outline:none;font-size:15px;min-width:0;}
        .field-wrap select option{color:#0f172a;}
        .phone-row{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;}
        .phone-prefix{height:52px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);font-weight:800;color:#f8fafc;}
        .phone-input-wrap{width:100%;}
        .primary-btn{height:50px;border-radius:14px;border:none;background:linear-gradient(135deg, #8b5cf6, #6d28d9);color:#fff;font-weight:800;font-size:15px;cursor:pointer;}
        .hint-card{padding:12px 14px;border-radius:14px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.18);color:#fee2e2;}
        @media (max-width: 880px){.chat-login-card{grid-template-columns:1fr;}.phone-row{grid-template-columns:1fr;}}
      `}</style>
    </div>
  );
}
