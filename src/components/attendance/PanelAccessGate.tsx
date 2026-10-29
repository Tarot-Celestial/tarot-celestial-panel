'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { LockKeyhole, LogIn, LogOut, Clock3 } from 'lucide-react';
import { useAttendance } from '@/hooks/useAttendance';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isPanelPath } from '@/lib/attendance/panel-session';
import styles from './PanelAccessGate.module.css';

export default function PanelAccessGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const attendance = useAttendance();
  const protectedPath = isPanelPath(path);
  const contentRef = useRef<HTMLDivElement>(null);
  const consultationRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const offsetRef = useRef(0);
  useEffect(() => {
    if (attendance.serverNow) offsetRef.current = Date.parse(attendance.serverNow)-Date.now();
  }, [attendance.serverNow]);
  useEffect(() => {
    if (!protectedPath) return;
    const tick = () => setNow(Date.now()+offsetRef.current);
    tick();
    const timer = window.setInterval(tick,1000);
    window.addEventListener('focus',tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus',tick); };
  }, [protectedPath]);
  const expires = Date.parse(attendance.expiresAt || '');
  const hasWorkingSession = attendance.online && attendance.status==='working' && !!attendance.sessionId && Number.isFinite(expires);
  const expired = hasWorkingSession && Number.isFinite(expires) && now>=expires;
  const locked = protectedPath && (!hasWorkingSession || expired || !!attendance.error);
  const secondsLeft = Number.isFinite(expires) ? Math.max(0,Math.ceil((expires-now)/1000)) : 0;
  const warning = protectedPath && !locked && secondsLeft<=90;
  const tarotista = attendance.workerRole === 'tarotista';
  const consultationEnd = Date.parse(attendance.consultationUntil || '');
  const consultationActive = tarotista && attendance.consultationSource === 'self_reported_external_call' && consultationEnd>now;
  const consultationSeconds = Math.max(0, Math.ceil((consultationEnd-now)/1000));
  const consultationWarning = consultationActive && consultationSeconds<=90;
  const consultationExpired = attendance.closeReason === 'consultation_timeout'
    || (expired && Number.isFinite(consultationEnd) && expires<=consultationEnd);
  const consultationTime = consultationActive
    ? new Date(consultationEnd).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
  const showConsultation = protectedPath && tarotista && !locked;

  useEffect(() => {
    const workspace = contentRef.current, controls = consultationRef.current;
    if (!showConsultation || !workspace || !controls) return;
    const measure = () => workspace.style.setProperty('--panel-consultation-height', `${Math.ceil(controls.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(controls);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', measure);
      workspace.style.removeProperty('--panel-consultation-height');
    };
  }, [showConsultation]);

  useEffect(() => {
    if (!locked) return;
    // Native inert also removes keyboard/focus access. Include React portals
    // mounted directly under body; keep only this gate's controls reachable.
    const restored = new Map<HTMLElement, boolean>();
    const protectPortals = () => {
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child.contains(gateRef.current) || child.contains(contentRef.current) || child.tagName==='SCRIPT' || child.tagName==='STYLE') continue;
        if (!restored.has(child)) { restored.set(child,child.inert); child.inert=true; }
      }
    };
    protectPortals();
    const observer = new MutationObserver(protectPortals);
    observer.observe(document.body,{childList:true});
    const active = document.activeElement;
    if (active instanceof HTMLElement && !gateRef.current?.contains(active)) active.blur();
    return () => { observer.disconnect(); for (const [element,inert] of restored) element.inert=inert; };
  }, [locked]);
  useEffect(() => {
    if (expired) void attendance.refreshAttendance();
  }, [expired, attendance.refreshAttendance]);

  async function connect() {
    setBusy(true); setMessage('');
    try { await attendance.changeAttendance('online'); }
    catch (error) { setMessage(error instanceof Error && error.message === 'SESSION_REQUIRED'
      ? 'No se pudo verificar tu sesión. Reintenta o pulsa Salir para entrar de nuevo.'
      : error instanceof Error ? error.message : 'No se pudo confirmar la conexión.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await attendance.changeAttendance('offline'); } catch {}
    await supabaseBrowser().auth.signOut();
    window.location.href='/login';
  }
  async function keepActive() {
    setBusy(true); setMessage('');
    try { await attendance.keepAttendanceActive(); }
    catch { setMessage('No se pudo confirmar la actividad. Revisa tu conexión.'); }
    finally { setBusy(false); }
  }
  async function changeConsultation(action: 'consultation_start' | 'consultation_end') {
    setBusy(true); setMessage('');
    try { await attendance.changeAttendance(action); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo confirmar el modo consulta.'); }
    finally { setBusy(false); }
  }

  const consultationControls = showConsultation ? <div ref={consultationRef} className={`${styles.warning} ${styles.consultation} ${consultationWarning || warning ? styles.urgent : ''}`} role="status" aria-live="polite">
      <Clock3 size={20}/><div>
        <strong>{consultationActive ? consultationWarning ? 'Tu consulta declarada está por terminar' : 'Estoy en consulta' : warning ? 'Tu conexión va a caducar' : 'Panel conectado'}
          {consultationActive ? <span aria-live="off"> · {Math.floor(consultationSeconds/60)}:{String(consultationSeconds%60).padStart(2,'0')}</span>
            : warning ? <span aria-live="off"> ({secondsLeft} s)</span> : null}</strong>
        <p>{consultationActive
          ? `Declarada por ti hasta las ${consultationTime} (hora de este dispositivo). Si sigues atendiendo, amplía otros 60 minutos.`
          : '¿Atiendes desde otro teléfono? Declara tu consulta para mantener el panel disponible durante 60 minutos.'}</p>
        {message ? <p role="alert">{message}</p> : null}
      </div>
      <div className={styles.consultationActions}>
        <button type="button" disabled={busy} onClick={() => void changeConsultation('consultation_start')}>{consultationActive ? 'Ampliar 60 min' : 'Estoy en consulta (60 min)'}</button>
        {consultationActive ? <button type="button" disabled={busy} onClick={() => void changeConsultation('consultation_end')}>Terminar consulta</button>
          : warning ? <button type="button" disabled={busy} onClick={() => void keepActive()}>Mantener conectado</button> : null}
      </div>
    </div> : null;

  return <>
    <div ref={contentRef} data-panel-workspace className={locked ? styles.locked : showConsultation ? styles.withConsultation : undefined}
      {...(locked ? { inert: '' } as Record<string,string> : {})} aria-hidden={locked || undefined}>
      {consultationControls}
      {children}
    </div>
    {locked ? <div ref={gateRef} className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="panel-connect-title">
      <div className={styles.card}>
        <span className={styles.icon}><LockKeyhole size={27}/></span>
        <p className={styles.eyebrow}>Control de jornada</p>
        <h1 id="panel-connect-title">Conéctate para desbloquear el panel</h1>
        <p>{consultationExpired
          ? 'Han terminado los 60 minutos de consulta declarada. Tu cuenta sigue abierta; pulsa Conectado para continuar.'
          : expired || attendance.closeReason==='inactivity'
          ? 'El panel se ha desconectado tras 10 minutos sin actividad. Tu acceso a la cuenta sigue abierto; pulsa Conectado para continuar.'
          : attendance.status==='break' || attendance.status==='bathroom'
          ? 'Estás en descanso. Pulsa Conectado cuando vuelvas para registrar tu tiempo de trabajo.'
          : 'Selecciona Conectado para empezar a registrar tu jornada y utilizar las pestañas.'}</p>
        {attendance.error ? <p role="alert" className={styles.error}>No hemos podido verificar tu estado. Puedes reintentarlo sin cerrar tu sesión.</p> : null}
        {message ? <p role="alert" className={styles.error}>{message}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.connect} disabled={busy || attendance.loading} onClick={() => void connect()}><LogIn size={17}/>{busy ? 'Confirmando…' : 'Conectado'}</button>
          {attendance.error ? <button type="button" disabled={busy || attendance.loading} onClick={() => void attendance.refreshAttendance()}>Reintentar estado</button> : null}
          <button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={16}/>Salir</button>
        </div>
        <small>{tarotista
          ? 'Desconexión automática: 10 minutos sin actividad. Si atiendes desde otro teléfono, activa Estoy en consulta al comenzar; dura 60 minutos y puedes ampliarlo.'
          : 'Desconexión automática: 10 minutos sin actividad. Las llamadas confirmadas por la centralita mantienen la jornada abierta.'}</small>
      </div>
    </div> : warning && !tarotista ? <div className={styles.warning} role="status" aria-live="polite">
      <Clock3 size={20}/><div><strong>Tu conexión va a caducar <span aria-live="off">({secondsLeft} s)</span></strong><p>{attendance.callProtectionAvailable===false ? 'No podemos confirmar llamadas desde la centralita. Si sigues trabajando, pulsa Mantener conectado.' : 'Si sigues trabajando, confirma tu actividad. Una llamada verificada mantiene la conexión.'}</p>{message ? <p role="alert">{message}</p> : null}</div>
      <button type="button" disabled={busy} onClick={() => void keepActive()}>Mantener conectado</button>
    </div> : null}
  </>;
}
