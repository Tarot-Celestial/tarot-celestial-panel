'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isCurrentReservationReminder, reservationCandidates, type ReservationReminder, type UpcomingReservation } from '@/lib/reservation-reminders';

type Options = {
  enabled: boolean;
  workerId?: string | null;
  onReminder?: (reminder: ReservationReminder) => void;
};
type State = { workerId: string; reminders: ReservationReminder[]; error: string };

export function useReservationReminders({ enabled, workerId, onReminder }: Options) {
  const [state, setState] = useState<State>({ workerId: '', reminders: [], error: '' });
  const refreshRef = useRef<() => void>(() => {});
  const callback = useRef(onReminder);
  const currentIdentity = useRef({ enabled, workerId });
  callback.current = onReminder;
  currentIdentity.current = { enabled, workerId };
  const refresh = useCallback(() => refreshRef.current(), []);
  const dismiss = useCallback(() => setState(previous => ({ ...previous, reminders: previous.reminders.slice(1) })), []);

  useEffect(() => {
    if (!enabled || !workerId) { setState({ workerId: '', reminders: [], error: '' }); return; }
    const owner = workerId;
    const auth = supabaseBrowser().auth;
    let disposed = false, generation = 0, userId: string | null = null;
    let loading = false, claiming = false, fetchedAt = 0, clockOffset = 0;
    let rows: UpcomingReservation[] = [];
    const processed = new Set<string>();
    const controllers = new Set<AbortController>();
    const valid = (version: number) => !disposed && generation === version
      && currentIdentity.current.enabled && currentIdentity.current.workerId === owner;
    const reset = (changedReservationId?: string) => {
      generation++; rows = []; fetchedAt = 0;
      if (!changedReservationId) processed.clear();
      for (const controller of controllers) controller.abort();
      controllers.clear();
      if (!disposed) setState(previous => ({ workerId: owner, error: '', reminders: changedReservationId && previous.workerId === owner
        ? previous.reminders.filter(item => item.id !== changedReservationId) : [] }));
    };
    const fail = (error: unknown) => {
      rows = []; fetchedAt = 0;
      setState({ workerId: owner, reminders: [], error: error instanceof Error ? error.message : 'No puedo comprobar las reservas ahora.' });
    };
    const request = async (version: number, body?: unknown) => {
      const { data } = await auth.getSession();
      if (!valid(version)) return null;
      if (!data.session) throw new Error('Inicia sesión para recibir avisos de reservas.');
      if (userId && data.session.user.id !== userId) { reset(); userId = data.session.user.id; return null; }
      userId = data.session.user.id;
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch('/api/central/assistant/reservations', {
          method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json();
        if (!valid(version)) return null;
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'No puedo comprobar las reservas ahora.');
        if (payload.workerId !== owner || payload.userId !== userId) throw new Error('La cuenta ha cambiado. Abre de nuevo tu compañero para activar los avisos.');
        return payload;
      } finally { window.clearTimeout(timeout); controllers.delete(controller); }
    };

    const check = async () => {
      if (disposed || document.hidden || claiming || !fetchedAt || Date.now() - fetchedAt > 30_000) return;
      const version = generation, now = Date.now() + clockOffset;
      setState(previous => {
        if (previous.workerId !== owner) return previous;
        const current = previous.reminders.filter(item => isCurrentReservationReminder(item, rows, now))
          .map(item => ({ ...item, minutesRemaining: Math.max(1, Math.ceil((Date.parse(item.scheduledAt) - now) / 60_000)) }));
        return current.length === previous.reminders.length && current.every((item, index) => item.minutesRemaining === previous.reminders[index].minutesRemaining)
          ? previous : { ...previous, reminders: current };
      });
      const candidate = reservationCandidates(rows, now).find(item => !processed.has(item.key));
      if (!candidate) return;
      claiming = true;
      try {
        // Revalidate cancellation, schedule and permissions on the server at every threshold.
        const payload = await request(version, { id: candidate.id, scheduledAt: candidate.scheduledAt, threshold: candidate.threshold });
        if (!payload || !valid(version)) return;
        processed.add(candidate.key);
        if (payload.delivered && payload.reminder) {
          const reminder = payload.reminder as ReservationReminder;
          if (!isCurrentReservationReminder(reminder, rows, Date.now() + clockOffset)) return;
          setState(previous => ({ workerId: owner, error: '', reminders: [
            ...(previous.workerId === owner ? previous.reminders.filter(item => item.id !== reminder.id) : []), reminder,
          ].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)) }));
          callback.current?.(reminder);
        } else if (payload.reason === 'stale') {
          rows = rows.filter(row => row.id !== candidate.id);
          setState(previous => ({ ...previous, reminders: previous.reminders.filter(item => item.id !== candidate.id) }));
          void load();
        }
      } catch (error) {
        if (valid(version)) fail(error);
      } finally { claiming = false; }
    };

    const load = async () => {
      if (disposed || document.hidden || loading) return;
      loading = true;
      const version = generation;
      try {
        const payload = await request(version);
        if (!payload || !valid(version)) return;
        if (!Array.isArray(payload.reservations) || !Number.isFinite(Date.parse(payload.serverNow))) throw new Error('La agenda no ha devuelto una respuesta válida.');
        rows = payload.reservations;
        fetchedAt = Date.now(); clockOffset = Date.parse(payload.serverNow) - fetchedAt;
        setState(previous => ({ workerId: owner, error: '', reminders: previous.workerId === owner
          ? previous.reminders.filter(item => isCurrentReservationReminder(item, rows, Date.now() + clockOffset)) : [] }));
        void check();
      } catch (error) { if (valid(version)) fail(error); }
      finally { loading = false; }
    };

    const visible = () => { if (!document.hidden) void load(); };
    const changed = (event: Event) => {
      // Never deliver from a cached schedule while a cancellation/reschedule is being refreshed.
      // Preserve other displayed reminders: their persisted delivery keys prevent reconstructing them after a reset.
      const detail = (event as CustomEvent<{ id?: string; reserva?: { id?: string } }>).detail;
      reset(detail?.id || detail?.reserva?.id);
      void load();
    };
    const offline = () => { reset(); fail(new Error('Sin conexión. Los avisos de reservas se reactivarán al volver a conectar.')); };
    const subscription = auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id || null;
      if (event === 'SIGNED_OUT' || (userId !== null && nextUser !== userId)) {
        reset(); userId = nextUser;
        // Avoid calling other Auth methods inside the synchronous Auth callback.
        if (nextUser) window.setTimeout(visible, 0);
      }
    });
    setState({ workerId: owner, reminders: [], error: '' });
    refreshRef.current = () => { void load(); };
    void load();
    const poll = window.setInterval(visible, 25_000);
    const tick = window.setInterval(() => void check(), 1_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    window.addEventListener('offline', offline);
    window.addEventListener('tc-reservation-changed', changed);
    return () => {
      disposed = true; reset(); refreshRef.current = () => {};
      window.clearInterval(poll); window.clearInterval(tick);
      subscription.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      window.removeEventListener('offline', offline);
      window.removeEventListener('tc-reservation-changed', changed);
    };
  }, [enabled, workerId]);

  const visible = enabled && !!workerId && state.workerId === workerId;
  const reminders = visible ? state.reminders : [];
  return { reminder: reminders[0] || null, reminders, error: visible ? state.error : '', refresh, dismiss };
}
