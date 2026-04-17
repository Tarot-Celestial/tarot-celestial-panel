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
      setMsg(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }

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
    } catch (e: any) {
      setMsg(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }

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

        <div className="brand">
          <Image src="/Nuevo-logo-tarot.png" alt="logo" width={70} height={70}/>
          <h1>Tarot Celestial</h1>
          <p>Accede o recibe un código por email</p>
        </div>

        <div className="tabs">
          <button className={mode==="password"?"active":""} onClick={()=>{setMode("password");setStep("phone");}}>
            <LockKeyhole size={16}/> Contraseña
          </button>
          <button className={mode==="otp"?"active":""} onClick={()=>{setMode("otp");setStep("phone");}}>
            <KeyRound size={16}/> Código
          </button>
        </div>

        {step==="phone" ? (
          <div className="form">

            <div className="field">
              <select value={countryCode} onChange={(e)=>setCountryCode(e.target.value)}>
                {COUNTRY_OPTIONS.map(o=>(
                  <option key={o.code} value={o.code}>
                    {formatCountryOptionLabel(o)}
                  </option>
                ))}
              </select>
              <label>País</label>
            </div>

            <div className="phone">
              <span>{selectedCountry.dialCode}</span>
              <div className="field">
                <input
                  value={phoneInput}
                  onChange={(e)=>setPhoneInput(normalizeLocalPhone(e.target.value))}
                />
                <label>Teléfono</label>
              </div>
            </div>

            {mode==="password" ? (
              <>
                <div className="field">
                  <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/>
                  <label>Contraseña</label>
                </div>

                <button className="primary" onClick={loginWithPassword}>
                  {loading ? "Entrando..." : "Entrar"}
                </button>
              </>
            ):(
              <button className="primary" onClick={sendEmailCode}>
                <Mail size={16}/> Enviar código
              </button>
            )}

          </div>
        ):(
          <div className="form">
            <div className="field">
              <input value={token} onChange={(e)=>setToken(e.target.value)}/>
              <label>Código</label>
            </div>

            <button className="primary" onClick={verifyEmailCode}>
              Verificar
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
          background:rgba(30,20,35,0.9);
          backdrop-filter: blur(10px);
          box-shadow:0 20px 80px rgba(0,0,0,0.6);
          display:flex;
          flex-direction:column;
          gap:20px;
        }

        .brand {text-align:center;}
        .tabs {display:flex;gap:10px;}

        .tabs button {
          flex:1;
          padding:10px;
          border-radius:10px;
          background:#2a202d;
          color:white;
          transition:.2s;
        }

        .tabs .active {
          background:#f7c55e;
          color:black;
        }

        .form {display:flex;flex-direction:column;gap:14px;}

        .field {
          position:relative;
        }

        input, select {
          width:100%;
          padding:14px;
          border-radius:10px;
          background:#2a202d;
          color:white;
          border:1px solid transparent;
        }

        input:focus, select:focus {
          border:1px solid #f7c55e;
          box-shadow:0 0 10px rgba(247,197,94,0.3);
        }

        label {
          position:absolute;
          top:50%;
          left:14px;
          transform:translateY(-50%);
          font-size:12px;
          color:#aaa;
          pointer-events:none;
          transition:.2s;
        }

        input:focus + label,
        input:not(:placeholder-shown) + label {
          top:-6px;
          font-size:10px;
          color:#f7c55e;
        }

        .phone {display:flex;gap:10px;}

        .phone span {
          padding:14px;
          background:#2a202d;
          border-radius:10px;
        }

        .primary {
          background:#f7c55e;
          color:black;
          padding:14px;
          border-radius:10px;
          font-weight:bold;
          transition:.2s;
        }

        .primary:hover {
          transform:translateY(-2px);
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
