"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { chatRequest } from "@/lib/staff-chat-client";
import styles from "./StaffDirectChatPanel.module.css";

type Attachment = { id: string; kind: "image" | "audio"; mime_type: string; file_name: string; size_bytes: number };
export default function StaffChatAttachment({ attachment, localPreview }: { attachment: Attachment; localPreview?: string }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const host = useRef<HTMLDivElement>(null), player = useRef<HTMLAudioElement>(null);
  const generation = useRef(0), expiresAt = useRef(0), retryCount = useRef(0);
  const playIntent = useRef(false), replacingSource = useRef(false), restorePosition = useRef<number | null>(null);
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (localPreview || pending.current) return;
    const request = generation.current; pending.current = true; setLoading(true); setError("");
    try {
      const response = await chatRequest(`/api/chat/media/read?attachment_id=${encodeURIComponent(attachment.id)}`);
      if (generation.current !== request) return;
      const parsed = new URL(response.url);
      if (parsed.protocol !== "https:") throw new Error("URL no disponible");
      expiresAt.current = Date.now() + Math.max(0, Number(response.expires_in) || 0) * 1000 - 5000;
      if (attachment.kind === "audio" && player.current) {
        restorePosition.current = Number.isFinite(player.current.currentTime) ? player.current.currentTime : 0;
        replacingSource.current = true;
      }
      setUrl(parsed.href);
    } catch { if (generation.current === request) setError("No se pudo abrir el archivo privado. Puedes reintentarlo."); }
    finally { if (generation.current === request) { pending.current = false; setLoading(false); } }
  }, [attachment.id, attachment.kind, localPreview]);
  useEffect(() => {
    generation.current++; pending.current = false; retryCount.current = 0; playIntent.current = false; replacingSource.current = false; restorePosition.current = null;
    setUrl(""); setError(""); expiresAt.current = 0;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { void load(); observer.disconnect(); }
    });
    if (host.current) observer.observe(host.current);
    return () => { generation.current++; pending.current = false; observer.disconnect(); };
  }, [load]);
  const source = localPreview || url;
  function renewAfterError() {
    if (localPreview) { setError("No se pudo abrir la vista previa del archivo."); return; }
    if (retryCount.current++ >= 1) { setError("No se pudo cargar el archivo. Pulsa Reintentar archivo."); return; }
    void load();
  }
  function restoreAudio() {
    const audio = player.current;
    if (!audio) return;
    if (restorePosition.current != null) {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
      try { audio.currentTime = Math.min(restorePosition.current, duration); }
      catch { return; } // Some decoders accept seeking only once canplay fires.
      restorePosition.current = null;
    }
    replacingSource.current = false;
    if (playIntent.current && audio.paused) void audio.play().catch(() => {});
  }
  return <div ref={host} className={styles.messageMedia}>
    {source && !error ? attachment.kind === "image" ? <img src={source} alt={attachment.file_name || "Imagen del equipo"} loading="lazy" onError={renewAfterError}/> : <audio ref={player} controls preload="none" src={source} aria-label={attachment.file_name || "Nota de voz"} onPlay={() => { playIntent.current = true; if (!localPreview && Date.now() >= expiresAt.current) void load(); }} onPause={() => { if (!replacingSource.current) playIntent.current = false; }} onEnded={() => { playIntent.current = false; }} onLoadedMetadata={restoreAudio} onCanPlay={restoreAudio} onError={renewAfterError}/> : null}
    {error ? <span role="status">{error}</span> : !source ? <span>{loading ? "Abriendo archivo…" : attachment.kind === "image" ? "Imagen privada" : "Nota de voz"}</span> : null}
    {error || !source && !loading ? <button type="button" className={styles.retry} onClick={() => { retryCount.current = 0; void load(); }}>Reintentar archivo</button> : null}
  </div>;
}
