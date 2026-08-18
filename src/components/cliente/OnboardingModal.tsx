"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronRight, MoonStar, Sparkles, UserRound } from "lucide-react";
import styles from "./OnboardingModal.module.css";

type Cliente = { nombre?: string | null; apellido?: string | null; email?: string | null; fecha_nacimiento?: string | null };
type Props = {
  open: boolean;
  cliente: Cliente | null;
  saving: boolean;
  onSave: (payload: { nombre: string; apellido: string; email: string; fecha_nacimiento: string; onboarding_completado: boolean }) => Promise<void>;
};

const TOTAL_STEPS = 3;

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeStoredDate(value: string | null | undefined) {
  const clean = String(value || "").trim();
  if (validIsoDate(clean)) return clean;
  const match = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return validIsoDate(iso) ? iso : "";
}

export default function OnboardingModal({ open, cliente, saving, onSave }: Props) {
  const [step, setStep] = useState(0);
  const [nombre, setNombre] = useState(cliente?.nombre || "");
  const [apellido, setApellido] = useState(cliente?.apellido || "");
  const [email, setEmail] = useState(cliente?.email || "");
  const [fechaNacimiento, setFechaNacimiento] = useState(normalizeStoredDate(cliente?.fecha_nacimiento));
  const [editNombre, setEditNombre] = useState(false);
  const [editEmail, setEditEmail] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setNombre(cliente?.nombre || "");
    setApellido(cliente?.apellido || "");
    setEmail(cliente?.email || "");
    setFechaNacimiento(normalizeStoredDate(cliente?.fecha_nacimiento));
    setEditNombre(false);
    setEditEmail(false);
    setMsg("");
    setStep(0);
  }, [cliente, open]);

  const nombreCompleto = useMemo(() => [nombre, apellido].filter(Boolean).join(" ").trim(), [apellido, nombre]);
  if (!open || !cliente) return null;

  function next() {
    setMsg("");
    setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
  }

  async function finish() {
    if (!nombre.trim()) return setMsg("Necesitamos tu nombre para preparar el perfil.");
    if (!fechaNacimiento || !validIsoDate(fechaNacimiento)) return setMsg("Selecciona una fecha de nacimiento válida.");
    if (fechaNacimiento > todayIso()) return setMsg("La fecha de nacimiento no puede estar en el futuro.");
    setMsg("");
    try {
      await onSave({ nombre: nombre.trim(), apellido: apellido.trim(), email: email.trim(), fecha_nacimiento: fechaNacimiento, onboarding_completado: true });
    } catch {
      setMsg("No hemos podido guardar el perfil. Inténtalo de nuevo.");
    }
  }

  return <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <div className={styles.stars} aria-hidden="true" />
    <section className={styles.card}>
      <header className={styles.header}>
        <div className={styles.celestialIcon}><MoonStar aria-hidden="true" /></div>
        <div className={styles.headerCopy}><span><Sparkles size={13} aria-hidden="true" /> Preparando tu perfil</span><h1 id="onboarding-title">Bienvenido a Tarot Celestial</h1><p>Completa estos datos para personalizar tu experiencia.</p></div>
      </header>
      <div className={styles.progress} aria-label={`Paso ${step + 1} de ${TOTAL_STEPS}`}><div><span>Paso {step + 1} de {TOTAL_STEPS}</span><strong>{Math.round(((step + 1) / TOTAL_STEPS) * 100)}%</strong></div><div className={styles.progressTrack}><span style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} /></div></div>
      <div className={styles.content}>
        {step === 0 ? <div className={styles.step}><div className={styles.stepTitle}><UserRound aria-hidden="true" /><div><span>Tu identidad</span><h2>¿Tu nombre es correcto?</h2></div></div>{!editNombre ? <><div className={styles.confirmValue}>{nombreCompleto || "Sin nombre"}</div><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setEditNombre(true)}>Editar</button><button type="button" className={styles.primary} onClick={next}>Sí, continuar <ChevronRight size={18}/></button></div></> : <><label className={styles.field}><span>Nombre</span><input autoFocus value={nombre} onChange={(event) => setNombre(event.target.value)} autoComplete="given-name" /></label><label className={styles.field}><span>Apellido</span><input value={apellido} onChange={(event) => setApellido(event.target.value)} autoComplete="family-name" /></label><button type="button" className={styles.primary} disabled={!nombre.trim()} onClick={next}>Guardar y seguir <ChevronRight size={18}/></button></>}</div> : null}
        {step === 1 ? <div className={styles.step}><div className={styles.stepTitle}><Sparkles aria-hidden="true" /><div><span>Contacto</span><h2>¿Tu e-mail es correcto?</h2></div></div>{!editEmail ? <><div className={styles.confirmValue}>{email || "Sin e-mail"}</div><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setEditEmail(true)}>Editar</button><button type="button" className={styles.primary} onClick={next}>Sí, continuar <ChevronRight size={18}/></button></div></> : <><label className={styles.field}><span>E-mail</span><input autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="tu@email.com" /></label><button type="button" className={styles.primary} onClick={next}>Guardar y seguir <ChevronRight size={18}/></button></>}</div> : null}
        {step === 2 ? <div className={styles.step}><div className={styles.stepTitle}><CalendarDays aria-hidden="true" /><div><span>Último paso</span><h2>Fecha de nacimiento</h2></div></div><p className={styles.help}>La utilizaremos para personalizar tu perfil y tus experiencias celestiales.</p><label className={styles.field}><span>Selecciona tu fecha</span><input type="date" value={fechaNacimiento} max={todayIso()} onChange={(event) => { setFechaNacimiento(event.target.value); setMsg(""); }} aria-describedby="birthdate-help" /></label><small id="birthdate-help" className={styles.dateHint}>La fecha se mostrará según el idioma de tu dispositivo y se guardará de forma segura.</small><button type="button" className={styles.primary} disabled={saving || !fechaNacimiento} onClick={() => void finish()}>{saving ? <span className={styles.spinner} aria-hidden="true" /> : <Check size={18}/>} {saving ? "Preparando tu perfil…" : "Completar mi perfil"}</button></div> : null}
      </div>
      {msg ? <div className={styles.error} role="alert">{msg}</div> : null}
    </section>
  </div>;
}
