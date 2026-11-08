'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, Coffee, Flag, LogIn, Utensils, X } from 'lucide-react';
import { chatRequest, ChatRequestError } from '@/lib/staff-chat-client';
import { operationErrorMessage, pauseLabel, type StaffConsultation, type StaffOperationActor, type StaffOperationsOverview } from '@/lib/staff-chat-operations';
import styles from './StaffChatOperations.module.css';

type Props = { threadId: string; me: StaffOperationActor; onChanged?: () => void | Promise<void> };
type Action = { action: string; target_id?: string; revision?: number; reason?: string };

function useOperation({ threadId, me, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async (action?: Action) => {
    if (running.current) return false;
    if (action && pending.current) return false;
    const payload = pending.current || (action ? { ...action, thread_id: threadId, expected_worker_id: me.id, operation_id: crypto.randomUUID() } : null);
    if (!payload) return false;
    pending.current = payload; running.current = true; setBusy(true); setError('');
    try {
      await chatRequest('/api/chat/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      pending.current = null;
      window.dispatchEvent(new Event('staff-chat-operations-changed'));
      if (mounted.current) { setUncertain(false); try { await onChanged?.(); } catch { /* A refresh failure must never replay a confirmed mutation. */ } }
      return true;
    } catch (cause) {
      const unknown = !(cause instanceof ChatRequestError) || cause.status === 0 || cause.status >= 500;
      if (!unknown) pending.current = null;
      if (mounted.current) { setUncertain(unknown); setError(unknown ? 'No se ha podido confirmar el resultado. Puedes comprobar la misma solicitud sin duplicarla.' : operationErrorMessage(cause.code)); }
      return false;
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  return { busy: busy || uncertain, submit, notice: error ? <div className={styles.error} role="status">{error}{uncertain ? <button disabled={busy} type="button" onClick={() => void submit()}>Comprobar solicitud</button> : null}</div> : null };
}

export default function StaffChatOperations(props: Props & { hasConsultationMessage?: boolean }) {
  const { threadId, me, hasConsultationMessage = false } = props;
  const [data, setData] = useState<StaffOperationsOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const serial = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const version = ++serial.current;
    try {
      const result = await chatRequest(`/api/chat/operations?thread_id=${encodeURIComponent(threadId)}`, { signal });
      if (version === serial.current && !signal?.aborted) { setData(result); setLoadError(false); }
    } catch { if (version === serial.current && !signal?.aborted) setLoadError(true); }
  }, [threadId]);
  useEffect(() => {
    const controller = new AbortController(); setData(null);
    void reload(controller.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void reload(controller.signal); }, 12000);
    return () => { controller.abort(); ++serial.current; window.clearInterval(timer); };
  }, [reload]);
  const changed = async () => { await reload(); await props.onChanged?.(); };
  const operation = useOperation({ ...props, onChanged: changed });
  const open = data?.pauses.filter(p => ['pending', 'active'].includes(p.status)) || [];
  const own = open.find(p => p.worker_id === me.id);
  return <section className={styles.operations} aria-label="Avisos y última consulta">
    {data?.is_tarotist && !own ? <div className={styles.controls}>
      <button type="button" disabled={operation.busy} onClick={() => void operation.submit({ action: 'bathroom' })}><Clock3 size={14}/>Voy al baño</button>
      <button type="button" disabled={operation.busy} onClick={() => void operation.submit({ action: 'request_lunch' })}><Utensils size={14}/>Pedir almuerzo</button>
      <button type="button" disabled={operation.busy} onClick={() => void operation.submit({ action: 'request_break' })}><Coffee size={14}/>Pedir descanso</button>
    </div> : null}
    {open.map(pause => <div className={styles.pause} key={pause.id}>
      <span className={pause.status === 'pending' ? styles.waitingDot : styles.activeDot}/>
      <span><strong>{pause.worker_name}</strong> {pause.status === 'active' ? pauseLabel(pause.kind) : `solicita ${pause.kind === 'lunch' ? 'almuerzo' : 'descanso'}`}</span>
      {pause.worker_id === me.id ? <button disabled={operation.busy} type="button" onClick={() => void operation.submit({ action: pause.status === 'active' ? 'return' : 'cancel_pause', target_id: pause.id, revision: pause.revision })}><LogIn size={14}/>{pause.status === 'active' ? 'He regresado' : 'Retirar solicitud'}</button> : null}
      {pause.status === 'pending' && data?.can_manage ? <div className={styles.controls}>
        <button className={styles.accept} disabled={operation.busy} type="button" onClick={() => void operation.submit({ action: 'approve_break', target_id: pause.id, revision: pause.revision })}><Check size={14}/>Aceptar</button>
        <button disabled={operation.busy} type="button" onClick={() => void operation.submit({ action: 'reject_break', target_id: pause.id, revision: pause.revision })}><X size={14}/>Rechazar</button>
      </div> : null}
    </div>)}
    {operation.notice}
    {loadError ? <p className={styles.error} role="status">No se pudieron actualizar los avisos. <button type="button" onClick={() => void reload()}>Reintentar</button></p> : null}
    {!hasConsultationMessage && data?.latest_consultation ? <StaffChatConsultationCard {...props} key={`${me.id}:${threadId}:${data.latest_consultation.id}:${data.latest_consultation.revision}`} record={data.latest_consultation} onChanged={changed}/> : null}
    {data?.pending_appeals?.length ? <details className={styles.pendingReviews}><summary>{data.pending_appeals.length} revisiones anteriores pendientes</summary>{data.pending_appeals.map(record => <StaffChatConsultationCard {...props} key={`${me.id}:${threadId}:${record.appeal!.id}:${record.revision}:${record.appeal!.revision}`} record={record} onChanged={changed} reviewOnly/>)}</details> : null}
  </section>;
}

export function StaffChatConsultationCard(props: Props & { record: StaffConsultation; reviewOnly?: boolean }) {
  const { record, me } = props;
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState('');
  const [success, setSuccess] = useState('');
  const operation = useOperation(props);
  useEffect(() => { setForm(false); setReason(''); setSuccess(''); }, [record.id, record.revision]);
  const appeal = record.appeal;
  const isTarotist = me.role === 'tarotista';
  const canResolve = !isTarotist || me.can_admin;
  const canAppeal = isTarotist && !record.deleted && !props.reviewOnly && (!appeal || (appeal.status === 'resolved' && appeal.call_revision !== record.revision));
  const send = async () => {
    const resolving = canResolve && appeal?.status === 'pending';
    const ok = await operation.submit({ action: resolving ? 'resolve_appeal' : 'appeal', target_id: resolving ? appeal.id : record.id, revision: resolving ? appeal.revision : record.revision, reason: reason.trim() });
    if (ok) { setForm(false); setReason(''); setSuccess(resolving ? 'Revisión guardada.' : 'Revisión enviada a la central.'); }
  };
  return <article className={styles.consultation} aria-label="Última consulta registrada">
    <div className={styles.cardHeading}><span>{props.reviewOnly ? 'Consulta en revisión' : 'Última consulta'}</span>{record.revision > 0 ? <small>Actualizada</small> : null}</div>
    {record.deleted ? <p>El registro fue retirado. La revisión se conserva para que la central pueda responder.</p> : null}
    <div className={styles.minutes}>{record.blocks.map(block => <span key={block.code}><strong>{block.minutes}</strong> {block.code.toLowerCase()}</span>)}<b>{record.first_name}</b></div>
    {appeal ? <div className={styles.review}><Flag size={13}/><span>{appeal.status === 'pending' ? 'En revisión' : 'Revisión resuelta'}{appeal.call_revision !== record.revision ? ' · corresponde a una versión anterior' : ''}</span></div> : null}
    {appeal ? <p className={styles.reason}>{appeal.reason}{appeal.resolution ? <><br/><strong>Respuesta:</strong> {appeal.resolution}</> : null}</p> : null}
    {!form && (canAppeal || (canResolve && appeal?.status === 'pending')) ? <button disabled={operation.busy} className={styles.reviewButton} type="button" onClick={() => setForm(true)}><Flag size={13}/>{canResolve ? 'Responder a la revisión' : 'Revisar minutos o código'}</button> : null}
    {form ? <form className={styles.form} onSubmit={e => { e.preventDefault(); void send(); }}>
      <label>{canResolve ? 'Resultado de la revisión' : 'Qué minutos o código hay que revisar'}<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} minLength={3} required placeholder={canResolve ? 'Explica la revisión. Los minutos se corrigen desde Rendimiento.' : 'Ej. Fueron 10 free y 15 cliente.'}/></label>
      <div className={styles.controls}><button disabled={operation.busy || reason.trim().length < 3} type="submit">{operation.busy ? 'Guardando…' : canResolve ? 'Guardar revisión' : 'Enviar revisión'}</button><button disabled={operation.busy} type="button" onClick={() => setForm(false)}>Cancelar</button></div>
    </form> : null}
    {operation.notice}{success ? <p className={styles.success} role="status">{success}</p> : null}
  </article>;
}
