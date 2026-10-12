"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import styles from "./ClientRecoveryPanel.module.css";

const DEFAULT_MESSAGE = `💜🔮Hola {nombre} Tarot Celestial tiene un regalo para ti🔮💜

Ha pasado un tiempo desde tu última consulta, y cuando eso ocurre… las energías cambian, aparecen dudas nuevas y mensajes que esperan ser escuchados.🌙💫

💥 PROMO REENCUENTRO – Especial para ti
💥 Promo Reencuentro
🔮 15+15 minutos de regalo por $15
🔮 20+20 minutos de regalo por $20

Te damos la bienvenida con acceso a tarotistas de rango alto, guías de primer nivel reconocidas por su precisión, sensibilidad y profundidad espiritual.💫

📞 Puedes llamarnos cuando gustes:
🇵🇷 +17879450710
🇺🇸 +17865394750

✨ Síguenos en redes para estar al día:
📸 Instagram: @tarotcelestialof
🎥 TikTok: @tarot_celestial_oficial

💜 Tarot Celestial – Siempre a tu lado. 💜`;

export default function RecoveryMessageComposer({ client, followPointer, onFollowPointer }: { client: { id: string; nombre: string } | null; followPointer: boolean; onFollowPointer: (value: boolean) => void }) {
 const [template, setTemplate] = useState(DEFAULT_MESSAGE);
 const [name, setName] = useState("");
 const [feedback, setFeedback] = useState("");
 const [loaded, setLoaded] = useState(false);
 const preview = useRef<HTMLTextAreaElement>(null);
 useEffect(() => {
  const focus = () => preview.current?.focus();
  window.addEventListener("tc-recovery-focus-message", focus);
  return () => window.removeEventListener("tc-recovery-focus-message", focus);
 }, []);
 useEffect(() => {
  try { const saved = localStorage.getItem("tc-recovery-message-v1"); if (saved !== null) setTemplate(saved); } catch { /* Storage may be unavailable. */ }
  setLoaded(true);
 }, []);
 useEffect(() => {
  if (!loaded) return;
  try { localStorage.setItem("tc-recovery-message-v1", template); } catch { /* Editing and copying still work. */ }
 }, [template, loaded]);
 useEffect(() => {
  const next = (client?.nombre || "").trim();
  setName(next); setFeedback("");
  if (next) window.dispatchEvent(new CustomEvent("tc-recovery-message-ready", { detail: { name: next } }));
 }, [client?.id, client?.nombre]);
 const message = template.replace(/\{nombre\}/g, () => name.trim());
 const canCopy = Boolean(message.trim()) && (!template.includes("{nombre}") || Boolean(name.trim()));
 async function copy() {
  const text = message;
  try { await navigator.clipboard.writeText(text); setFeedback(`Mensaje copiado${name.trim() ? " para " + name.trim() : ""}.`); }
  catch { preview.current?.focus(); preview.current?.select(); setFeedback("No se pudo acceder al portapapeles. Copia el texto seleccionado con Ctrl+C o manteniendo pulsado."); }
 }
 return <aside className={styles.messageBox} aria-label="Mensaje de recuperación">
  <h2><Sparkles size={18}/> Mensaje para recuperar</h2>
  <p>Pasa el cursor por una clienta o pulsa «Preparar mensaje». Tu compañero adapta el saludo.</p>
  <label style={{display:"flex",alignItems:"center"}}><input style={{width:"auto"}} type="checkbox" checked={followPointer} onChange={e => onFollowPointer(e.target.checked)}/>Seguir el cursor</label>
  {!followPointer && <small>Clienta fijada. Pulsa «Preparar mensaje» en otra tarjeta para cambiarla.</small>}
  <label>Nombre del saludo<input value={name} onChange={e => { onFollowPointer(false); setName(e.target.value); setFeedback(""); }} placeholder="Selecciona una clienta"/></label>
  <label>Tu mensaje editable<textarea value={template} onChange={e => { setTemplate(e.target.value); setFeedback(""); }} rows={8}/></label>
  <small>Usa {"{nombre}"} donde quieras insertar su nombre. La plantilla se conserva en este navegador.</small>
  <label>Mensaje listo para copiar<textarea ref={preview} readOnly value={message} rows={5}/></label>
  <button type="button" className={styles.copyMessage} disabled={!canCopy} onClick={() => void copy()}><Copy size={16}/>Copiar mensaje</button>
  <p role="status">{feedback}</p>
 </aside>;
}
