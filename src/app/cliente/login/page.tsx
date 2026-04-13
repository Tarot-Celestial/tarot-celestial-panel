"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LockKeyhole, ShieldCheck, Sparkles, Star, TimerReset } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY_CODE, buildInternationalPhone, formatCountryOptionLabel, getCountryByCode, guessDefaultCountry, normalizeLocalPhone } from "@/lib/countries";

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

  async function verifyOtp() {
    if (!phone || !token.trim()) {
      setMsg("Introduce el código que te hemos enviado.");
      return;
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
                      <option key={item.code} value={item.code}>{formatCountryOptionLabel(item)}</option>
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

              <button className="tc-ghost-btn" onClick={() => { setStep("phone"); setMsg(""); }} disabled={loading}>
                Cambiar número
              </button>
            </div>
          )}

          {msg ? <div className="tc-login-msg">{msg}</div> : null}
        </section>
      </div>
    </div>
  );
}
