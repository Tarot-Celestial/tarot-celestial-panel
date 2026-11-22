"use client";

import { useEffect, useState } from "react";
import { officeFile, officeInstagramPreview } from "./office-client";
import styles from "./OfficeWork.module.css";

export function previewableMedia(type: string | null) {
  return !!type && ["image/png", "image/jpeg", "image/webp", "video/mp4"].includes(type);
}

export default function OfficeMedia({ versionId, type, alt, instagramSha, onReady }: {
  versionId: string; type: string; alt: string; instagramSha?: string; onReady?: (loaded: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setProblem("");
    const media = instagramSha ? officeInstagramPreview(versionId, instagramSha, controller.signal) : officeFile(versionId, controller.signal);
    media.then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(e => { if (!controller.signal.aborted) setProblem(e instanceof Error ? e.message : "No se pudo abrir el archivo."); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [versionId, instagramSha]);
  if (problem) return <p role="alert" className={styles.error}>{problem}</p>;
  if (!url) return <p role="status">Cargando archivo…</p>;
  const failed = () => { onReady?.(false); setProblem("Este navegador no ha podido mostrar el archivo."); };
  return type === "video/mp4"
    ? <video className={styles.preview} src={url} controls playsInline preload="auto" aria-label={alt} onLoadedData={() => onReady?.(true)} onError={failed} />
    : <img className={styles.preview} src={url} alt={alt} onLoad={() => onReady?.(true)} onError={failed} />;
}
