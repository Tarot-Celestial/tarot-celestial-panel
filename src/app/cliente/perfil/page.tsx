"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, BellRing, CalendarDays, Camera, Check, ChevronRight, CircleUserRound,
  Coins, KeyRound, Mail, Phone, RotateCcw, ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./Profile.module.css";

const sb = supabaseClienteBrowser();

type Cliente = {
  id: string; nombre: string; apellido: string; email: string; pais: string;
  fecha_nacimiento: string; telefono: string; telefono_normalizado: string;
  onboarding_completado: boolean; created_at: string | null; updated_at: string | null;
  avatar_url: string | null; rango_actual: string; puntos: number; minutos_totales: number;
  giros_totales: number; tiradas_oraculo: number;
};
type Verification = { phone: boolean; email: boolean; profile: boolean; password_access: boolean };
type FormState = { nombre: string; apellido: string; email: string; pais: string; fecha_nacimiento: string };

const emptyForm: FormState = { nombre: "", apellido: "", email: "", pais: "", fecha_nacimiento: "" };

function initials(nombre: string, apellido: string) {
  return `${nombre?.[0] || ""}${apellido?.[0] || ""}`.trim().toUpperCase() || "TC";
}

function rankLabel(value: string) {
  const key = String(value || "").toLowerCase();
  return key === "oro" ? "Oro" : key === "plata" ? "Plata" : key === "bronce" ? "Bronce" : "Sin rango";
}

function memberSince(value: string | null) {
  if (!value) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(value));
}

function formatPhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "Completar";
  if (digits.startsWith("34") && digits.length === 11) return `🇪🇸 +34 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  const visible = digits.replace(/(.{3})/g, "$1 ").trim();
  return `${String(value || "").trim().startsWith("+") ? "+" : "+"}${visible}`;
}

function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

async function compressAvatar(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Usa una imagen JPG, PNG o WebP.");
  if (file.size > 8_000_000) throw new Error("La fotografía original debe ocupar menos de 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = document.createElement("img");
    image.src = url;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    canvas.getContext("2d")?.drawImage(image, sx, sy, side, side, 0, 0, 512, 512);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob) throw new Error("No hemos podido preparar la fotografía.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ClientePerfilPage() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [verification, setVerification] = useState<Verification>({ phone: false, email: false, profile: false, password_access: false });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [baseline, setBaseline] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneStep, setPhoneStep] = useState<"idle" | "code">("idle");
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const token = useCallback(async () => (await sb.auth.getSession()).data.session?.access_token || "", []);
  const loadProfile = useCallback(async () => {
    setLoading(true);
    const accessToken = await token();
    if (!accessToken) { window.location.href = "/cliente/login"; return; }
    const response = await fetch("/api/cliente/perfil", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!payload?.ok) {
      setMessage({ tone: "error", text: payload?.error || "No hemos podido cargar tu perfil." });
      setLoading(false);
      return;
    }
    const next = payload.cliente as Cliente;
    const nextForm = { nombre: next.nombre || "", apellido: next.apellido || "", email: next.email || "", pais: next.pais || "", fecha_nacimiento: next.fecha_nacimiento?.slice(0, 10) || "" };
    setCliente(next);
    setVerification(payload.verification || {});
    setForm(nextForm);
    setBaseline(nextForm);
    setLoading(false);
  }, [token]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);
  const fullName = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") || "Cliente Tarot Celestial";
  const completeness = useMemo(() => {
    if (!cliente) return 0;
    const values = [form.nombre, form.apellido, form.email, form.pais, form.fecha_nacimiento, cliente.telefono];
    return Math.round((values.filter((value) => String(value || "").trim()).length / values.length) * 100);
  }, [cliente, form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function saveProfile() {
    if (!dirty || saving) return;
    setSaving(true); setMessage(null);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
      const response = await fetch("/api/cliente/perfil", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => null);
      if (!payload?.ok) throw new Error(payload?.error || "No hemos podido guardar los cambios.");
      setMessage({ tone: "success", text: "Cambios guardados correctamente." });
      await loadProfile();
    } catch (error: any) {
      setMessage({ tone: "error", text: error?.message || "No hemos podido guardar los cambios." });
    } finally { setSaving(false); }
  }

  async function onAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarBusy(true); setMessage(null);
    try {
      const blob = await compressAvatar(file);
      const accessToken = await token();
      const body = new FormData();
      body.append("avatar", new File([blob], "avatar.webp", { type: "image/webp" }));
      const response = await fetch("/api/cliente/perfil/avatar", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body });
      const payload = await response.json().catch(() => null);
      if (!payload?.ok) throw new Error(payload?.error || "No hemos podido guardar la fotografía.");
      setCliente((current) => current ? { ...current, avatar_url: payload.avatar_url } : current);
      setMessage({ tone: "success", text: "Fotografía actualizada." });
    } catch (error: any) { setMessage({ tone: "error", text: error?.message || "No hemos podido guardar la fotografía." }); }
    finally { setAvatarBusy(false); }
  }

  async function deleteAvatar() {
    if (!cliente?.avatar_url || avatarBusy) return;
    setAvatarBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/cliente/perfil/avatar", { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json().catch(() => null);
      if (!payload?.ok) throw new Error(payload?.error || "No hemos podido eliminar la fotografía.");
      setCliente((current) => current ? { ...current, avatar_url: null } : current);
      setMessage({ tone: "success", text: "Fotografía eliminada." });
    } catch (error: any) { setMessage({ tone: "error", text: error?.message || "No hemos podido eliminar la fotografía." }); }
    finally { setAvatarBusy(false); }
  }

  async function sendPhoneCode() {
    const phone = normalizePhone(newPhone);
    if (!phone) return setMessage({ tone: "error", text: "Introduce el nuevo teléfono con prefijo internacional." });
    setPhoneBusy(true); setMessage(null);
    try {
      const { error } = await sb.auth.updateUser({ phone });
      if (error) throw error;
      setPhoneStep("code");
      setMessage({ tone: "success", text: "Código enviado al nuevo teléfono." });
    } catch { setMessage({ tone: "error", text: "No hemos podido enviar el código. Comprueba el número e inténtalo de nuevo." }); }
    finally { setPhoneBusy(false); }
  }

  async function confirmPhone() {
    const phone = normalizePhone(newPhone);
    if (!phone || !phoneCode.trim()) return setMessage({ tone: "error", text: "Introduce el código recibido." });
    setPhoneBusy(true); setMessage(null);
    try {
      const { error } = await sb.auth.verifyOtp({ phone, token: phoneCode.trim(), type: "phone_change" });
      if (error) throw error;
      const response = await fetch("/api/cliente/phone-sync", {
        method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: phone, telefono_anterior: cliente?.telefono || cliente?.telefono_normalizado }),
      });
      const payload = await response.json().catch(() => null);
      if (!payload?.ok) throw new Error();
      setPhoneOpen(false); setPhoneStep("idle"); setNewPhone(""); setPhoneCode("");
      setMessage({ tone: "success", text: "Teléfono verificado y actualizado." });
      await loadProfile();
    } catch { setMessage({ tone: "error", text: "El código no es válido o ha caducado." }); }
    finally { setPhoneBusy(false); }
  }

  const summary = cliente ? [
    { label: "Rango", value: rankLabel(cliente.rango_actual), meta: "Estado actual de tu cuenta", tone: "rank" as const },
    { label: "Coins", value: String(cliente.puntos), meta: "Saldo disponible", href: "/cliente/dashboard", tone: "points" as const },
    { label: "Minutos", value: String(cliente.minutos_totales), meta: "Listos para consultar", href: "/cliente/dashboard", tone: "minutes" as const },
  ] : [];

  return (
    <ClienteLayout title="Mi cuenta" eyebrow="Perfil Tarot Celestial" subtitle="Gestiona tus datos, acceso y preferencias con total claridad." summaryItems={summary}>
      <main className={styles.shell}>
        {loading ? <ProfileSkeleton /> : cliente ? <>
          <section className={styles.profileHero}>
            <div className={styles.avatarWrap}>
              <div className={styles.avatar}>
                {cliente.avatar_url ? <Image src={cliente.avatar_url} alt={`Foto de ${fullName}`} fill sizes="112px" unoptimized /> : <span>{initials(cliente.nombre, cliente.apellido)}</span>}
              </div>
              <button className={styles.cameraButton} onClick={() => fileRef.current?.click()} disabled={avatarBusy} aria-label="Cambiar fotografía"><Camera size={17}/></button>
              <input ref={fileRef} className={styles.hiddenFile} type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={onAvatar}/>
            </div>
            <div className={styles.heroIdentity}>
              <span className={styles.eyebrow}>MI PERFIL</span>
              <h1>{fullName}</h1>
              <div className={styles.identityMeta}><span>{rankLabel(cliente.rango_actual)}</span><i/> <span>Miembro desde {memberSince(cliente.created_at)}</span></div>
              <div className={styles.contactLine}><span><Phone size={14}/>{formatPhone(cliente.telefono)}</span><span><Mail size={14}/>{cliente.email || "Añadir email"}</span></div>
            </div>
            <div className={styles.completion}>
              <div><strong>{completeness}%</strong><span>perfil completo</span></div>
              <div className={styles.completionBar}><i style={{ width: `${completeness}%` }}/></div>
              <button onClick={() => fileRef.current?.click()} disabled={avatarBusy}>{avatarBusy ? "Preparando…" : cliente.avatar_url ? "Cambiar foto" : "Añadir foto"}</button>
              {cliente.avatar_url ? <button className={styles.deletePhoto} onClick={deleteAvatar} disabled={avatarBusy}><Trash2 size={14}/> Eliminar</button> : null}
            </div>
          </section>

          {message ? <div className={styles.message} data-tone={message.tone}>{message.tone === "success" ? <Check size={18}/> : <X size={18}/>}<span>{message.text}</span></div> : null}

          <div className={styles.mainGrid}>
            <section className={styles.card}>
              <header className={styles.cardHeader}><div className={styles.icon}><CircleUserRound/></div><div><span>DATOS PERSONALES</span><h2>Tu información</h2><p>Estos datos se guardan en tu ficha real de cliente.</p></div></header>
              <div className={styles.formGrid}>
                <label><span>Nombre</span><input value={form.nombre} maxLength={80} autoComplete="given-name" onChange={(e) => update("nombre", e.target.value)}/></label>
                <label><span>Apellidos</span><input value={form.apellido} maxLength={100} autoComplete="family-name" onChange={(e) => update("apellido", e.target.value)}/></label>
                <label className={styles.wide}><span>Email de contacto</span><input value={form.email} type="email" autoComplete="email" onChange={(e) => update("email", e.target.value)}/><small>No cambia tu método de acceso.</small></label>
                <label><span>Fecha de nacimiento</span><input value={form.fecha_nacimiento} type="date" max={new Date().toISOString().slice(0, 10)} onChange={(e) => update("fecha_nacimiento", e.target.value)}/><small>Para ventajas de cumpleaños.</small></label>
                <label><span>País</span><input value={form.pais} maxLength={80} autoComplete="country-name" placeholder="Completar" onChange={(e) => update("pais", e.target.value)}/></label>
              </div>
              <div className={styles.saveBar}><span>{dirty ? "Tienes cambios sin guardar" : "Todos los cambios están guardados"}</span><button onClick={saveProfile} disabled={!dirty || saving}>{saving ? <RotateCcw className={styles.spin} size={17}/> : <Check size={17}/>} {saving ? "Guardando…" : "Guardar cambios"}</button></div>
            </section>

            <aside className={styles.sideColumn}>
              <section className={styles.card}>
                <header className={styles.cardHeader}><div className={styles.icon}><ShieldCheck/></div><div><span>SEGURIDAD Y ACCESO</span><h2>Tu cuenta protegida</h2></div></header>
                <div className={styles.statusList}>
                  <StatusRow icon={<Phone/>} label="Teléfono de acceso" value={formatPhone(cliente.telefono)} verified={verification.phone} pending="Registrado · sin confirmación Auth"/>
                  <StatusRow icon={<Mail/>} label="Email de contacto" value={cliente.email || "Completar"} verified={verification.email} pending="Correo de contacto · sin verificar"/>
                  <StatusRow icon={<BadgeCheck/>} label="Datos del perfil" value={verification.profile ? "Completados" : "Pendientes"} verified={verification.profile}/>
                </div>
                <div className={styles.securityActions}>
                  <button onClick={() => setPhoneOpen(true)}><Phone size={16}/> Cambiar teléfono <ChevronRight size={16}/></button>
                  <Link href="/cliente/recuperar"><KeyRound size={16}/> Cambiar contraseña <ChevronRight size={16}/></Link>
                </div>
              </section>

              <section className={styles.card}>
                <header className={styles.cardHeader}><div className={styles.icon}><Sparkles/></div><div><span>TAROT CELESTIAL</span><h2>Accesos rápidos</h2></div></header>
                <div className={styles.quickGrid}>
                  <Link href="/cliente/dashboard"><Coins/><strong>{cliente.puntos}</strong><span>Coins</span></Link>
                  <Link href="/cliente/dashboard"><Phone/><strong>{cliente.minutos_totales}</strong><span>Minutos</span></Link>
                  <Link href="/cliente/ruleta"><Sparkles/><strong>{cliente.giros_totales}</strong><span>Giros</span></Link>
                  <Link href="/cliente/oraculo"><CalendarDays/><strong>{cliente.tiradas_oraculo}</strong><span>Tiradas</span></Link>
                </div>
              </section>
            </aside>
          </div>

          <section className={styles.bottomGrid}>
            <div className={styles.card}><header className={styles.cardHeader}><div className={styles.icon}><BellRing/></div><div><span>PREFERENCIAS</span><h2>Comunicaciones</h2><p>Gestiona tus avisos desde el centro de notificaciones.</p></div></header><Link className={styles.fullAction} href="/cliente/notificaciones">Abrir notificaciones <ChevronRight/></Link></div>
            <div className={styles.card}><header className={styles.cardHeader}><div className={styles.icon}><ShieldCheck/></div><div><span>PRIVACIDAD</span><h2>Documentos y condiciones</h2></div></header><nav className={styles.legalLinks}><Link href="/privacidad">Política de privacidad</Link><Link href="/terminos">Términos</Link><Link href="/aviso-legal">Aviso legal</Link><Link href="/reembolsos">Reembolsos</Link></nav></div>
          </section>
        </> : null}
      </main>

      {phoneOpen ? <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && setPhoneOpen(false)}>
        <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="phone-title">
          <button className={styles.close} onClick={() => setPhoneOpen(false)} aria-label="Cerrar"><X/></button>
          <div className={styles.modalIcon}><Phone/></div><span>CAMBIO SEGURO</span><h2 id="phone-title">Cambiar teléfono</h2><p>Enviaremos un código SMS al nuevo número antes de actualizar tu acceso.</p>
          <label><span>Nuevo teléfono con prefijo</span><input autoFocus value={newPhone} placeholder="+34 603 000 000" inputMode="tel" onChange={(e) => setNewPhone(e.target.value)}/></label>
          {phoneStep === "code" ? <label><span>Código recibido</span><input value={phoneCode} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" onChange={(e) => setPhoneCode(e.target.value)}/></label> : null}
          <button className={styles.primary} onClick={phoneStep === "idle" ? sendPhoneCode : confirmPhone} disabled={phoneBusy}>{phoneBusy ? "Procesando…" : phoneStep === "idle" ? "Enviar código" : "Verificar y cambiar"}</button>
        </section>
      </div> : null}
    </ClienteLayout>
  );
}

function StatusRow({ icon, label, value, verified, pending }: { icon: ReactNode; label: string; value: string; verified: boolean; pending?: string }) {
  return <div className={styles.statusRow}><span className={styles.statusIcon}>{icon}</span><div><small>{label}</small><strong>{value}</strong><em data-verified={verified}>{verified ? "Verificado" : pending || "Pendiente"}</em></div></div>;
}

function ProfileSkeleton() {
  return <div className={styles.skeleton} aria-label="Cargando perfil"><div/><div className={styles.skeletonGrid}><i/><i/></div></div>;
}
