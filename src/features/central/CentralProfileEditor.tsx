"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, Camera, Clock3, Save, Star, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { centralTeamLabel, centralThemeStyle, formatCentralSchedule, type CentralThemeVariant, type CentralWorkSchedule } from "@/lib/central-profile-theme";
import styles from "./CentralProfileEditor.module.css";

export type CentralPublicProfile = {
  name: string;
  presentation: string;
  photoUrl: string | null;
  rating: number;
  reviewCount: number;
  team: string;
  themeVariant: CentralThemeVariant;
  schedule: CentralWorkSchedule[];
  reviews: Array<{ id: string; rating: number; comment: string; verified: boolean; createdAt: string }>;
};

type Props = {
  open: boolean;
  profile: CentralPublicProfile;
  onClose: () => void;
  onSaved: (profile: CentralPublicProfile) => void;
};

const sb = supabaseBrowser();

async function optimizePhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen válida.");
  if (file.size > 12 * 1024 * 1024) throw new Error("La imagen original no puede superar 12 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .84));
  if (!blob) throw new Error("No se pudo preparar la fotografía.");
  return new File([blob], "perfil.webp", { type: "image/webp" });
}

export default function CentralProfileEditor({ open, profile, onClose, onSaved }: Props) {
  const [name, setName] = useState(profile.name);
  const [presentation, setPresentation] = useState(profile.presentation);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(profile.photoUrl);
  const [themeVariant, setThemeVariant] = useState<CentralThemeVariant>(profile.themeVariant || "balanced");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile.name);
    setPresentation(profile.presentation);
    setPhoto(null);
    setPreview(profile.photoUrl);
    setThemeVariant(profile.themeVariant || "balanced");
    setMessage("");
  }, [open, profile]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", closeOnEscape); };
  }, [open, onClose]);

  async function choosePhoto(file?: File) {
    if (!file) return;
    try { setMessage("Optimizando fotografía…"); setPhoto(await optimizePhoto(file)); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar la fotografía."); }
  }

  async function save() {
    if (name.trim().length < 2) {
      setMessage("Escribe un nombre de al menos 2 caracteres.");
      return;
    }
    setSaving(true);
    setMessage("");
    const token = (await sb.auth.getSession()).data.session?.access_token || "";
    const form = new FormData();
    form.set("name", name.trim());
    form.set("presentation", presentation.trim());
    form.set("themeVariant", themeVariant);
    if (photo) form.set("photo", photo);
    const response = await fetch("/api/central/public-profile", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const result = await response.json();
    setSaving(false);
    if (!result.ok) {
      setMessage(result.error || "No se pudo guardar el perfil.");
      return;
    }
    onSaved(result.profile);
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="central-profile-title">
        <button type="button" className={styles.close} onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
        <div className={styles.kicker}>TU PERFIL DE PRESENTACIÓN</div>
        <h2 id="central-profile-title">Así te verán las clientas</h2>
        <p className={styles.help}>Tu fotografía, nombre y presentación aparecerán en la pestaña Reseñas del Panel Cliente.</p>

        <div className={styles.rating}>
          <span>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={18} fill={value <= Math.round(profile.rating) ? "currentColor" : "none"} />)}</span>
          <strong>{profile.reviewCount ? `${profile.rating.toFixed(1)} de 5 · ${profile.reviewCount} reseña${profile.reviewCount === 1 ? "" : "s"}` : "Sin reseñas todavía"}</strong>
        </div>

        <section className={styles.scheduleBlock} aria-label="Tu horario público">
          <div className={styles.blockTitle}><Clock3 size={17} /><div><strong>Tu horario público</strong><small>Las clientas verán estos turnos en horario de Madrid.</small></div></div>
          <div className={styles.scheduleList}>{formatCentralSchedule(profile.schedule).length ? formatCentralSchedule(profile.schedule).map((line) => <span key={line}>{line}</span>) : <span>Sin horario publicado</span>}</div>
        </section>

        <section className={styles.ownReviews} aria-label="Tus reseñas">
          <div className={styles.blockTitle}><Star size={17} /><div><strong>Tus reseñas</strong><small>{profile.reviewCount ? `${profile.reviewCount} valoración${profile.reviewCount === 1 ? "" : "es"} recibida${profile.reviewCount === 1 ? "" : "s"}` : "Todavía no has recibido valoraciones"}</small></div></div>
          {profile.reviews.length ? <div className={styles.reviewScroller}>{profile.reviews.map((review) => <article key={review.id}><div><span>{"★".repeat(review.rating)}</span>{review.verified ? <em><BadgeCheck size={12} /> Verificada</em> : null}</div><p>{review.comment || "Sin comentario escrito."}</p><time>{new Date(review.createdAt).toLocaleDateString("es-ES")}</time></article>)}</div> : null}
        </section>

        <div className={styles.previewCard} style={centralThemeStyle(profile.team, themeVariant)}>
          <span>{centralTeamLabel(profile.team)}</span><strong>{name || "Tu nombre público"}</strong><small>{presentation || "Tu presentación aparecerá aquí."}</small>
        </div>

        <div className={styles.photoRow}>
          <div className={styles.photo}>
            {preview ? <img src={preview} alt="Vista previa de tu perfil" /> : <span>{name.trim().charAt(0).toUpperCase() || "C"}</span>}
          </div>
          <label className={styles.photoButton}>
            <Camera size={17} /> Elegir fotografía
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event.target.files?.[0])} />
          </label>
          <small>JPG, PNG o WebP · máximo 4 MB</small>
        </div>

        <label className={styles.field}>
          <span>Nombre público</span>
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Equipo</span>
          <input value={centralTeamLabel(profile.team)} disabled aria-describedby="team-help" />
          <small id="team-help">Lo asigna administración y define la identidad visual del perfil.</small>
        </label>
        <label className={styles.field}>
          <span>Intensidad visual</span>
          <select value={themeVariant} onChange={(event) => setThemeVariant(event.target.value as CentralThemeVariant)}>
            <option value="soft">Suave</option><option value="balanced">Equilibrada</option><option value="vivid">Viva</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Presentación</span>
          <textarea value={presentation} maxLength={700} onChange={(event) => setPresentation(event.target.value)} placeholder="Cuéntales cómo acompañas a cada clienta…" />
          <small>{presentation.length} / 700</small>
        </label>

        {message ? <div className={styles.message}>{message}</div> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>Cancelar</button>
          <button type="button" className={styles.save} disabled={saving} onClick={save}><Save size={17} /> {saving ? "Guardando…" : "Guardar perfil"}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
