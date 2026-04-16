"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Mail, MessageCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY_CODE,
  buildInternationalPhone,
  formatCountryOptionLabel,
  getCountryByCode,
  normalizeLocalPhone,
} from "@/lib/countries";

const sb = supabaseBrowser();

type Channel = "whatsapp" | "email";

export default function ClienteRecuperarPage() {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildInternationalPhone(selectedCountry, phoneInput), [selectedCountry, phoneInput]);
  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

  async function sendCode(nextChannel: Channel) {
    if (!phoneDigits) {
      setMsg("Introduce un teléfono válido.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");
      setChannel(nextChannel);
      const endpoint = nextChannel === "email" ? "/api/cliente/auth/email/send" : "/api/cliente/auth/whatsapp/send";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No hemos podido enviar el código.");
      setChallengeToken(String(json?.challenge_token || ""));
      setStep("confirm");
      setMsg(nextChannel === "email" ? "Te hemos enviado un código por e-mail." : "Te hemos enviado un código por WhatsApp.");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido enviar el código.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (!code.trim()) {
      setMsg("Introduce el código que te hemos enviado.");
      return;
    }
    if (!password || password !== passwordConfirm) {
      setMsg("Las contraseñas no coinciden.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");
      const res = await fetch("/api/cliente/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneDigits,
          code: code.trim(),
          challenge_token: challengeToken,
          password,
          channel,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.alias_email) throw new Error(json?.error || "No hemos podido actualizar tu contraseña.");

      const { error } = await sb.auth.signInWithPassword({ email: String(json.alias_email), password });
      if (error) throw error;
      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido actualizar tu contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tc-reset-shell">
      <section className="tc-reset-card">
        <div className="tc-chip">Recuperar acceso</div>
        <h1>Crear una nueva contraseña</h1>
        <p>Verificamos tu teléfono con un código y te dejamos el acceso listo sin romper tu ficha actual.</p>

        {step === "request" ? (
          <div className="tc-reset-form">
            <select className="tc-input" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {formatCountryOptionLabel(option)}
                </option>
              ))}
            </select>
            <div className="tc-phone-field">
              <div className="tc-phone-prefix">{selectedCountry.dialCode}</div>
              <input
                className="tc-input tc-phone-input"
                inputMode="tel"
               placeholder={selectedCountry.hint || "600123123"}
                value={phoneInput}
                onChange={(e) => setPhoneInput(normalizeLocalPhone(e.target.value))}
              />
            </div>
            <div className="tc-reset-actions">
              <button className="tc-primary-btn" onClick={() => sendCode("whatsapp")} disabled={loading}>
                <MessageCircle size={18} /> {loading && channel === "whatsapp" ? "Enviando..." : "Código por WhatsApp"}
              </button>
              <button className="tc-secondary-btn" onClick={() => sendCode("email")} disabled={loading}>
                <Mail size={18} /> {loading && channel === "email" ? "Enviando..." : "Código por e-mail"}
              </button>
            </div>
          </div>
        ) : (
          <div className="tc-reset-form">
            <input className="tc-input" inputMode="numeric" placeholder="Código recibido" value={code} onChange={(e) => setCode(e.target.value)} />
            <input className="tc-input" type="password" placeholder="Nueva contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="tc-input" type="password" placeholder="Repite la contraseña" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
            <button className="tc-primary-btn" onClick={resetPassword} disabled={loading}>
              <KeyRound size={18} /> {loading ? "Guardando..." : "Guardar contraseña"}
            </button>
            <button className="tc-secondary-btn" onClick={() => setStep("request")} disabled={loading}>
              Volver
            </button>
          </div>
        )}

        {msg ? <div className="tc-reset-message">{msg}</div> : null}
      </section>

      <style jsx>{`
        .tc-reset-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px 16px;
          background: linear-gradient(180deg, #110d12 0%, #1a1320 100%);
        }
        .tc-reset-card {
          width: min(520px, 100%);
          border-radius: 24px;
          padding: 24px;
          display: grid;
          gap: 16px;
          color: #fff7ea;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(18, 13, 21, 0.94);
        }
        h1 { margin: 0; font-size: 30px; }
        p { margin: 0; color: rgba(255,247,234,0.75); line-height: 1.5; }
        .tc-reset-form { display: grid; gap: 12px; }
        .tc-phone-field { display:grid; grid-template-columns:auto 1fr; gap:10px; }
        .tc-phone-prefix, .tc-input {
          min-height: 50px; border-radius: 16px; border:1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05); color:#fff7ea; padding: 0 14px;
        }
        .tc-phone-prefix { display:grid; place-items:center; font-weight:700; }
        .tc-primary-btn, .tc-secondary-btn {
          min-height: 50px; border:0; border-radius:16px; cursor:pointer; font-weight:700;
          display:flex; align-items:center; justify-content:center; gap:8px;
        }
        .tc-primary-btn { background: linear-gradient(135deg, #f7c55e, #ffdf9a); color:#24180f; }
        .tc-secondary-btn { background: rgba(255,255,255,0.08); color:#fff7ea; }
        .tc-reset-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .tc-reset-message { border-radius:16px; padding: 14px 16px; background: rgba(255,255,255,0.05); }
        @media (max-width: 640px) {
          .tc-reset-actions, .tc-phone-field { grid-template-columns: 1fr; }
          .tc-phone-prefix { justify-self: start; }
        }
      `}</style>
    </main>
  );
}
