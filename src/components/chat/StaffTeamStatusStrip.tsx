'use client';

import { useEffect, useState } from 'react';
import { BellRing, Coffee, DoorOpen } from 'lucide-react';
import { useStaffChat } from '@/providers/StaffChatProvider';
import { chatRequest } from '@/lib/staff-chat-client';
import { pauseLabel, type StaffOperationsSummary } from '@/lib/staff-chat-operations';
import styles from './StaffTeamStatusStrip.module.css';

const EMPTY: StaffOperationsSummary = { pauses: [], pending: [] };

/** Read-only operational notices. Never starts or extends an attendance session. */
export default function StaffTeamStatusStrip() {
  const chat = useStaffChat();
  const actorId = chat.me?.id || '';
  const [snapshot, setSnapshot] = useState<{ actorId: string; data: StaffOperationsSummary; stale: boolean }>({ actorId: '', data: EMPTY, stale: false });
  useEffect(() => {
    if (!actorId) return;
    let disposed = false, running = false;
    const controller = new AbortController();
    async function refresh() {
      if (disposed || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const result = await chatRequest('/api/chat/operations/summary', { signal: controller.signal });
        if (!disposed) setSnapshot({ actorId, data: { pauses: result.pauses || [], pending: result.pending || [] }, stale: false });
      } catch {
        if (!disposed) setSnapshot(current => current.actorId === actorId ? { ...current, stale: true } : current);
      } finally { running = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20000);
    const changed = () => void refresh();
    window.addEventListener('focus', changed);
    window.addEventListener('staff-chat-operations-changed', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      disposed = true; controller.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', changed);
      window.removeEventListener('staff-chat-operations-changed', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [actorId]);

  const summary = actorId === snapshot.actorId ? snapshot.data : EMPTY;
  if (!summary.pauses.length && !summary.pending.length) return null;
  return <aside className={styles.strip} aria-label="Avisos del equipo">
    <span className={styles.label}>{snapshot.stale ? 'Equipo · pendiente de actualizar' : 'Equipo ahora'}</span>
    <div className={styles.items}>
      {summary.pauses.map(pause => {
        const Icon = pause.kind === 'bathroom' ? DoorOpen : Coffee;
        const content = <><Icon size={13} aria-hidden="true" /><span>{pause.worker_name} {pauseLabel(pause.kind)}</span></>;
        return chat.threads.some(thread => thread.id === pause.thread_id)
          ? <button className={styles.pause} key={pause.id} onClick={() => chat.requestOpen(pause.thread_id)} title="Abrir aviso en el chat">{content}</button>
          : <span className={styles.pause} key={pause.id}>{content}</span>;
      })}
      {summary.pending.map(item => <button className={styles.pending} key={`${item.kind}:${item.id}`} onClick={() => chat.requestOpen(item.thread_id)}>
        <BellRing size={13} aria-hidden="true" /> <span>{item.worker_name} · {item.kind === 'appeal' ? 'consulta en revisión' : 'solicita descanso'}</span>
      </button>)}
    </div>
  </aside>;
}
