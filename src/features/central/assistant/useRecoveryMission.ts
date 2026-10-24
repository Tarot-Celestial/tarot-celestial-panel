'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { parseRecoveryMission, RECOVERY_MISSION_REFRESH, type RecoveryMissionSnapshot } from '@/lib/recovery-mission';
import { readRecoveryMission } from '@/lib/recovery-mission-read';

type State = { mission: RecoveryMissionSnapshot | null; error: string; loading: boolean; preparing: boolean };
const empty: State = { mission: null, error: '', loading: true, preparing: false };

export function useRecoveryMission({ enabled = true, workerId }: { enabled?: boolean; workerId?: string | null } = {}) {
  const [state, setState] = useState<State>(empty);
  const refreshRef = useRef<() => void>(() => {});
  const prepareRef = useRef<() => Promise<void>>(async () => {});
  const identity = useRef({ enabled, workerId });
  identity.current = { enabled, workerId };
  const refresh = useCallback(() => refreshRef.current(), []);
  const prepare = useCallback(() => prepareRef.current(), []);

  useEffect(() => {
    if (!enabled) { setState({ ...empty, loading: false }); return; }
    const auth = supabaseBrowser().auth;
    let disposed = false, generation = 0, userId: string | null = null;
    let controller: AbortController | null = null, pending = false;
    const valid = (version: number) => !disposed && generation === version
      && identity.current.enabled && identity.current.workerId === workerId;
    const invalidate = () => { generation++; controller?.abort(); controller = null; pending = false; };
    const request = async (prepareMission = false) => {
      if (disposed || document.hidden || pending) return;
      pending = true;
      const version = generation;
      setState(previous => ({ ...previous, loading: !prepareMission, preparing: prepareMission }));
      try {
        const { data } = await auth.getSession();
        if (!valid(version)) return;
        if (!data.session) throw new Error('Inicia sesión para consultar tu misión.');
        if (userId && data.session.user.id !== userId) {
          invalidate(); userId = data.session.user.id; setState(empty);
          window.setTimeout(() => void request(), 0); return;
        }
        userId = data.session.user.id;
        controller = new AbortController();
        const currentController = controller;
        const timeout = window.setTimeout(() => currentController.abort(), 12_000);
        try {
          const result = prepareMission ? await (async () => {
            const response = await fetch('/api/central/recovery-mission', {
              method: 'POST', cache: 'no-store', signal: currentController.signal,
              headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'prepare' }),
            });
            return { ok: response.ok, payload: await response.json() };
          })() : await readRecoveryMission(data.session.access_token, currentController.signal);
          const { payload } = result;
          if (!valid(version)) return;
          if (!result.ok || !payload.ok) throw new Error(payload.error || 'No se pudo consultar la misión. Reintenta para ver los datos reales.');
          const mission = parseRecoveryMission(payload.mission, workerId);
          setState({ mission, error: '', loading: false, preparing: false });
          if (prepareMission) {
            // Let the list and any other companion instance reload the committed assignment.
            pending = false;
            window.dispatchEvent(new Event(RECOVERY_MISSION_REFRESH));
          }
        } finally { window.clearTimeout(timeout); }
      } catch (error) {
        if (valid(version)) setState({ mission: null, loading: false, preparing: false,
          error: error instanceof Error && error.name !== 'AbortError' ? error.message : 'La misión no respondió a tiempo. Reintenta para comprobar tu progreso.' });
      } finally {
        if (valid(version)) { pending = false; controller = null; }
      }
    };
    const visible = () => { if (!document.hidden) void request(); };
    const changed = () => { invalidate(); visible(); };
    const offline = () => {
      invalidate(); setState({ mission: null, loading: false, preparing: false, error: 'Sin conexión. Actualizaremos la misión al volver a conectar.' });
    };
    const subscription = auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id || null;
      if (event === 'SIGNED_OUT' || (userId !== null && nextUser !== userId)) {
        invalidate(); userId = nextUser; setState({ ...empty, loading: !!nextUser });
        if (nextUser) window.setTimeout(visible, 0);
      }
    });
    refreshRef.current = changed;
    prepareRef.current = () => request(true);
    setState(empty); void request();
    const timer = window.setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', changed);
    window.addEventListener('offline', offline);
    window.addEventListener(RECOVERY_MISSION_REFRESH, changed);
    return () => {
      disposed = true; invalidate(); refreshRef.current = () => {}; prepareRef.current = async () => {};
      window.clearInterval(timer); subscription.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', offline);
      window.removeEventListener(RECOVERY_MISSION_REFRESH, changed);
    };
  }, [enabled, workerId]);

  const own = enabled && (!workerId || state.mission?.worker_id === workerId);
  return { ...state, mission: own ? state.mission : null, refresh, prepare };
}
