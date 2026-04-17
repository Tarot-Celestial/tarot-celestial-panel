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

  // EMAIL CODE
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

      if (!json?.ok) throw new Error(json?.error);

      setChallengeToken(json.challenge_token);
      setStep("otp");

      setMsg("Código enviado a tu email 📩");
    } catch (e: any) {
      setMsg(e.message || "Error enviando código");
    } finally {
      setLoading(false);
    }
  }

  // VERIFY EMAIL CODE
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

      if (!json?.ok) throw new Error(json?.error);

      window.location.href = json.action_link;
    } catch (e: any) {
      setMsg(e.message || "Código incorrecto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <div className="card">

        {/* BRAND */}
        <div className="brand">
          <Image
            src="/Nuevo-logo-tarot.png"
            alt="logo"
            width={70}
            height={70}
          />
          <h1>Tarot Celestial</h1>
          <p>Accede con contraseña o recibe un código por email</p>
        </div>

        {/* TABS */}
        <div className="tabs">
          <button
            className={mode === "password" ? "active" : ""}
            onClick={() => { setMode("password"); setStep("phone"); }}
          >
            <LockKeyhole size={16}/> Contraseña
          </button>

          <button
            className={mode === "otp" ? "active" : ""}
            onClick={() => { setMode("otp"); setStep("phone"); }}
          >
            <KeyRound size={16}/> Código
          </button>
        </div>

        {/* FORM */}
        {step === "phone" ? (
          <div className="form">

            <select value={countryCode} onChange={(e)=>setCountryCode(e.target.value)}>
              {COUNTRY_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>
                  {formatCountryOptionLabel(o)}
                </option>
              ))}
            </select>

            <div className="phone">
              <span>{selectedCountry.dialCode}</span>
              <input
                placeholder={selectedCountry.hint || "600123123"}
                value={phoneInput}
                onChange={(e)=>setPhoneInput(normalizeLocalPhone(e.target.value))}
              />
            </div>

            {mode === "password" ? (
              <>
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e)=>setPassword(e.target.value)}
                />

                <button className="primary" onClick={loginWithPassword}>
                  {loading ? "Entrando..." : "Entrar"}
                </button>

                <button className="secondary" onClick={()=>router.push("/cliente/recuperar")}>
                  He olvidado mi contraseña
                </button>
              </>
            ) : (
              <button className="primary" onClick={sendEmailCode}>
                <Mail size={16}/> Enviar código por email
              </button>
            )}

          </div>
        ) : (
          <div className="form">

            <input
              placeholder="Código"
              value={token}
              onChange={(e)=>setToken(e.target.value)}
            />

            <button className="primary" onClick={verifyEmailCode}>
              {loading ? "Verificando..." : "Verificar"}
            </button>

            <button className="secondary" onClick={()=>setStep("phone")}>
              Volver
            </button>

          </div>
        )}

        {msg && <div className="msg">{msg}</div>}
      </div>

      <style jsx>{`
        .shell {
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          background:#0f0b10;
        }

        .card {
          width:380px;
          padding:30px;
          border-radius:20px;
          background:#1a141d;
          display:flex;
          flex-direction:column;
          gap:20px;
        }

        .brand {
          text-align:center;
        }

        .brand h1 {
          margin:10px 0 5px;
        }

        .tabs {
          display:flex;
          gap:10px;
        }

        .tabs button {
          flex:1;
          padding:10px;
          border-radius:10px;
          background:#2a202d;
          color:white;
        }

        .tabs .active {
          background:#f7c55e;
          color:black;
        }

        .form {
          display:flex;
          flex-direction:column;
          gap:10px;
        }

        select, input {
          padding:12px;
          border-radius:10px;
          background:#2a202d;
          color:white;
        }

        select option {
          background:#1a141d;
        }

        .phone {
          display:flex;
          gap:10px;
        }

        .phone span {
          padding:12px;
          background:#2a202d;
          border-radius:10px;
        }

        .primary {
          background:#f7c55e;
          color:black;
          padding:12px;
          border-radius:10px;
        }

        .secondary {
          background:#2a202d;
          color:white;
          padding:10px;
          border-radius:10px;
        }

        .msg {
          background:#2a202d;
          padding:10px;
          border-radius:10px;
        }
      `}</style>
    </main>
  );
}
