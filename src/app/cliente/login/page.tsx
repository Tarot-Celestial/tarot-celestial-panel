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
  }, [router]);

  async function loginWithPassword() {
    if (!phoneDigits) return setMsg("Introduce un teléfono válido.");
    if (!password.trim()) return setMsg("Escribe tu contraseña.");

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/cliente/auth/password/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits }),
      });

      const json = await res.json();
      const { error } = await sb.auth.signInWithPassword({
        email: json.alias_email,
        password,
      });

      if (error) throw error;

      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tc-login-shell">
      <section className="tc-login-card">

        {/* 🔥 LOGO LIMPIO */}
        <div className="tc-login-brand">
          <Image
            src="/Nuevo-logo-tarot.png"
            alt="Tarot Celestial"
            width={90}
            height={90}
            priority
          />
          <div className="tc-chip">Acceso cliente</div>
          <h1>Tarot Celestial</h1>
          <p>
            Entra con tu teléfono y contraseña o accede con código si es tu primera vez.
          </p>
        </div>

        {/* TABS */}
        <div className="tc-login-tabs">
          <button
            className={`tc-login-tab ${mode === "password" ? "active" : ""}`}
            onClick={() => setMode("password")}
          >
            <LockKeyhole size={16} /> Contraseña
          </button>
          <button
            className={`tc-login-tab ${mode === "otp" ? "active" : ""}`}
            onClick={() => setMode("otp")}
          >
            <KeyRound size={16} /> Código
          </button>
        </div>

        {/* FORM */}
        <div className="tc-login-form">
          <label className="tc-label">País</label>
          <select
            className="tc-input"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
          >
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
              className="tc-input"
              placeholder={selectedCountry.hint || "600123123"}
              value={phoneInput}
              onChange={(e) => setPhoneInput(normalizeLocalPhone(e.target.value))}
            />
          </div>

          {mode === "password" && (
            <>
              <label className="tc-label">Contraseña</label>
              <input
                className="tc-input"
                type="password"
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button className="tc-primary-btn" onClick={loginWithPassword}>
                {loading ? "Entrando..." : "Entrar"}
              </button>

              <button
                className="tc-secondary-btn"
                onClick={() => router.push("/cliente/recuperar")}
              >
                He olvidado mi contraseña
              </button>
            </>
          )}
        </div>

        {msg && <div className="tc-login-message">{msg}</div>}
      </section>

      <style jsx>{`
        .tc-login-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #0f0b10;
        }

        .tc-login-card {
          width: 420px;
          padding: 30px;
          border-radius: 20px;
          background: #1a141d;
          color: white;
          display: grid;
          gap: 20px;
        }

        .tc-login-brand {
          text-align: center;
          display: grid;
          gap: 10px;
          justify-items: center;
        }

        .tc-login-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .tc-login-tab {
          padding: 10px;
          border-radius: 10px;
          background: #2a202d;
        }

        .tc-login-tab.active {
          background: #f7c55e;
          color: black;
        }

        .tc-login-form {
          display: grid;
          gap: 10px;
        }

        .tc-input {
          padding: 10px;
          border-radius: 10px;
          background: #2a202d;
          color: white;
        }

        .tc-primary-btn {
          background: #f7c55e;
          padding: 12px;
          border-radius: 10px;
          color: black;
        }

        .tc-secondary-btn {
          background: #2a202d;
          padding: 10px;
          border-radius: 10px;
        }

        .tc-login-message {
          background: #2a202d;
          padding: 10px;
          border-radius: 10px;
        }
      `}</style>
    </main>
  );
}
