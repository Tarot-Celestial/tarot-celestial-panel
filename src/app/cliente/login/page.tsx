"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LockKeyhole, Mail, MessageCircle, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY_CODE,
  buildInternationalPhone,
  formatCountryOptionLabel,
  getCountryByCode,
  guessDefaultCountry,
  normalizeLocalPhone,
} from "@/lib/countries";

const sb = supabaseBrowser();
const STORAGE_COUNTRY_KEY = "tc_cliente_login_country";
const STORAGE_PHONE_KEY = "tc_cliente_login_phone";

type LoginMode = "password" | "otp";
type OtpChannel = "sms" | "whatsapp" | "email";

export default function ClienteLoginPage() {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState<string>(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<LoginMode>("password");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [phoneForOtp, setPhoneForOtp] = useState("");
  const [otpChannel, setOtpChannel] = useState<OtpChannel>("sms");
  const [canUseWhatsapp, setCanUseWhatsapp] = useState(false);
  const [canUseEmail, setCanUseEmail] = useState(false);
  const [fallbackChallengeToken, setFallbackChallengeToken] = useState("");

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildInternationalPhone(selectedCountry, phoneInput), [selectedCountry, phoneInput]);
  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

  useEffect(() => {
    const guessed = guessDefaultCountry();

    try {
      const savedCountry = window.localStorage.getItem(STORAGE_COUNTRY_KEY);
      const savedPhone = window.localStorage.getItem(STORAGE_PHONE_KEY);
      setCountryCode(getCountryByCode(savedCountry || guessed.code).code);
      if (savedPhone) setPhoneInput(savedPhone);
    } catch {
      setCountryCode(guessed.code);
    } finally {
      setHydrated(true);
    }

    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace("/cliente/dashboard");
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        router.replace("/cliente/dashboard");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_COUNTRY_KEY, countryCode);
      window.localStorage.setItem(STORAGE_PHONE_KEY, normalizeLocalPhone(phoneInput));
    } catch {}
  }, [countryCode, hydrated, phoneInput]);

  async function validateCliente(phoneDigitsToCheck: string) {
    const { data: cliente, error } = await sb
      .from("crm_clientes")
      .select("id")
      .or(`telefono_normalizado.eq.${phoneDigitsToCheck},telefono.eq.${phoneDigitsToCheck},telefono_normalizado.eq.+${phoneDigitsToCheck},telefono.eq.+${phoneDigitsToCheck}`)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return Boolean(cliente?.id);
  }

  async function preparePasswordLogin() {
    const res = await fetch("/api/cliente/auth/password/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneDigits }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok || !json?.alias_email) {
      throw new Error(json?.error || "No hemos podido preparar tu acceso.");
    }
    return String(json.alias_email);
  }

  async function loginWithPassword() {
    if (!phoneDigits) {
      setMsg("Introduce un teléfono válido.");
      return;
    }
    if (!password.trim()) {
      setMsg("Escribe tu contraseña.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      const clienteExists = await validateCliente(phoneDigits);
      if (!clienteExists) {
        setMsg("❌ Este teléfono no está registrado.");
        return;
      }

      const aliasEmail = await preparePasswordLogin();
      const { error } = await sb.auth.signInWithPassword({ email: aliasEmail, password });
      if (error) throw error;

      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setCanUseWhatsapp(true);
      setCanUseEmail(true);
      setMsg(`${e?.message || "No hemos podido iniciar sesión."} Si aún no creaste tu contraseña, entra con código o restablécela.`);
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp(channel: OtpChannel) {
    if (!phoneDigits) {
      setMsg("Introduce un teléfono válido.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");
      setFallbackChallengeToken("");

      const clienteExists = await validateCliente(phoneDigits);
      if (!clienteExists) {
        setMsg("❌ Este teléfono no está registrado.");
        return;
      }

      if (channel === "sms") {
        const { error } = await sb.auth.signInWithOtp({ phone });
        if (error) throw error;
      } else {
        const endpoint = channel === "email" ? "/api/cliente/auth/email/send" : "/api/cliente/auth/whatsapp/send";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phoneDigits }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo enviar el código.");
        setFallbackChallengeToken(String(json?.challenge_token || ""));
      }

      setOtpChannel(channel);
      setPhoneForOtp(phone);
      setStep("otp");
      setCanUseWhatsapp(true);
      setCanUseEmail(true);
      setMsg(
        channel === "sms"
          ? "Te hemos enviado un código por SMS."
          : channel === "email"
          ? "Te hemos enviado un código por e-mail."
          : "Te hemos enviado un código por WhatsApp."
      );
    } catch (e: any) {
      setCanUseWhatsapp(true);
      setCanUseEmail(true);
      setMsg(e?.message || "No se pudo enviar el código.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!token.trim()) {
      setMsg("Introduce el código que te hemos enviado.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      if (otpChannel === "sms") {
        const { error } = await sb.auth.verifyOtp({
          phone: phoneForOtp,
          token: token.trim(),
          type: "sms",
        });
        if (error) throw error;
        router.replace("/cliente/dashboard");
        return;
      }

      if (!fallbackChallengeToken) {
        throw new Error(otpChannel === "email" ? "SOLICITA_PRIMERO_EL_CODIGO_EMAIL" : "SOLICITA_PRIMERO_EL_CODIGO_WHATSAPP");
      }

      const verifyUrl = otpChannel === "email" ? "/api/cliente/auth/email/verify" : "/api/cliente/auth/whatsapp/verify";
      const res = await fetch(verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneForOtp.replace(/\D/g, ""),
          code: token.trim(),
          challenge_token: fallbackChallengeToken,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No hemos podido verificar el código.");

      const magiclink = String(json?.action_link || "");
      if (!magiclink) throw new Error("No hemos podido abrir tu acceso seguro.");
      window.location.href = magiclink;
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido verificar el código.");
    } finally {
      setLoading(false);
    }
  }

  const otpLabel = otpChannel === "email" ? "Código e-mail" : otpChannel === "whatsapp" ? "Código WhatsApp" : "Código SMS";
  const otpDescription =
    otpChannel === "email"
      ? `Introduce el código que hemos enviado al e-mail asociado a ${phoneForOtp || selectedCountry.dialCode}.`
      : otpChannel === "whatsapp"
      ? `Introduce el código que hemos enviado por WhatsApp a ${phoneForOtp || selectedCountry.dialCode}.`
      : `Introduce el código que hemos enviado por SMS a ${phoneForOtp || selectedCountry.dialCode}.`;

  return (
    <main className="tc-login-shell">
      <section className="tc-login-card">
        <div className="tc-login-brand">
          <div className="tc-login-logo-wrap">
            <Image src="/logo.png" alt="Tarot Celestial" width={72} height={72} className="tc-login-logo" priority />
          </div>
          <div className="tc-chip">Acceso cliente</div>
          <h1>Tarot Celestial</h1>
          <p>Entra con tu teléfono y contraseña. Si todavía no la creaste, puedes acceder con código y terminar la configuración dentro.</p>
        </div>

        <div className="tc-login-tabs">
          <button className={`tc-login-tab ${mode === "password" ? "active" : ""}`} onClick={() => { setMode("password"); setStep("phone"); setMsg(""); }}>
            <LockKeyhole size={16} /> Contraseña
          </button>
          <button className={`tc-login-tab ${mode === "otp" ? "active" : ""}`} onClick={() => { setMode("otp"); setStep("phone"); setMsg(""); }}>
            <KeyRound size={16} /> Código
          </button>
        </div>

        {step === "phone" ? (
          <div className="tc-login-form">
            <label className="tc-label">País</label>
            <select className="tc-input" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {formatCountryOptionLabel(option)}
                </option>
              ))}
            </select>

            <label className="tc-label">Teléfono</label>
            <div className="tc-phone-field">
              <div className="tc-phone-prefix">{selectedCountry.dialCode}</div>
              <input
                className="tc-input tc-phone-input"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={selectedCountry.hint || "600123123"}
                value={phoneInput}
                onChange={(e) => setPhoneInput(normalizeLocalPhone(e.target.value))}
              />
            </div>

            {mode === "password" ? (
              <>
                <label className="tc-label">Contraseña</label>
                <input
                  className="tc-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button className="tc-primary-btn" onClick={loginWithPassword} disabled={loading}>
                  <LockKeyhole size={18} />
                  {loading ? "Entrando..." : "Entrar"}
                </button>
                <button className="tc-secondary-btn" onClick={() => router.push("/cliente/recuperar") } disabled={loading}>
                  He olvidado mi contraseña
                </button>
              </>
            ) : (
              <>
                <button className="tc-primary-btn" onClick={() => sendOtp("sms")} disabled={loading}>
                  <Smartphone size={18} />
                  {loading ? "Enviando..." : "Recibir SMS"}
                </button>
                <div className="tc-login-actions-grid">
                  <button className="tc-secondary-btn" onClick={() => sendOtp("whatsapp")} disabled={loading || (!canUseWhatsapp && false)}>
                    <MessageCircle size={18} /> WhatsApp
                  </button>
                  <button className="tc-secondary-btn" onClick={() => sendOtp("email")} disabled={loading || (!canUseEmail && false)}>
                    <Mail size={18} /> E-mail
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="tc-login-form">
            <div className="tc-otp-box">
              <ShieldCheck size={18} />
              <div>
                <strong>{otpLabel}</strong>
                <p>{otpDescription}</p>
              </div>
            </div>
            <input className="tc-input" inputMode="numeric" placeholder="123456" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="tc-primary-btn" onClick={verifyOtp} disabled={loading}>
              <Sparkles size={18} />
              {loading ? "Verificando..." : "Verificar código"}
            </button>
            <div className="tc-login-actions-grid">
              <button className="tc-secondary-btn" onClick={() => sendOtp(otpChannel)} disabled={loading}>
                Reenviar código
              </button>
              <button className="tc-secondary-btn" onClick={() => { setStep("phone"); setToken(""); setMsg(""); }} disabled={loading}>
                Volver
              </button>
            </div>
          </div>
        )}

        {msg ? <div className="tc-login-message">{msg}</div> : null}

        <div className="tc-login-footer">
          <div className="tc-login-foot-card">
            <LockKeyhole size={18} />
            <span>Tu teléfono identifica tu ficha y evita duplicados en el panel.</span>
          </div>
          <div className="tc-login-foot-card">
            <Sparkles size={18} />
            <span>Los clientes antiguos pueden seguir entrando con código hasta crear su contraseña.</span>
          </div>
        </div>
      </section>

      <style jsx>{`
        .tc-login-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 32px 16px;
          background:
            radial-gradient(circle at top, rgba(247, 197, 94, 0.18), transparent 30%),
            linear-gradient(180deg, #0f0b10 0%, #171019 100%);
        }
        .tc-login-card {
          width: min(560px, 100%);
          border-radius: 28px;
          padding: 28px;
          display: grid;
          gap: 18px;
          color: #fff7ea;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(16, 12, 18, 0.9);
          box-shadow: 0 32px 80px rgba(0,0,0,0.45);
        }
        .tc-login-brand { display:grid; gap:10px; text-align:center; justify-items:center; }
        .tc-login-brand h1 { margin: 0; font-size: 34px; }
        .tc-login-brand p { margin: 0; color: rgba(255,247,234,0.78); line-height: 1.5; }
        .tc-login-logo-wrap {
          width: 88px; height: 88px; border-radius: 999px; display:grid; place-items:center;
          background: radial-gradient(circle, rgba(247,197,94,0.3), rgba(247,197,94,0.05));
          border: 1px solid rgba(247,197,94,0.28);
        }
        .tc-login-logo { object-fit: contain; }
        .tc-login-tabs {
          display:grid; grid-template-columns:repeat(2,1fr); gap:10px;
        }
        .tc-login-tab, .tc-secondary-btn, .tc-primary-btn {
          border: 0; border-radius: 16px; cursor:pointer; font-weight:700;
          transition: transform .18s ease, opacity .18s ease;
        }
        .tc-login-tab {
          padding: 12px 14px; display:flex; align-items:center; justify-content:center; gap:8px;
          background: rgba(255,255,255,0.06); color:#fff7ea;
        }
        .tc-login-tab.active { background: linear-gradient(135deg, #f7c55e, #ffdf9a); color:#24180f; }
        .tc-login-form { display:grid; gap:12px; }
        .tc-label { font-size: 13px; font-weight: 700; color: rgba(255,247,234,0.82); }
        .tc-input {
          width: 100%; min-height: 50px; border-radius: 16px; border:1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05); color:#fff7ea; padding: 0 14px; outline:none;
        }
        .tc-input::placeholder { color: rgba(255,247,234,0.42); }
        .tc-phone-field {
          display:grid; grid-template-columns: auto 1fr; gap:10px; align-items:center;
        }
        .tc-phone-prefix {
          min-height:50px; display:grid; place-items:center; padding:0 16px; border-radius:16px;
          border:1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); font-weight:700;
        }
        .tc-phone-input { min-width: 0; }
        .tc-primary-btn {
          min-height: 52px; display:flex; align-items:center; justify-content:center; gap:10px;
          background: linear-gradient(135deg, #f7c55e, #ffdf9a); color:#24180f;
        }
        .tc-secondary-btn {
          min-height: 48px; padding: 0 14px; background: rgba(255,255,255,0.08); color:#fff7ea;
        }
        .tc-login-actions-grid { display:grid; grid-template-columns: repeat(2,1fr); gap:10px; }
        .tc-login-message {
          border-radius: 16px; padding: 14px 16px; background: rgba(255,255,255,0.06); color:#fff7ea;
          line-height: 1.5;
        }
        .tc-otp-box {
          display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:flex-start;
          border-radius:16px; padding: 14px 16px; background: rgba(255,255,255,0.05);
        }
        .tc-otp-box p { margin: 4px 0 0; color: rgba(255,247,234,0.78); }
        .tc-login-footer { display:grid; gap:10px; }
        .tc-login-foot-card {
          display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:center;
          border-radius:16px; padding: 12px 14px; background: rgba(255,255,255,0.05); color: rgba(255,247,234,0.82);
        }
        @media (max-width: 640px) {
          .tc-login-card { padding: 20px; border-radius: 22px; }
          .tc-login-brand h1 { font-size: 28px; }
          .tc-login-actions-grid, .tc-login-tabs { grid-template-columns: 1fr; }
          .tc-phone-field { grid-template-columns: 1fr; }
          .tc-phone-prefix { justify-self: start; }
        }
      `}</style>
    </main>
  );
}
