"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { CHAT_MEDIA_MAX_BYTES, createChatMediaDraft, type StaffChatMediaDraft } from "@/lib/staff-chat-media";
import styles from "./StaffDirectChatPanel.module.css";

type Props = { text: string; onText: (text: string) => void; draft: StaffChatMediaDraft | null; onDraft: (draft: StaffChatMediaDraft | null) => void; onSend: () => void; disabled: boolean; sending: boolean };
export default function StaffChatComposer({ text, onText, draft, onDraft, onSend, disabled, sending }: Props) {
  const imageInput = useRef<HTMLInputElement>(null), audioInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const generation = useRef(0), discard = useRef(false), chunks = useRef<Blob[]>([]), byteSize = useRef(0);
  const [recording, setRecording] = useState(false), [requesting, setRequesting] = useState(false), [seconds, setSeconds] = useState(0), [error, setError] = useState("");
  const latest = useRef({ disabled, onDraft }); latest.current = { disabled, onDraft };
  function stopTracks() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
  function cancelRecording() {
    generation.current++; discard.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null; stopTracks(); setRecording(false); setRequesting(false); setSeconds(0);
  }
  useEffect(() => () => { generation.current++; discard.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  useEffect(() => { if (disabled) cancelRecording(); }, [disabled]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => { if (recording && seconds >= 300) recorder.current?.stop(); }, [seconds, recording]);
  function pick(file: File | undefined, kind: "image" | "audio") {
    if (!file || disabled) return;
    try { onDraft(createChatMediaDraft(file, kind)); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo abrir el archivo."); }
  }
  async function beginRecording() {
    if (disabled || requesting || recording) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setError("Este navegador no permite grabar. Puedes usar Subir audio."); return; }
    const request = ++generation.current;
    setRequesting(true); setError(""); discard.current = false;
    try {
      const obtained = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== generation.current || latest.current.disabled) { obtained.getTracks().forEach(track => track.stop()); return; }
      stream.current = obtained;
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(obtained, mimeType ? { mimeType } : undefined);
      recorder.current = next; chunks.current = []; byteSize.current = 0;
      next.ondataavailable = event => {
        if (!event.data.size || discard.current || request !== generation.current) return;
        byteSize.current += event.data.size;
        if (byteSize.current > CHAT_MEDIA_MAX_BYTES.audio) { discard.current = true; setError("La grabación supera 15 MB. Graba una nota más corta."); next.stop(); return; }
        chunks.current.push(event.data);
      };
      next.onstop = () => {
        obtained.getTracks().forEach(track => track.stop());
        if (stream.current === obtained) stream.current = null;
        if (recorder.current === next) recorder.current = null;
        if (request !== generation.current) return;
        setRecording(false); setRequesting(false);
        if (discard.current || latest.current.disabled) return;
        try {
          const type = next.mimeType || chunks.current[0]?.type || "audio/webm";
          const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
          const file = new File(chunks.current, `nota-de-voz.${extension}`, { type });
          latest.current.onDraft(createChatMediaDraft(file, "audio"));
        } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo preparar la nota de voz."); }
      };
      next.onerror = () => {
        obtained.getTracks().forEach(track => track.stop());
        if (stream.current === obtained) stream.current = null;
        if (recorder.current === next) recorder.current = null;
        if (request !== generation.current) return;
        discard.current = true; setRecording(false); setRequesting(false); setError("No se pudo completar la grabación. Puedes subir un archivo de audio.");
      };
      next.start(1000); setSeconds(0); setRecording(true);
    } catch { if (request === generation.current) { stopTracks(); setError("No se pudo acceder al micrófono. Revisa el permiso o usa Subir audio."); } }
    finally { if (request === generation.current) setRequesting(false); }
  }
  const busyRecording = requesting || recording;
  return <form className={styles.composer} onSubmit={event => { event.preventDefault(); if (!busyRecording) onSend(); }}>
    {error ? <p className={styles.mediaError} role="alert">{error}</p> : null}
    {draft ? <div className={styles.draftMedia}>
      {draft.kind === "image" ? <img src={draft.previewUrl} alt={`Vista previa: ${draft.file.name}`}/> : <audio controls preload="metadata" src={draft.previewUrl} aria-label="Vista previa de la nota de voz"/>}
      <span>{draft.file.name}</span><button type="button" className={styles.mediaRemove} aria-label="Quitar adjunto" onClick={() => onDraft(null)}><X size={16}/></button>
    </div> : null}
    {busyRecording ? <div className={styles.recording} role="status"><span>{requesting ? "Solicitando micrófono…" : `Grabando ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>{recording ? <button type="button" onClick={() => recorder.current?.stop()} aria-label="Detener y revisar nota de voz"><Square size={15}/> Detener y revisar</button> : null}<button type="button" onClick={cancelRecording}>Cancelar grabación</button></div> : null}
    <div className={styles.composerLine}><textarea aria-label="Escribe un mensaje" value={text} maxLength={2000} disabled={disabled} onChange={event => onText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !busyRecording) { event.preventDefault(); onSend(); } }} placeholder="Escribe un mensaje…"/><button type="submit" disabled={(!text.trim() && !draft) || sending || disabled || busyRecording} aria-label="Enviar mensaje" title="Enviar mensaje"><Send size={18}/></button></div>
    <div className={styles.composerTools}>
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Archivo de imagen" onChange={event => { pick(event.target.files?.[0], "image"); event.target.value = ""; }}/>
      <input ref={audioInput} type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg" hidden aria-label="Archivo de audio" onChange={event => { pick(event.target.files?.[0], "audio"); event.target.value = ""; }}/>
      <button type="button" disabled={disabled || busyRecording} aria-label="Adjuntar imagen" title="Adjuntar imagen · hasta 10 MB" onClick={() => imageInput.current?.click()}><ImagePlus size={17}/></button>
      <button type="button" disabled={disabled || busyRecording} aria-label="Subir audio" title="Subir audio · hasta 15 MB" onClick={() => audioInput.current?.click()}><Paperclip size={17}/></button>
      <button type="button" disabled={disabled || busyRecording} aria-label="Grabar nota de voz" title="Grabar nota de voz" onClick={() => void beginRecording()}><Mic size={17}/></button>
      <span>{text.length}/2000</span>
    </div>
  </form>;
}
