"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LockKeyhole, ShieldCheck, Sparkles, Star, TimerReset } from "lucide-react";
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

export default function ClienteLoginPage() {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState<string>(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildInternationalPhone(selectedCountry, phoneInput), [selectedCountry, phoneInput]);

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
      if (data.session?.user?.phone) {
        router.replace("/cliente/dashboard");
      }
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user?.phone) {
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

 async function sendOtp() {
  if (!phone) {
    setMsg("Introduce un teléfono válido.");
    return;
  }

  try {
    setLoading(true);
    setMsg("");

    // 🔥 LIMPIAR TELÉFONO (clave)
    const cleanPhone = phone.replace(/\D/g, "");

    // 🔥 VALIDAR EN CRM
    const { data: cliente, error: clienteError } = await sb
      .from("crm_clientes")
      .select("id")
      .eq("telefono_normalizado", cleanPhone)
      .maybeSingle();

    if (clienteError) throw clienteError;

    if (!cliente) {
      setMsg("❌ Este teléfono no está registrado.");
      return;
    }

    // ✅ ENVIAR OTP
    const { error } = await sb.auth.signInWithOtp({ phone });
    if (error) throw error;

    setStep("otp");
    setMsg("Te hemos enviado un código por SMS.");

  } catch (e: any) {
    setMsg(e?.message || "No se pudo enviar el código.");
  } finally {
    setLoading(false);
  }
}
    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.verifyOtp({ phone, token: token.trim(), type: "sms" });
      if (error) throw error;
      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e?.message || "Código inválido.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tc-login-shell">
      <div className="tc-login-card">
        <section className="tc-login-side">
          <div className="tc-login-badge">
            <Sparkles size={14} /> Tarot Celestial · Acceso cliente
          </div>

          <div className="tc-brand-row">
            <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={86} height={86} priority className="tc-logo" />
            <div>
              <h1>Entra a tu área privada</h1>
              <p>Recibe tu código por SMS y accede en segundos a tus bonos, reservas y consultas.</p>
            </div>
          </div>

          <div className="tc-benefits">
            <article>
              <ShieldCheck size={18} />
              <div>
                <strong>Acceso seguro</strong>
                <span>Solo tú recibes el código de acceso en tu móvil.</span>
              </div>
            </article>
            <article>
              <TimerReset size={18} />
              <div>
                <strong>Sin contraseñas</strong>
                <span>Entra rápido con tu número y retoma donde lo dejaste.</span>
              </div>
            </article>
            <article>
              <Star size={18} />
              <div>
                <strong>Cobertura global</strong>
                <span>Selecciona cualquier país y usa su prefijo internacional.</span>
              </div>
            </article>
          </div>
        </section>

        <section className="tc-login-panel">
          <div className="tc-login-panel-head">
            <span className="tc-kicker">Bienvenida</span>
            <h2>{step === "phone" ? "Identifícate con tu móvil" : "Confirma el código"}</h2>
            <p>
              {step === "phone"
                ? "Selecciona tu país, escribe tu teléfono y te mandamos un SMS para entrar."
                : `Introduce el código que hemos enviado a ${phone || selectedCountry.dialCode}.`}
            </p>
          </div>

          {step === "phone" ? (
            <div className="tc-form-grid">
              <label className="tc-field">
                <span>País</span>
                <div className="tc-country-select-wrap">
                  <select className="tc-country-select" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                    {COUNTRY_OPTIONS.map((item) => (
                      <option key={item.code} value={item.code}>
                        {formatCountryOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="tc-country-select-icon" />
                </div>
              </label>

              <label className="tc-field">
                <span>Teléfono</span>
                <div className="tc-phone-field">
                  <div className="tc-phone-prefix">{selectedCountry.dialCode}</div>
                  <input
                    className="tc-input tc-phone-input"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder={selectedCountry.hint || "612345678"}
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                  />
                </div>
              </label>

              <button className="tc-primary-btn" onClick={sendOtp} disabled={loading}>
                {loading ? "Enviando código…" : "Enviar SMS"}
              </button>
            </div>
          ) : (
            <div className="tc-form-grid">
              <label className="tc-field">
                <span>Código SMS</span>
                <div className="tc-inline-input">
                  <LockKeyhole size={16} />
                  <input
                    className="tc-plain-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={token}
                    onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </label>

              <button className="tc-primary-btn" onClick={verifyOtp} disabled={loading}>
                {loading ? "Verificando…" : "Entrar al panel"}
              </button>

              <button
                className="tc-ghost-btn"
                onClick={() => {
                  setStep("phone");
                  setMsg("");
                }}
                disabled={loading}
              >
                Cambiar número
              </button>
            </div>
          )}

          {msg ? <div className="tc-login-msg">{msg}</div> : null}
        </section>
      </div>

      <style jsx>{`
        .tc-login-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 32px 18px;
          background:
            radial-gradient(circle at top left, rgba(215, 181, 109, 0.18), transparent 28%),
            radial-gradient(circle at bottom right, rgba(124, 58, 237, 0.18), transparent 26%),
            linear-gradient(180deg, #08070d 0%, #05060d 100%);
        }

        .tc-login-card {
          width: min(100%, 1080px);
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
          gap: 0;
          border-radius: 30px;
          overflow: hidden;
          background: rgba(10, 8, 14, 0.88);
          border: 1px solid rgba(215, 181, 109, 0.16);
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(16px);
        }

        .tc-login-side,
        .tc-login-panel {
          padding: 34px;
        }

        .tc-login-side {
          display: grid;
          gap: 26px;
          background:
            radial-gradient(circle at top left, rgba(215, 181, 109, 0.14), transparent 32%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
          border-right: 1px solid rgba(255, 255, 255, 0.06);
        }

        .tc-login-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          padding: 10px 14px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #f8e7c0;
          background: rgba(215, 181, 109, 0.12);
          border: 1px solid rgba(215, 181, 109, 0.2);
        }

        .tc-brand-row {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 18px;
        }

        .tc-logo {
          border-radius: 24px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);
        }

        .tc-brand-row h1 {
          margin: 0 0 10px;
          font-size: clamp(34px, 5vw, 52px);
          line-height: 1.02;
          font-weight: 900;
          color: #fffaf0;
        }

        .tc-brand-row p {
          margin: 0;
          font-size: 17px;
          line-height: 1.65;
          color: #f1f5f9;
          max-width: 560px;
        }

        .tc-benefits {
          display: grid;
          gap: 14px;
        }

        .tc-benefits article {
          display: grid;
          grid-template-columns: 20px 1fr;
          gap: 12px;
          align-items: start;
          padding: 16px 18px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          color: #e2e8f0;
        }

        .tc-benefits strong {
          display: block;
          margin-bottom: 4px;
          font-size: 16px;
          color: #fff;
        }

        .tc-benefits span {
          display: block;
          line-height: 1.55;
        }

        .tc-login-panel {
          display: grid;
          align-content: center;
          gap: 24px;
          background: linear-gradient(180deg, rgba(12, 10, 18, 0.96), rgba(8, 8, 12, 0.98));
        }

        .tc-login-panel-head {
          display: grid;
          gap: 10px;
        }

        .tc-kicker {
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #d7b56d;
        }

        .tc-login-panel-head h2 {
          margin: 0;
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.08;
          font-weight: 900;
          color: #fff;
        }

        .tc-login-panel-head p {
          margin: 0;
          color: #cbd5e1;
          line-height: 1.65;
          font-size: 15px;
        }

        .tc-form-grid {
          display: grid;
          gap: 18px;
        }

        .tc-field {
          display: grid;
          gap: 9px;
        }

        .tc-field > span {
          color: #f8fafc;
          font-size: 14px;
          font-weight: 800;
        }

        .tc-country-select-wrap,
        .tc-phone-field,
        .tc-inline-input {
          display: flex;
          align-items: center;
          min-height: 58px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.045);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .tc-country-select-wrap:focus-within,
        .tc-phone-field:focus-within,
        .tc-inline-input:focus-within {
          border-color: rgba(215, 181, 109, 0.48);
          box-shadow: 0 0 0 4px rgba(215, 181, 109, 0.12);
          background: rgba(255, 255, 255, 0.06);
        }

        .tc-country-select-wrap {
          position: relative;
          padding-right: 46px;
        }

        .tc-country-select {
          width: 100%;
          height: 58px;
          appearance: none;
          border: none;
          outline: none;
          background: transparent;
          color: #fff;
          font-size: 15px;
          padding: 0 18px;
          border-radius: 18px;
        }

        .tc-country-select option {
          color: #0f172a;
          background: #fff;
        }

        .tc-country-select-icon {
          position: absolute;
          right: 16px;
          pointer-events: none;
          color: #d7b56d;
        }

        .tc-phone-prefix {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 82px;
          align-self: stretch;
          padding: 0 16px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          color: #fff4d6;
          font-size: 18px;
          font-weight: 900;
          background: rgba(215, 181, 109, 0.08);
          border-top-left-radius: 18px;
          border-bottom-left-radius: 18px;
        }

        .tc-input,
        .tc-plain-input {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          color: #fff;
          font-size: 17px;
          padding: 0 18px;
        }

        .tc-phone-input {
          height: 58px;
        }

        .tc-inline-input {
          gap: 10px;
          padding: 0 16px;
          color: #d7b56d;
        }

        .tc-plain-input {
          height: 56px;
          padding: 0;
        }

        .tc-input::placeholder,
        .tc-plain-input::placeholder {
          color: #94a3b8;
        }

        .tc-primary-btn,
        .tc-ghost-btn {
          min-height: 56px;
          border-radius: 18px;
          border: none;
          cursor: pointer;
          font-size: 15px;
          font-weight: 900;
          transition: transform 0.16s ease, opacity 0.16s ease, box-shadow 0.16s ease;
        }

        .tc-primary-btn {
          color: #140d00;
          background: linear-gradient(135deg, #f1ddb1 0%, #d7b56d 45%, #b58323 100%);
          box-shadow: 0 18px 34px rgba(181, 131, 35, 0.26);
        }

        .tc-primary-btn:hover:not(:disabled),
        .tc-ghost-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .tc-ghost-btn {
          color: #fff;
          background: rgba(255, 255, 255, 0.055);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .tc-primary-btn:disabled,
        .tc-ghost-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none;
        }

        .tc-login-msg {
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid rgba(215, 181, 109, 0.18);
          background: rgba(255, 255, 255, 0.045);
          color: #e2e8f0;
          line-height: 1.55;
          font-size: 14px;
        }

        @media (max-width: 980px) {
          .tc-login-card {
            grid-template-columns: 1fr;
          }

          .tc-login-side,
          .tc-login-panel {
            padding: 26px;
          }

          .tc-login-side {
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }
        }

        @media (max-width: 640px) {
          .tc-login-shell {
            padding: 16px;
          }

          .tc-login-side,
          .tc-login-panel {
            padding: 20px;
          }

          .tc-brand-row {
            grid-template-columns: 1fr;
            justify-items: start;
          }

          .tc-brand-row h1 {
            font-size: 34px;
          }

          .tc-phone-prefix {
            min-width: 74px;
            font-size: 16px;
            padding: 0 12px;
          }
        }
      `}</style>
    </div>
  );
}
