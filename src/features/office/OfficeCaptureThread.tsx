"use client";

import { useEffect, useState } from "react";
import type { InstagramMessagesResult } from "@/lib/instagram-inbox";
import { officeRequest } from "./office-client";
import s from "./OfficeMonthlyReport.module.css";

export function OfficeCaptureThread({ channel, id }: { channel: "instagram" | "facebook"; id: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<InstagramMessagesResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setError(""); setHistory(null);
    officeRequest<InstagramMessagesResult>("/api/central/" + channel + "?action=messages&threadId=" + encodeURIComponent(id), {signal: abort.signal})
      .then(result => { if (!abort.signal.aborted) setHistory(result); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo leer la conversación."); });
    return () => abort.abort();
  }, [open, channel, id]);
  return <details className={s.captureThread} onToggle={e => setOpen(e.currentTarget.open)}><summary>Ver conversación</summary>
    {open && (error ? <p role="alert">{error}</p> : history ? <>
      {history.messages.length ? <ol>{history.messages.map(message => <li key={message.id}><strong>{message.fromMe ? "Tarot Celestial" : "Contacto"}</strong> {/^TC-[0-9A-F]{12}$/i.test(message.text?.trim()) ? "Código de vinculación" : message.text || "Adjunto"}</li>)}</ol> : <p>El canal no devolvió mensajes.</p>}
      {history.replyHint && <p>{history.replyHint}</p>}
    </> : <p role="status">Consultando el historial…</p>)}
  </details>;
}
