"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LockKeyhole, ShieldCheck, Sparkles, Star, TimerReset } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

const STORAGE_COUNTRY_KEY = "tc_cliente_login_country";
const STORAGE_PHONE_KEY = "tc_cliente_login_phone";

type CountryOption = {
  code: string;
  prefix: string;
  label: string;
  hint?: string;
};

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "ES", prefix: "+34", label: "España", hint: "930 502 586" },
  { code: "PR", prefix: "+1", label: "Puerto Rico", hint: "787 945 0710" },
  { code: "US", prefix: "+1", label: "Estados Unidos", hint: "786 539 4750" },
  { code: "MX", prefix: "+52", label: "México" },
  { code: "AR", prefix: "+54", label: "Argentina" },
  { code: "CO", prefix: "+57", label: "Colombia" },
  { code: "CL", prefix: "+56", label: "Chile" },
  { code: "PE", prefix: "+51", label: "Perú" },
  { code: "DO", prefix: "+1", label: "República Dominicana" },
  { code: "VE", prefix: "+58", label: "Venezuela" },
];

function getCountryByCode(code: string | null | undefined): CountryOption {
  return COUNTRY_OPTIONS.find((item) => item.code === code) || COUNTRY_OPTIONS[0];
}

function guessDefaultCountry(): CountryOption {
  if (typeof navigator !== "undefined") {
    const locale = String(navigator.language || "").toUpperCase();
    const directMatch = COUNTRY_OPTIONS.find((item) => locale.endsWith(`-${item.code}`));
    if (directMatch) return directMatch;
  }
  return COUNTRY_OPTIONS[0];
}

function normalizeLocalPhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function buildSupabasePhone(prefix: string, localPhone: string): string {
  const cleanPrefix = String(prefix || "").trim();
  const cleanLocalPhone = normalizeLocalPhone(localPhone);
  if (!cleanPrefix || !cleanLocalPhone) return "";
  return `${cleanPrefix}${cleanLocalPhone}`;
}

export default function ClienteLoginPage() {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState<string>(COUNTRY_OPTIONS[0].code);
  const [phoneInput, setPhoneInput] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildSupabasePhone(selectedCountry.prefix, phoneInput), [selectedCountry.prefix, phoneInput]);

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
      setMsg(e?.message || "No hemos podido enviar el código.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!phone || !token.trim()) {
      setMsg("Introduce el código que has recibido.");
      return;
    }
    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.verifyOtp({ phone, token: token.trim(), type: "sms" });
      if (error) throw error;
      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e?.message || "Código incorrecto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tc-login-shell">
      <div className="tc-login-card">
        <section className="tc-login-showcase">
          <div style={{ display: "grid", gap: 22 }}>
            <div className="tc-login-logo">
              <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={72} height={72} priority style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="tc-chip" style={{ width: "fit-content" }}>Nuevo panel cliente</div>
              <div className="tc-brand-title" style={{ maxWidth: 520 }}>Tu espacio privado de Tarot Celestial</div>
              <div className="tc-brand-copy">
                Consulta en segundos tu rango, tus puntos, tus minutos disponibles y tus últimas consultas con un diseño más claro, moderno y cómodo.
              </div>
            </div>
          </div>

          <div className="tc-login-features">
            <div className="tc-login-feature">
              <div className="tc-row" style={{ gap: 10 }}><Star size={16} style={{ color: "var(--tc-gold-2)" }} /><strong>Ventajas visibles</strong></div>
              <div className="tc-list-item-sub">Tu rango y todos sus beneficios siempre a la vista.</div>
            </div>
            <div className="tc-login-feature">
              <div className="tc-row" style={{ gap: 10 }}><TimerReset size={16} style={{ color: "var(--tc-gold-2)" }} /><strong>Sesión recordada</strong></div>
              <div className="tc-list-item-sub">Si ya has entrado antes y tu sesión sigue activa, accederás directamente sin pedir SMS otra vez.</div>
            </div>
            <div className="tc-login-feature">
              <div className="tc-row" style={{ gap: 10 }}><Sparkles size={16} style={{ color: "var(--tc-gold-2)" }} /><strong>Acceso más claro</strong></div>
              <div className="tc-list-item-sub">Elige tu país en un desplegable y escribe solo tu número, sin tener que adivinar prefijos.</div>
            </div>
          </div>
        </section>

        <section className="tc-login-form">
          <div style={{ display: "grid", gap: 8 }}>
            <div className="tc-row" style={{ gap: 8, color: "var(--tc-gold-2)" }}><LockKeyhole size={16} /> Acceso seguro</div>
            <div className="tc-panel-title" style={{ fontSize: 30 }}>Entrar al panel</div>
            <div className="tc-panel-sub">Usa tu número de teléfono para acceder a tu área de cliente.</div>
          </div>

          {step === "phone" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">País</span>
                <div className="tc-country-select-wrap">
                  <select
                    className="tc-input tc-country-select"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
                    {COUNTRY_OPTIONS.map((item) => (
                      <option key={`${item.code}-${item.prefix}`} value={item.code}>
                        {item.label} ({item.prefix})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="tc-country-select-icon" />
                </div>
              </label>

              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">Teléfono</span>
                <div className="tc-phone-field">
                  <div className="tc-phone-prefix">{selectedCountry.prefix}</div>
                  <input
                    className="tc-input tc-phone-input"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder={selectedCountry.hint || "600000000"}
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(normalizeLocalPhone(e.target.value))}
                  />
                </div>
              </label>

              <div className="tc-card tc-golden-panel" style={{ padding: 14, display: "grid", gap: 8 }}>
                <div className="tc-row" style={{ gap: 8 }}><ShieldCheck size={16} /> <strong>Tu acceso quedará recordado</strong></div>
                <div className="tc-list-item-sub">
                  Solo te pediremos el SMS cuando sea necesario, por ejemplo si tu sesión ha caducado o cambias de dispositivo.
                </div>
              </div>

              <button className="tc-btn tc-btn-gold" disabled={loading} onClick={sendOtp}>
                {loading ? "Enviando..." : "Recibir código"}
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="tc-card tc-golden-panel" style={{ padding: 14 }}>
                Código enviado a <strong>{phone}</strong>
              </div>
              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">Código SMS</span>
                <input
                  className="tc-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <div className="tc-row">
                <button className="tc-btn" disabled={loading} onClick={() => setStep("phone")}>
                  Cambiar teléfono
                </button>
                <button className="tc-btn tc-btn-gold" disabled={loading} onClick={verifyOtp}>
                  {loading ? "Verificando..." : "Entrar"}
                </button>
              </div>
            </div>
          )}

          {msg ? <div className="tc-card">{msg}</div> : null}
        </section>
      </div>
    </div>
  );
}
