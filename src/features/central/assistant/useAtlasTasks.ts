'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { AtlasJob, PurchaseCelebration } from '@/lib/central-atlas';

type State = { workerId: string | null; jobs: AtlasJob[]; error: string; loading: boolean; saving: boolean; truncated: boolean };
const empty: State = { workerId: null, jobs: [], error: '', loading: true, saving: false, truncated: false };
export function useAtlasTasks({ enabled, workerId, celebrations = true, onPurchase }: {
  enabled: boolean; workerId?: string | null; celebrations?: boolean; onPurchase: (event: PurchaseCelebration) => void;
}) {
  const [state, setState] = useState<State>(empty);
  const latest = useRef({ enabled, workerId, celebrations, onPurchase });
  latest.current = { enabled, workerId, celebrations, onPurchase };
  const refreshRef = useRef<() => void>(() => {});
  const updateRef = useRef<(body: unknown) => Promise<boolean>>(async () => false);
  const refresh = useCallback(() => refreshRef.current(), []);
  const update = useCallback((body: unknown) => updateRef.current(body), []);

  useEffect(() => {
    if (!enabled) { setState({ ...empty, loading: false }); return; }
    const auth = supabaseBrowser().auth;
    let disposed = false, version = 0, pending = false, saving = false, userId: string | null = null, lastCelebration = 0;
    const controllers = new Set<AbortController>();
    const current = (n: number) => !disposed && n === version && latest.current.enabled && latest.current.workerId === workerId;
    const invalidate = () => { version++; controllers.forEach(controller => controller.abort()); controllers.clear(); pending = false; saving = false; };
    const request = async (body?: unknown) => {
      const controller = new AbortController(); controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const { data } = await auth.getSession();
        if (!data.session) throw new Error('Inicia sesión para consultar tus encargos.');
        if (userId && userId !== data.session.user.id) { userId = data.session.user.id; invalidate(); setState(empty); throw new Error('La sesión cambió.'); }
        userId = data.session.user.id;
        const response = await fetch('/api/central/atlas', { method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo consultar Atlas.');
        return payload;
      } finally { window.clearTimeout(timeout); controllers.delete(controller); }
    };
    const load = async () => {
      if (disposed || pending || document.hidden) return;
      pending = true; const generation = version;
      try {
        const data = await request();
        if (!current(generation)) return;
        if (workerId && data.worker_id !== workerId) throw new Error('La central de la sesión cambió. Actualiza el panel.');
        const jobs = (Array.isArray(data.jobs) ? data.jobs : []).filter((job: AtlasJob) => job.worker_id === data.worker_id);
        setState(previous => ({ ...previous, workerId: data.worker_id, jobs, truncated: !!data.truncated, error: '', loading: false }));
        const event = (Array.isArray(data.events) ? data.events : []).find((item: PurchaseCelebration) => item.worker_id === data.worker_id && item.xp > 0);
        // The server arbitrates multiple tabs/devices. No local event payload can award XP.
        if (event && latest.current.celebrations && !document.hidden && !document.querySelector('[aria-modal="true"]') && Date.now() - lastCelebration >= 12_000) {
          const claimed = await request({ action: 'claim_celebration', event_id: event.id });
          if (current(generation) && claimed.event?.worker_id === data.worker_id && claimed.event?.xp > 0) {
            lastCelebration = Date.now(); latest.current.onPurchase(claimed.event);
          }
        }
      } catch (error) {
        if (current(generation)) setState(previous => ({ ...previous, jobs: [], loading: false,
          error: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Atlas no respondió a tiempo. Reintenta para comprobar los encargos.' }));
      } finally { if (current(generation)) pending = false; }
    };
    const visible = () => { if (!document.hidden) void load(); };
    const refreshNow = () => { if (!saving) { invalidate(); visible(); } };
    refreshRef.current = refreshNow;
    updateRef.current = async body => {
      if (saving || disposed) return false;
      invalidate(); saving = true; const generation = version; setState(previous => ({ ...previous, saving: true, error: '' }));
      try {
        await request(body);
        if (!current(generation)) return false;
        pending = false; void load(); return true;
      } catch (error) {
        if (current(generation)) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'No se pudo guardar el encargo.' }));
        return false;
      } finally { if (current(generation)) { saving = false; setState(previous => ({ ...previous, saving: false })); } }
    };
    const offline = () => { invalidate(); setState({ ...empty, loading: false, error: 'Sin conexión. Los encargos se actualizarán al volver.' }); };
    const subscription = auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id || null;
      if (event === 'SIGNED_OUT' || (userId !== null && nextUser !== userId)) {
        invalidate(); userId = nextUser; setState({ ...empty, loading: !!nextUser });
        if (nextUser) window.setTimeout(visible, 0);
      }
    });
    setState(empty); void load();
    const timer = window.setInterval(visible, 20_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', refreshNow);
    window.addEventListener('offline', offline);
    window.addEventListener('tc-payment-recorded', visible);
    window.addEventListener('tc-xp-recorded', visible);
    return () => {
      disposed = true; invalidate(); refreshRef.current = () => {}; updateRef.current = async () => false;
      window.clearInterval(timer); subscription.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible);
      window.removeEventListener('online', refreshNow); window.removeEventListener('offline', offline);
      window.removeEventListener('tc-payment-recorded', visible); window.removeEventListener('tc-xp-recorded', visible);
    };
  }, [enabled, workerId]);
  return { ...state, jobs: enabled && (!workerId || state.workerId === workerId) ? state.jobs : [], refresh, update };
}
