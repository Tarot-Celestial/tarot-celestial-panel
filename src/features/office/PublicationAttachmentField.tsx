"use client";

import { useId } from "react";
import { fileData } from "./office-attachment-file";

type Format = "photo" | "reel";
type Props = {
  format: Format;
  file: File | null;
  alt: string;
  onChange: (file: File | null) => void;
  onAlt: (alt: string) => void;
};

export async function readPublicationAttachment(file: File, format: Format, description: string) {
  const attachment = await fileData(file);
  const video = attachment.file_type === "video/mp4";
  const image = ["image/jpeg", "image/png", "image/webp"].includes(attachment.file_type);
  if (format === "photo" ? !image : !video) {
    throw new Error("Selecciona un archivo que corresponda al formato del encargo.");
  }
  const alt = format === "photo" ? description.trim().normalize("NFC") : "";
  if (format === "photo" && (!alt || alt.length > 1000)) throw new Error("Describe la foto en un máximo de 1000 caracteres.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  return { ...attachment, file_sha256: hex, file_alt: alt };
}

export function PublicationAttachmentField({ format, file, alt, onChange, onAlt }: Props) {
  const id = useId();
  const photo = format === "photo";
  return <div>
    <label htmlFor={id}>{photo ? "Adjuntar mi foto" : "Adjuntar mi vídeo"} (opcional)</label>
    <input id={id} type="file" accept={photo ? ".jpg,.jpeg,.png,.webp" : ".mp4"} aria-describedby={id + "-help"}
      onChange={event => { onChange(event.currentTarget.files?.[0] || null); onAlt(""); }} />
    <small id={id + "-help"}>{photo ? "JPG, PNG o WebP" : "MP4 de 3 segundos a 15 minutos"} · Hasta 2 MiB. Si dejas el campo vacío, Marketing creará la pieza.</small>
    {photo && file && <label>Descripción de la foto para lectores de pantalla
      <textarea value={alt} required maxLength={1000} rows={2} onChange={event => onAlt(event.target.value)} />
    </label>}
  </div>;
}
