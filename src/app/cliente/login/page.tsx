"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Sparkles } from "lucide-react";
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

type LoginMode = "password" | "setup";

export default function ClienteLoginPage() {
  const router = useRouter();

  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState("");
  const [password, setPassword] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState("");
  const [mode, setMode] = useState<LoginMode>("password");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildInternationalPhone(selectedCountry, phoneInput), [selectedCountry, phoneInput]);
  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

  useEffect(() => {
    const guessed = guessDefaultCountry();
    setCountryCode(guessed.code);

    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace("/cliente/dashboard");
    });
  }, [router]);

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

      const res = await fetch("/api/cliente/auth/password/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.alias_email) {
        throw new Error(json?.error || "No hemos podido preparar tu acceso.");
      }

      const { error } = await sb.auth.signInWithPassword({
        email: String(json.alias_email),
        password,
      });
      if (error) throw error;

      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  async function createFirstAccessPassword() {
    if (!phoneDigits) {
      setMsg("Introduce un teléfono válido.");
      return;
    }
    if (!createPassword.trim() || createPassword.length < 6) {
      setMsg("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (createPassword !== createPasswordConfirm) {
      setMsg("Las contraseñas no coinciden.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/cliente/auth/password/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneDigits,
          password: createPassword,
          password_confirm: createPasswordConfirm,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.alias_email) {
        throw new Error(json?.error || "No hemos podido crear tu acceso.");
      }

      const { error } = await sb.auth.signInWithPassword({
        email: String(json.alias_email),
        password: createPassword,
      });
      if (error) throw error;

      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido crear tu acceso.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tc-shell">
      <section className="tc-card">
        <div className="tc-brand">
          <div className="tc-logo-wrap">
            <Image
              src="/Nuevo-logo-tarot.png"
              alt="Tarot Celestial"
              width={78}
              height={78}
              className="tc-logo"
              priority
            />
          </div>
          <div className="tc-chip">Acceso cliente</div>
          <h1>Tarot Celestial</h1>
          <p>
            Accede con tu contraseña o crea tu acceso la primera vez usando solo tu número.
          </p>
        </div>

        <div className="tc-tabs" role="tablist" aria-label="Modo de acceso">
          <button
            type="button"
            className={`tc-tab ${mode === "password" ? "active" : ""}`}
            onClick={() => {
              setMode("password");
              setMsg("");
            }}
          >
            <LockKeyhole size={16} /> Ya tengo contraseña
          </button>
          <button
            type="button"
            className={`tc-tab ${mode === "setup" ? "active" : ""}`}
            onClick={() => {
              setMode("setup");
              setMsg("");
            }}
          >
            <Sparkles size={16} /> Primer acceso
          </button>
        </div>

        <div className="tc-form">
          <div className="tc-field">
            <label className="tc-label">País</label>
            <div className="tc-select-wrap">
              <select
                className="tc-input"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                {COUNTRY_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {formatCountryOptionLabel(o)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="tc-field">
            <label className="tc-label">Teléfono</label>
            <div className="tc-phone-row">
              <div className="tc-phone-prefix">{selectedCountry.dialCode}</div>
              <input
                className="tc-input"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={selectedCountry.hint || "600123123"}
                value={phoneInput}
                onChange={(e) => setPhoneInput(normalizeLocalPhone(e.target.value))}
              />
            </div>
          </div>

          {mode === "password" ? (
            <>
              <div className="tc-field">
                <label className="tc-label">Contraseña</label>
                <input
                  className="tc-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button type="button" className="tc-primary-btn" onClick={loginWithPassword} disabled={loading}>
                <LockKeyhole size={18} />
                {loading ? "Entrando..." : "Entrar"}
              </button>

              <button
                type="button"
                className="tc-secondary-btn"
                onClick={() => router.push("/cliente/recuperar")}
                disabled={loading}
              >
                He olvidado mi contraseña
              </button>
            </>
          ) : (
            <>
              <div className="tc-setup-note">
                Si es tu primera vez, crea aquí tu contraseña y entrarás directamente al panel.
              </div>

              <div className="tc-field">
                <label className="tc-label">Nueva contraseña</label>
                <input
                  className="tc-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Mínimo 6 caracteres"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                />
              </div>

              <div className="tc-field">
                <label className="tc-label">Repite la contraseña</label>
                <input
                  className="tc-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repite la contraseña"
                  value={createPasswordConfirm}
                  onChange={(e) => setCreatePasswordConfirm(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="tc-primary-btn"
                onClick={createFirstAccessPassword}
                disabled={loading}
              >
                <Sparkles size={18} />
                {loading ? "Creando acceso..." : "Crear acceso"}
              </button>
            </>
          )}
        </div>

        {msg ? <div className="tc-msg">{msg}</div> : null}
      </section>

      <style jsx>{`
        .tc-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          background:
            radial-gradient(circle at 50% 0%, rgba(247, 197, 94, 0.14), transparent 32%),
            linear-gradient(180deg, #0d0911 0%, #17101b 100%);
        }

        .tc-card {
          width: 100%;
          max-width: 440px;
          padding: 30px;
          border-radius: 28px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(24, 18, 30, 0.92);
          box-shadow: 0 30px 80px rgba(0,0,0,0.55);
          color: #fff7ea;
          display: grid;
          gap: 18px;
          backdrop-filter: blur(10px);
        }

        .tc-brand {
          display: grid;
          justify-items: center;
          text-align: center;
          gap: 10px;
        }

        .tc-logo-wrap {
          width: 96px;
          height: 96px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(247,197,94,0.16), rgba(255,255,255,0.03));
          border: 1px solid rgba(255,255,255,0.07);
        }

        .tc-logo {
          object-fit: contain;
          filter: drop-shadow(0 0 14px rgba(247,197,94,0.28));
        }

        .tc-chip {
          padding: 7px 14px;
          border-radius: 999px;
          font-size: 12px;
          color: #fff7ea;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
        }

        h1 {
          margin: 0;
          font-size: 26px;
          line-height: 1.1;
        }

        p {
          margin: 0;
          color: rgba(255,247,234,0.78);
          line-height: 1.55;
          font-size: 14px;
        }

        .tc-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .tc-tab {
          min-height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.05);
          color: #fff7ea;
          font-weight: 700;
          transition: transform .18s ease, background .18s ease, border-color .18s ease;
        }

        .tc-tab:hover {
          transform: translateY(-1px);
        }

        .tc-tab.active {
          background: linear-gradient(135deg, #f7c55e, #ffdf9a);
          border-color: rgba(247,197,94,0.55);
          color: #24180f;
          box-shadow: 0 10px 24px rgba(247,197,94,0.16);
        }

        .tc-form {
          display: grid;
          gap: 12px;
        }

        .tc-field {
          display: grid;
          gap: 8px;
        }

        .tc-label {
          font-size: 13px;
          font-weight: 700;
          color: rgba(255,247,234,0.86);
        }

        .tc-select-wrap {
          position: relative;
        }

        .tc-select-wrap::after {
          content: "";
          position: absolute;
          top: 50%;
          right: 16px;
          width: 10px;
          height: 10px;
          border-right: 2px solid rgba(255,247,234,0.55);
          border-bottom: 2px solid rgba(255,247,234,0.55);
          transform: translateY(-65%) rotate(45deg);
          pointer-events: none;
        }

        .tc-input {
          width: 100%;
          min-height: 50px;
          padding: 0 14px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          color: #fff7ea;
          outline: none;
          transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
        }

        .tc-input::placeholder {
          color: rgba(255,247,234,0.35);
        }

        .tc-input:focus {
          border-color: rgba(247,197,94,0.55);
          box-shadow: 0 0 0 3px rgba(247,197,94,0.12);
          background: rgba(255,255,255,0.08);
        }

        select.tc-input {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          padding-right: 42px;
          background-color: rgba(255,255,255,0.06);
          color: #fff7ea;
        }

        select.tc-input option {
          background: #1b1520;
          color: #fff7ea;
        }

        .tc-phone-row {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 10px;
        }

        .tc-phone-prefix {
          min-width: 72px;
          min-height: 50px;
          display: grid;
          place-items: center;
          padding: 0 16px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.06);
          font-weight: 800;
          color: #fff7ea;
        }

        .tc-primary-btn,
        .tc-secondary-btn {
          min-height: 52px;
          border: 0;
          border-radius: 16px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform .18s ease, opacity .18s ease, box-shadow .18s ease;
        }

        .tc-primary-btn {
          background: linear-gradient(135deg, #f7c55e, #ffdf9a);
          color: #24180f;
          box-shadow: 0 14px 28px rgba(247,197,94,0.16);
        }

        .tc-secondary-btn {
          background: rgba(255,255,255,0.07);
          color: #fff7ea;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .tc-primary-btn:hover,
        .tc-secondary-btn:hover {
          transform: translateY(-1px);
        }

        .tc-primary-btn:disabled,
        .tc-secondary-btn:disabled,
        .tc-tab:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .tc-setup-note {
          border-radius: 16px;
          padding: 12px 14px;
          background: rgba(255,255,255,0.05);
          color: rgba(255,247,234,0.78);
          line-height: 1.5;
          font-size: 13px;
        }

        .tc-msg {
          border-radius: 16px;
          padding: 13px 14px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          color: #fff7ea;
          line-height: 1.45;
        }

        @media (max-width: 520px) {
          .tc-card {
            padding: 22px;
            border-radius: 22px;
          }

          .tc-tabs {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
