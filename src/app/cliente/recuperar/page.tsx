"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import ClientAuthShell from "@/components/cliente/ClientAuthShell";
import styles from "@/components/cliente/ClientAuthShell.module.css";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY_CODE,
  buildInternationalPhone,
  getCountryByCode,
  guessDefaultCountry,
  normalizeLocalPhone,
} from "@/lib/countries";
import {
  countryFlag,
  friendlyAuthError,
  localPhoneMaxLength,
  validateLocalPhone,
} from "@/lib/client-auth-ui";

const sb = supabaseClienteBrowser();
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loadingChannel, setLoadingChannel] = useState<Channel | "reset" | "">("");
  const [phoneError, setPhoneError] = useState("");
  const [msg, setMsg] = useState("");
  const [successMessage, setSuccessMessage] = useState(false);

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildInternationalPhone(selectedCountry, phoneInput), [selectedCountry, phoneInput]);
  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);
  const loading = Boolean(loadingChannel);

  useEffect(() => setCountryCode(guessDefaultCountry().code), []);

  function updatePhone(value: string) {
    setPhoneInput(normalizeLocalPhone(value).slice(0, localPhoneMaxLength(selectedCountry)));
    setPhoneError("");
    setMsg("");
  }

  function validatePhone() {
    const error = validateLocalPhone(selectedCountry, phoneInput);
    setPhoneError(error);
    return !error;
  }

  async function sendCode(nextChannel: Channel) {
    if (loading || !validatePhone()) return;
    try {
      setLoadingChannel(nextChannel);
      setMsg("");
      setSuccessMessage(false);
      setChannel(nextChannel);
      const endpoint = nextChannel === "email" ? "/api/cliente/auth/email/send" : "/api/cliente/auth/whatsapp/send";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "SEND_CODE_FAILED");
      setChallengeToken(String(json?.challenge_token || ""));
      setStep("confirm");
      setSuccessMessage(true);
      setMsg(nextChannel === "email" ? "Código enviado a tu e-mail registrado." : "Código enviado a tu WhatsApp registrado.");
    } catch (error) {
      setSuccessMessage(false);
      setMsg(friendlyAuthError(error, "No hemos podido enviar el código. Inténtalo de nuevo."));
    } finally {
      setLoadingChannel("");
    }
  }

  async function resetPassword() {
    if (loading) return;
    if (!code.trim()) {
      setSuccessMessage(false);
      setMsg("Escribe el código que te hemos enviado.");
      return;
    }
    if (password.length < 6) {
      setSuccessMessage(false);
      setMsg("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== passwordConfirm) {
      setSuccessMessage(false);
      setMsg("Las contraseñas no coinciden.");
      return;
    }

    try {
      setLoadingChannel("reset");
      setMsg("");
      const res = await fetch("/api/cliente/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits, code: code.trim(), challenge_token: challengeToken, password, channel }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.alias_email) throw new Error(json?.error || "RESET_FAILED");

      const credentials = json.auth_phone
        ? { phone: String(json.auth_phone), password }
        : { email: String(json.alias_email), password };
      const { error } = await sb.auth.signInWithPassword(credentials);
      if (error) throw error;
      router.replace("/cliente/dashboard");
    } catch (error) {
      setSuccessMessage(false);
      setMsg(friendlyAuthError(error, "No hemos podido actualizar tu contraseña."));
    } finally {
      setLoadingChannel("");
    }
  }

  function submitConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "confirm") void resetPassword();
  }

  return (
    <ClientAuthShell
      eyebrow="Recuperación segura"
      title="Recupera tu acceso"
      subtitle={step === "request" ? "Recupera tu acceso de forma sencilla y protegida." : "Verifica el código y crea una nueva contraseña."}
      footer="Solo utilizamos los datos ya asociados a tu cuenta."
    >
      <div className={styles.stepIndicator} aria-label={`Paso ${step === "request" ? "1" : "2"} de 2`}>
        <span className={`${styles.stepItem} ${step === "request" ? styles.stepItemActive : ""}`}><i>1</i><b>Identificación</b></span>
        <span className={styles.stepLine} aria-hidden="true" />
        <span className={`${styles.stepItem} ${step === "confirm" ? styles.stepItemActive : ""}`}><i>2</i><b>Nueva contraseña</b></span>
      </div>

      {step === "request" ? (
        <div key="request" className={styles.modePanel}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-country">País</label>
            <div className={styles.selectShell}>
              <span className={styles.flag} aria-hidden="true">{countryFlag(selectedCountry.code)}</span>
              <select
                id="reset-country"
                className={styles.select}
                value={countryCode}
                onChange={(event) => {
                  setCountryCode(event.target.value);
                  setPhoneInput("");
                  setPhoneError("");
                  setMsg("");
                }}
                disabled={loading}
              >
                {COUNTRY_OPTIONS.map((country) => (
                  <option key={country.code} value={country.code}>
                    {countryFlag(country.code)} {country.label} · {country.dialCode}
                  </option>
                ))}
              </select>
              <ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-phone">Teléfono asociado a tu cuenta</label>
            <div className={`${styles.phoneShell} ${phoneError ? styles.invalid : ""}`}>
              <span className={styles.prefix}>{selectedCountry.dialCode}</span>
              <Phone className={styles.fieldIcon} size={16} aria-hidden="true" />
              <input
                id="reset-phone"
                className={styles.input}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={selectedCountry.hint || "Tu número"}
                value={phoneInput}
                maxLength={localPhoneMaxLength(selectedCountry)}
                onChange={(event) => updatePhone(event.target.value)}
                onBlur={validatePhone}
                aria-invalid={Boolean(phoneError)}
                disabled={loading}
              />
            </div>
            {phoneError ? <span className={styles.errorText}>{phoneError}</span> : <span className={styles.help}>El código llegará al canal que elijas.</span>}
          </div>

          <div className={styles.note}>
            <ShieldCheck size={16} />
            <span>Elige dónde quieres recibir el código de verificación.</span>
          </div>

          <div className={styles.actionGrid}>
            <button type="button" className={styles.primaryButton} onClick={() => void sendCode("whatsapp")} disabled={loading}>
              {loadingChannel === "whatsapp" ? <LoaderCircle className={styles.spinner} size={18} /> : <MessageCircle size={18} />}
              WhatsApp
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => void sendCode("email")} disabled={loading}>
              {loadingChannel === "email" ? <LoaderCircle className={styles.spinner} size={18} /> : <Mail size={18} />}
              E-mail
            </button>
          </div>

          <button type="button" className={styles.linkButton} onClick={() => router.push("/cliente/login")} disabled={loading}>
            <ArrowLeft size={15} /> Volver al inicio de sesión
          </button>
        </div>
      ) : (
        <form key="confirm" className={styles.modePanel} onSubmit={submitConfirm} noValidate>
          <div className={styles.note}>
            {channel === "email" ? <Mail size={16} /> : <MessageCircle size={16} />}
            <span>Hemos enviado el código por {channel === "email" ? "e-mail" : "WhatsApp"} al número seleccionado.</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-code">Código de verificación</label>
            <div className={styles.inputShell}>
              <KeyRound className={styles.fieldIcon} size={16} aria-hidden="true" />
              <input id="reset-code" className={styles.input} inputMode="numeric" autoComplete="one-time-code" placeholder="Código recibido" value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 8)); setMsg(""); }} disabled={loading} />
            </div>
          </div>

          <RecoveryPasswordField id="reset-password" label="Nueva contraseña" value={password} visible={showPassword} onToggle={() => setShowPassword((current) => !current)} onChange={(value) => { setPassword(value); setMsg(""); }} loading={loading} />
          <RecoveryPasswordField id="reset-password-confirm" label="Repite la contraseña" value={passwordConfirm} visible={showConfirm} onToggle={() => setShowConfirm((current) => !current)} onChange={(value) => { setPasswordConfirm(value); setMsg(""); }} loading={loading} />

          <button type="submit" className={styles.primaryButton} disabled={loading}>
            {loadingChannel === "reset" ? <LoaderCircle className={styles.spinner} size={18} /> : <LockKeyhole size={18} />}
            {loadingChannel === "reset" ? "Guardando contraseña..." : "Guardar y entrar"}
            {!loading ? <ArrowRight size={17} /> : null}
          </button>

          <button type="button" className={styles.linkButton} onClick={() => { setStep("request"); setMsg(""); setSuccessMessage(false); }} disabled={loading}>
            <ArrowLeft size={15} /> Solicitar otro código
          </button>
        </form>
      )}

      {msg ? (
        <div
          className={`${styles.message} ${successMessage ? styles.messageSuccess : ""}`}
          role={successMessage ? "status" : "alert"}
          aria-live="polite"
        >
          {successMessage ? <ShieldCheck size={17} /> : <AlertCircle size={17} />}<span>{msg}</span>
        </div>
      ) : null}
    </ClientAuthShell>
  );
}

function RecoveryPasswordField({ id, label, value, visible, onToggle, onChange, loading }: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  loading: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <div className={styles.inputShell}>
        <LockKeyhole className={styles.fieldIcon} size={16} aria-hidden="true" />
        <input id={id} className={styles.input} type={visible ? "text" : "password"} autoComplete="new-password" placeholder="Mínimo 6 caracteres" minLength={6} value={value} onChange={(event) => onChange(event.target.value)} disabled={loading} />
        <button type="button" className={styles.iconButton} onClick={onToggle} aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`} disabled={loading}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
