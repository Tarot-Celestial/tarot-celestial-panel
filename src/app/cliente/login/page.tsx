"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LockKeyhole } from "lucide-react";
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

type LoginMode = "password" | "otp";

export default function ClienteLoginPage() {
  const router = useRouter();

  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<LoginMode>("password");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const selectedCountry = useMemo(
    () => getCountryByCode(countryCode),
    [countryCode]
  );

  const phone = useMemo(
    () => buildInternationalPhone(selectedCountry, phoneInput),
    [selectedCountry, phoneInput]
  );

  const phoneDigits = useMemo(
    () => phone.replace(/\D/g, ""),
    [phone]
  );

  useEffect(() => {
    const guessed = guessDefaultCountry();
    setCountryCode(guessed.code);

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
    <main className="tc-shell">
      <section className="tc-card">

        {/* 🔥 LOGO + BRAND */}
        <div className="tc-brand">
          <div className="tc-logo-wrap">
            <Image
              src="/Nuevo-logo-tarot.png"
              alt="Tarot Celestial"
              width={80}
              height={80}
              className="tc-logo"
              priority
            />
          </div>

          <div className="tc-chip">Acceso cliente</div>

          <h1>Tarot Celestial</h1>

          <p>
            Accede con tu teléfono y contraseña o entra con código si es tu primera vez.
          </p>
        </div>

        {/* 🔥 TABS PRO */}
        <div className="tc-tabs">
          <button
            className={`tc-tab ${mode === "password" ? "active" : ""}`}
            onClick={() => setMode("password")}
          >
            <LockKeyhole size={16} /> Contraseña
          </button>

          <button
            className={`tc-tab ${mode === "otp" ? "active" : ""}`}
            onClick={() => setMode("otp")}
          >
            <KeyRound size={16} /> Código
          </button>
        </div>

        {/* 🔥 FORM */}
        <div className="tc-form">
          <label>País</label>
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
          >
            {COUNTRY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {formatCountryOptionLabel(o)}
              </option>
            ))}
          </select>

          <label>Teléfono</label>
          <div className="tc-phone">
            <span>{selectedCountry.dialCode}</span>
            <input
              placeholder={selectedCountry.hint || "600123123"}
              value={phoneInput}
              onChange={(e) =>
                setPhoneInput(normalizeLocalPhone(e.target.value))
              }
            />
          </div>

          {mode === "password" && (
            <>
              <label>Contraseña</label>
              <input
                type="password"
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button onClick={loginWithPassword}>
                {loading ? "Entrando..." : "Entrar"}
              </button>

              <button
                className="secondary"
                onClick={() => router.push("/cliente/recuperar")}
              >
                He olvidado mi contraseña
              </button>
            </>
          )}
        </div>

        {msg && <div className="tc-msg">{msg}</div>}
      </section>

      <style jsx>{`
        .tc-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at top, rgba(247,197,94,0.15), transparent 30%),
            #0f0b10;
        }

        .tc-card {
          width: 420px;
          padding: 32px;
          border-radius: 24px;
          background: rgba(20,15,25,0.9);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 30px 80px rgba(0,0,0,0.6);
          display: grid;
          gap: 20px;
          color: #fff7ea;
        }

        .tc-brand {
          text-align: center;
          display: grid;
          gap: 10px;
          justify-items: center;
        }

        .tc-logo-wrap {
          padding: 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.05);
          backdrop-filter: blur(10px);
        }

        .tc-logo {
          filter: drop-shadow(0 0 12px rgba(247,197,94,0.4));
        }

        .tc-chip {
          font-size: 12px;
          padding: 6px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
        }

        h1 {
          margin: 0;
          font-size: 30px;
        }

        p {
          font-size: 14px;
          opacity: 0.8;
        }

        .tc-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .tc-tab {
          padding: 12px;
          border-radius: 14px;
          background: rgba(255,255,255,0.05);
        }

        .tc-tab.active {
          background: linear-gradient(135deg, #f7c55e, #ffdf9a);
          color: black;
        }

        .tc-form {
          display: grid;
          gap: 10px;
        }

        select,
        input {
          width: 100%;
          padding: 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          color: white;
        }

        .tc-phone {
          display: flex;
          gap: 10px;
        }

        .tc-phone span {
          padding: 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
        }

        button {
          padding: 14px;
          border-radius: 14px;
          background: linear-gradient(135deg, #f7c55e, #ffdf9a);
          color: black;
          font-weight: bold;
        }

        .secondary {
          background: rgba(255,255,255,0.08);
          color: white;
        }

        .tc-msg {
          background: rgba(255,255,255,0.08);
          padding: 10px;
          border-radius: 12px;
        }
      `}</style>
    </main>
  );
}
