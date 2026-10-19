"use client";
import { clientDestination, clientRecoveryHref } from "@/lib/client-entry";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Phone,
  ShieldCheck,
  Sparkles,
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

type LoginMode = "password" | "setup";

function getRedirectPath() { return clientDestination(window.location.search); }

export default function ClienteLoginPage() {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState("");
  const [password, setPassword] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [mode, setMode] = useState<LoginMode>("password");
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phone = useMemo(() => buildInternationalPhone(selectedCountry, phoneInput), [selectedCountry, phoneInput]);
  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);
  useEffect(() => {
    setCountryCode(guessDefaultCountry().code);
    if (new URLSearchParams(window.location.search).get("source") === "instagram") setMode("setup");
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace(getRedirectPath());
    });
  }, [router]);

  function updateMode(nextMode: LoginMode) {
    if (loading || nextMode === mode) return;
    setMode(nextMode);
    setMsg("");
  }

  function updatePhone(value: string) {
    setPhoneInput(normalizeLocalPhone(value).slice(0, localPhoneMaxLength(selectedCountry)));
    if (phoneError) setPhoneError("");
    if (msg) setMsg("");
  }

  function validatePhone() {
    const error = validateLocalPhone(selectedCountry, phoneInput);
    setPhoneError(error);
    return !error;
  }

  async function loginWithPassword() {
    if (loading) return;
    if (!validatePhone()) return;
    if (!password.trim()) {
      setMsg("Escribe tu contraseña para continuar.");
      return;
    }

    try {
      setLoading(true);
      setMsg("");
      const res = await fetch("/api/cliente/auth/password/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.access_token || !json?.refresh_token) throw new Error(json?.error || "INVALID_LOGIN_CREDENTIALS");
      const { error } = await sb.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token });
      if (error) throw error;
      router.replace(getRedirectPath());
    } catch (error) {
      setMsg(friendlyAuthError(error, "No hemos podido iniciar sesión. Revisa tus datos."));
    } finally {
      setLoading(false);
    }
  }

  async function createFirstAccessPassword() {
    if (loading || !validatePhone()) return;
    if (name.trim().length < 2 || !email.includes("@")) { setMsg("Escribe tu nombre y un correo válido."); return; }
    if (createPassword.length < 8) { setMsg("La contraseña debe tener al menos 8 caracteres."); return; }
    if (createPassword !== createPasswordConfirm) { setMsg("Las contraseñas no coinciden."); return; }
    try {
      setLoading(true); setMsg("");
      const endpoint = challengeId ? "complete" : "start";
      const payload = challengeId
        ? { challenge_id: challengeId, code: verificationCode, password: createPassword, password_confirm: createPasswordConfirm }
        : { name, surname, email, phone: phoneDigits, country: countryCode, source: new URLSearchParams(window.location.search).get("source") };
      const res = await fetch(`/api/cliente/auth/register/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "REGISTRATION_UNAVAILABLE");
      if (!challengeId) { setChallengeId(json.challenge_id); setMsg("Te hemos enviado un código a tu correo. Escríbelo para completar el registro."); return; }
      const { error } = await sb.auth.signInWithPassword({ email: String(json.alias_email), password: createPassword });
      if (error) throw error;
      router.replace(getRedirectPath());
    } catch (error) {
      setMsg(friendlyAuthError(error, "No hemos podido completar el registro. Inténtalo de nuevo."));
    } finally { setLoading(false); }
  }

  function submitCurrentMode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "password") void loginWithPassword();
    else void createFirstAccessPassword();
  }

  return (
    <ClientAuthShell
      eyebrow="Acceso privado"
      title="Tarot Celestial"
      subtitle="Tu espacio privado, seguro y exclusivo. Accede en segundos."
      footer="Tu sesión se mantiene protegida mediante Supabase Auth."
    >
      <div className={styles.tabs} role="tablist" aria-label="Selecciona cómo quieres acceder">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          className={`${styles.tab} ${mode === "password" ? styles.tabActive : ""}`}
          onClick={() => updateMode("password")}
          disabled={loading}
        >
          <span className={styles.tabIcon}><LockKeyhole size={16} /></span><span><strong>Ya tengo contraseña</strong><small>Acceso habitual</small></span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "setup"}
          className={`${styles.tab} ${mode === "setup" ? styles.tabActive : ""}`}
          onClick={() => updateMode("setup")}
          disabled={loading}
        >
          <span className={styles.tabIcon}><Sparkles size={16} /></span><span><strong>REGISTRARSE</strong><small>Crear mi cuenta</small></span>
        </button>
      </div>

      <form className={styles.form} onSubmit={submitCurrentMode} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="client-country">País</label>
          <div className={styles.selectShell}>
            <span className={styles.flag} aria-hidden="true">{countryFlag(selectedCountry.code)}</span>
            <select
              id="client-country"
              className={styles.select}
              value={countryCode}
              onChange={(event) => {
                setCountryCode(event.target.value);
                setPhoneInput("");
                setPhoneError("");
                setMsg("");
              }}
              disabled={loading || (mode === "setup" && Boolean(challengeId))}
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
          <label className={styles.label} htmlFor="client-phone">Teléfono</label>
          <div className={`${styles.phoneShell} ${phoneError ? styles.invalid : ""}`}>
            <span className={styles.prefix}>{selectedCountry.dialCode}</span>
            <Phone className={styles.fieldIcon} size={16} aria-hidden="true" />
            <input
              id="client-phone"
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
              aria-describedby={phoneError ? "client-phone-error" : "client-phone-help"}
              disabled={loading || (mode === "setup" && Boolean(challengeId))}
            />
          </div>
          {phoneError ? (
            <span id="client-phone-error" className={styles.errorText}>{phoneError}</span>
          ) : (
            <span id="client-phone-help" className={styles.help}>Usa solo tu número local; el prefijo se añade automáticamente.</span>
          )}
        </div>

        {mode === "password" ? (
          <div key="password-mode" className={styles.modePanel} role="tabpanel">
            <div className={styles.field}>
              <label className={styles.label} htmlFor="client-password">Contraseña</label>
              <div className={styles.inputShell}>
                <LockKeyhole className={styles.fieldIcon} size={16} aria-hidden="true" />
                <input
                  id="client-password"
                  className={styles.input}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); if (msg) setMsg(""); }}
                  disabled={loading}
                />
                <button type="button" className={styles.iconButton} onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} disabled={loading}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className={styles.primaryButton} disabled={loading}>
              {loading ? <LoaderCircle className={styles.spinner} size={18} /> : <ShieldCheck size={18} />}
              {loading ? "Comprobando acceso..." : "Entrar a mi panel"}
              {!loading ? <ArrowRight size={17} /> : null}
            </button>

            <button type="button" className={styles.linkButton} onClick={() => router.push(clientRecoveryHref(window.location.search))} disabled={loading}>
              Recuperar o activar mi acceso
            </button>
          </div>
        ) : (
          <div key="setup-mode" className={styles.modePanel} role="tabpanel">
            <div className={styles.note}>
              <Sparkles size={16} />
              <span>Crea tu cuenta para acceder a tu espacio. Verificaremos tu correo para proteger tu acceso.</span>
            </div>


            <div className={styles.field}>
              <label className={styles.label} htmlFor="register-name">Nombre</label>
              <div className={styles.inputShell}><input id="register-name" className={styles.input} autoComplete="given-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} disabled={loading || Boolean(challengeId)} /></div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="register-surname">Apellidos (opcional)</label>
              <div className={styles.inputShell}><input id="register-surname" className={styles.input} autoComplete="family-name" value={surname} maxLength={100} onChange={event => setSurname(event.target.value)} disabled={loading || Boolean(challengeId)} /></div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="register-email">Correo electrónico</label>
              <div className={styles.inputShell}><input id="register-email" className={styles.input} type="email" autoComplete="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} disabled={loading || Boolean(challengeId)} /></div>
              <span className={styles.help}>Te enviaremos un código para confirmar que este correo es tuyo.</span>
            </div>
            <PasswordField id="client-new-password" label="Crea tu contraseña" value={createPassword} visible={showCreatePassword} setVisible={setShowCreatePassword} onChange={(value) => { setCreatePassword(value); if (msg) setMsg(""); }} loading={loading} placeholder="Mínimo 8 caracteres" />
            <div className={styles.passwordGuide} data-valid={createPassword.length >= 8 ? "true" : "false"}>
              <span><i /> Mínimo 8 caracteres</span>
              <span><i /> Solo tú podrás usarla</span>
            </div>
            <PasswordField id="client-confirm-password" label="Repite la contraseña" value={createPasswordConfirm} visible={showCreateConfirm} setVisible={setShowCreateConfirm} onChange={(value) => { setCreatePasswordConfirm(value); if (msg) setMsg(""); }} loading={loading} placeholder="Vuelve a escribirla" />

            {challengeId ? <div className={styles.field}>
              <label className={styles.label} htmlFor="register-code">Código de tu correo</label>
              <div className={styles.inputShell}><input id="register-code" className={styles.input} inputMode="numeric" autoComplete="one-time-code" value={verificationCode} maxLength={6} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, ""))} disabled={loading} /></div>
              <button type="button" className={styles.linkButton} disabled={loading} onClick={() => { setChallengeId(""); setVerificationCode(""); setMsg(""); }}>Cambiar datos o solicitar otro código</button>
            </div> : null}
            <button type="submit" className={styles.primaryButton} disabled={loading}>
              {loading ? <LoaderCircle className={styles.spinner} size={18} /> : <Sparkles size={18} />}
              {loading ? "Comprobando..." : challengeId ? "Verificar y entrar" : "REGISTRARSE"}
              {!loading ? <ArrowRight size={17} /> : null}
            </button>
            <button type="button" className={styles.linkButton} disabled={loading} onClick={() => router.push(clientRecoveryHref(window.location.search))}>Ya soy cliente: recuperar o activar acceso</button>
          </div>
        )}
      </form>

      {msg ? <div className={styles.message} role="alert" aria-live="polite"><AlertCircle size={17} /><span>{msg}</span></div> : null}
    </ClientAuthShell>
  );
}

function PasswordField({
  id,
  label,
  value,
  visible,
  setVisible,
  onChange,
  loading,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  setVisible: (value: boolean | ((current: boolean) => boolean)) => void;
  onChange: (value: string) => void;
  loading: boolean;
  placeholder: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <div className={styles.inputShell}>
        <LockKeyhole className={styles.fieldIcon} size={16} aria-hidden="true" />
        <input id={id} className={styles.input} type={visible ? "text" : "password"} autoComplete="new-password" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} minLength={6} disabled={loading} />
        <button type="button" className={styles.iconButton} onClick={() => setVisible((current) => !current)} aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`} disabled={loading}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
