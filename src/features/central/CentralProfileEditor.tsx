"use client";

import { useEffect, useState } from "react";
import { Camera, Save, Star, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./CentralProfileEditor.module.css";

export type CentralPublicProfile = {
  name: string;
  presentation: string;
  photoUrl: string | null;
  rating: number;
  reviewCount: number;
};

type Props = {
  open: boolean;
  profile: CentralPublicProfile;
  onClose: () => void;
  onSaved: (profile: CentralPublicProfile) => void;
};

const sb = supabaseBrowser();

export default function CentralProfileEditor({ open, profile, onClose, onSaved }: Props) {
  const [name, setName] = useState(profile.name);
  const [presentation, setPresentation] = useState(profile.presentation);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(profile.photoUrl);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile.name);
    setPresentation(profile.presentation);
    setPhoto(null);
    setPreview(profile.photoUrl);
    setMessage("");
  }, [open, profile]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

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

  if (!open) return null;

  return (
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

        <div className={styles.photoRow}>
          <div className={styles.photo}>
            {preview ? <img src={preview} alt="Vista previa de tu perfil" /> : <span>{name.trim().charAt(0).toUpperCase() || "C"}</span>}
          </div>
          <label className={styles.photoButton}>
            <Camera size={17} /> Elegir fotografía
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] || null)} />
          </label>
          <small>JPG, PNG o WebP · máximo 4 MB</small>
        </div>

        <label className={styles.field}>
          <span>Nombre público</span>
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
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
    </div>
  );
}
