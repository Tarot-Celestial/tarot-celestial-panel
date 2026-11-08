'use client';
import { Mic, MicOff, Phone, PhoneOff, Volume2, X } from 'lucide-react';
import type { StaffPanelCall } from '@/lib/staff-panel-calls';
import styles from './StaffPanelCall.module.css';

export default function StaffPanelCallOverlay({ call, meId, phase, error, preparing, muted, relayConfigured, audioReady, needsPlayback, onAnswer, onEnd, onMute, onPlayback, onDismissError }: {
  call: StaffPanelCall | null; meId: string; phase: string; error: string; preparing: boolean; muted: boolean; relayConfigured: boolean; audioReady: boolean; needsPlayback: boolean;
  onAnswer: () => void; onEnd: () => void; onMute: () => void; onPlayback: () => void; onDismissError: () => void;
}) {
  const incoming = call?.callee_worker_id === meId && call.status === 'ringing';
  const name = call ? call.caller_worker_id === meId ? call.callee_name : call.caller_name : 'Llamada del equipo';
  return <aside className={`${styles.overlay} ${incoming ? styles.ringing : ''}`} role="dialog" aria-label={incoming ? `Llamada de ${name}` : 'Llamada de audio del equipo'} aria-live="polite">
    <div className={styles.top}><span className={styles.icon}><Phone size={21}/></span><div><small>AUDIO · EQUIPO CELESTIAL</small><h2>{name}</h2><p>{phase || 'Llamada finalizada'}</p></div></div>
    {incoming && <p className={styles.hint}>Al aceptar, activarás tu micrófono para hablar con {name}.</p>}
    {incoming && !audioReady && <p className={styles.hint}>El navegador aún no ha habilitado el timbre. Puedes aceptar la llamada aquí.</p>}
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={onDismissError} aria-label="Cerrar aviso de llamada"><X size={16}/></button></div>}
    {call?.status === 'accepted' && !relayConfigured && phase !== 'En llamada' && <p className={styles.hint}>Conectando los dos paneles. Algunas redes pueden impedir la conexión directa.</p>}
    <div className={styles.actions}>
      {incoming && <button type="button" className={styles.accept} disabled={preparing} onClick={onAnswer}><Phone size={18}/>{preparing ? 'Conectando…' : 'Aceptar'}</button>}
      {call?.status === 'accepted' && <button type="button" onClick={onMute} aria-pressed={muted}>{muted ? <MicOff size={18}/> : <Mic size={18}/>}{muted ? 'Activar micro' : 'Silenciar'}</button>}
      {needsPlayback && <button type="button" onClick={onPlayback}><Volume2 size={18}/>Escuchar</button>}
      {(call || preparing) && <button type="button" className={styles.hangup} onClick={onEnd}><PhoneOff size={18}/>{incoming ? 'Rechazar' : preparing && !call ? 'Cancelar' : 'Colgar'}</button>}
    </div>
  </aside>;
}
