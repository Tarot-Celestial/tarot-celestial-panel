"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LockKeyhole, Mail } from "lucide-react";
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

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [token, setToken] = useState("");
  const [challengeToken, setChallengeToken] = useState("");

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

  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

  useEffect(() => {
    const guessed = guessDefaultCountry();
    setCountryCode(guessed.code);

    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace("/cliente/dashboard");
    });
  }, [router]);

  // LOGIN PASSWORD
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

  // 📩 ENVIAR CÓDIGO EMAIL
  async function sendEmailCode() {
    if (!phoneDigits) return setMsg("Introduce un teléfono válido.");

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/cliente/auth/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) throw new Error(json?.error);

      setChallengeToken(json.challenge_token);
      setStep("otp");

      setMsg("Código enviado a tu email 📩");
    } catch (e: any) {
      setMsg(e.message || "Error enviando código");
    } finally {
      setLoading(false);
    }
  }

  // ✅ VERIFICAR CÓDIGO EMAIL
  async function verifyEmailCode() {
    if (!token.trim()) return setMsg("Introduce el código.");

    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/cliente/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneDigits,
          code: token,
          challenge_token: challengeToken,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) throw new Error(json?.error);

      window.location.href = json.action_link;
    } catch (e: any) {
      setMsg(e.message || "Código incorrecto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tc-shell">
      <section className="tc-card">

        {/* LOGO */}
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
            Accede con tu contraseña o recibe un código por email.
          </p>
        </div>

        <div className="tc-first-access">
          Primer acceso con código por email
        </div>

        {/* TABS */}
        <div className="tc-tabs">
          <button
            className={`tc-tab ${mode === "password" ? "active" : ""}`}
            onClick={() => {
              setMode("password");
              setStep("phone");
            }}
          >
            <LockKeyhole size={16} /> Contraseña
          </button>

          <button
            className={`tc-tab ${mode === "otp" ? "active" : ""}`}
            onClick={() => {
              setMode("otp");
              setStep("phone");
            }}
          >
            <KeyRound size={16} /> Código
          </button>
        </div>

        {/* FORM */}
        {step === "phone" ? (
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

            {mode === "password" ? (
              <>
                <label>Contraseña</label>
                <input
                  type="password"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <button className="btn-primary" onClick={loginWithPassword}>
                  {loading ? "Entrando..." : "Entrar"}
                </button>

                <button
                  className="btn-secondary"
                  onClick={() => router.push("/cliente/recuperar")}
                >
                  He olvidado mi contraseña
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={sendEmailCode}>
                <Mail size={16} /> Recibir código por email
              </button>
            )}
          </div>
        ) : (
          <div className="tc-form">
            <label>Código recibido</label>
            <input
              placeholder="123456"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />

            <button className="btn-primary" onClick={verifyEmailCode}>
              {loading ? "Verificando..." : "Verificar código"}
            </button>

            <button
              className="btn-secondary"
              onClick={() => setStep("phone")}
            >
              Volver
            </button>
          </div>
        )}

        {msg && <div className="tc-msg">{msg}</div>}
      </section>

      <style jsx>{`
        .tc-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(180deg, #0f0b10, #171019);
        }

        .tc-card {
          width: 420px;
          padding: 30px;
          border-radius: 20px;
          background: #1a141d;
          color: white;
          display: grid;
          gap: 20px;
        }

        select {
          background: #1a141d;
          color: white;
        }

        select option {
          background: #1a141d;
          color: white;
        }

        .btn-primary {
          background: linear-gradient(135deg, #f7c55e, #ffdf9a);
          color: black;
          padding: 14px;
          border-radius: 12px;
        }

        .btn-secondary {
          background: #2a202d;
          color: white;
          padding: 12px;
          border-radius: 12px;
        }

        .tc-msg {
          background: #2a202d;
          padding: 10px;
          border-radius: 10px;
        }
      `}</style>
    </main>
  );
}
