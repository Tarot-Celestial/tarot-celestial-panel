'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { parseAtlasWatches, type AtlasClientWatch, type AtlasWatchMutation, type AtlasWatchesController } from './atlas-watch-types';

export function useAtlasWatches(enabled = true): AtlasWatchesController {
  const [watches, setWatches] = useState<AtlasClientWatch[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const actionRef = useRef<(body: AtlasWatchMutation) => Promise<boolean>>(async () => false);

  useEffect(() => {
    setWatches([]); setBusy(''); setError(''); setStale(false); setLoading(enabled);
    if (!enabled) return;
    const auth = supabaseBrowser().auth;
    let disposed = false, generation = 0, revision = 0, reading = false, writing = false, owner: string | null = null;
    const controllers = new Set<AbortController>();
    const current = (version: number) => !disposed && version === generation;
    const reset = () => {
      generation++; controllers.forEach(controller => controller.abort()); controllers.clear();
      reading = false; writing = false;
      setWatches([]); setBusy(''); setError(''); setStale(false); setLoading(false);
    };
    const request = async (body?: AtlasWatchMutation) => {
      const version = generation;
      const { data } = await auth.getSession();
      if (!current(version)) return null;
      if (!data.session) throw new Error('Inicia sesión como administrador para consultar los avisos de Atlas.');
      if (owner && owner !== data.session.user.id) { reset(); owner = data.session.user.id; window.setTimeout(() => void read(), 0); return null; }
      owner = data.session.user.id;
      const controller = new AbortController(); controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch('/api/admin/atlas/watches', {
          method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json();
        if (!current(version)) return null;
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo comprobar el estado de los avisos.');
        return parseAtlasWatches(payload.watches);
      } finally { window.clearTimeout(timeout); controllers.delete(controller); }
    };
    const failure = (reason: unknown) => {
      setStale(true);
      setError(reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'La consulta tardó demasiado. El último saldo está pendiente de actualizar.');
    };
    const read = async () => {
      if (disposed || document.hidden || reading || writing) return;
      reading = true; const version = generation, readRevision = revision;
      try {
        const next = await request();
        if (next && current(version) && revision === readRevision) { setWatches(next); setError(''); setStale(false); }
      } catch (reason) { if (current(version) && revision === readRevision) failure(reason); }
      finally { if (current(version)) { reading = false; setLoading(false); } }
    };
    const mutate = async (body: AtlasWatchMutation) => {
      if (disposed || writing) return false;
      writing = true; revision++; const version = generation;
      setBusy(body.action === 'acknowledge' ? body.alertId : body.watchId); setError('');
      try {
        const next = await request(body);
        if (!next || !current(version)) return false;
        setWatches(next); setStale(false); return true;
      } catch (reason) { if (current(version)) failure(reason); return false; }
      finally { if (current(version)) { writing = false; setBusy(''); } }
    };
    const visible = () => { if (!document.hidden) void read(); };
    const offline = () => { setStale(true); setError('Sin conexión. El último saldo está pendiente de actualizar.'); };
    const subscription = auth.onAuthStateChange((event, session) => {
      const nextOwner = session?.user.id || null;
      if (event === 'SIGNED_OUT' || (owner !== null && nextOwner !== owner)) {
        reset(); owner = nextOwner; if (nextOwner) window.setTimeout(() => void read(), 0);
      } else if (event === 'SIGNED_IN' && nextOwner && owner === null) { owner = nextOwner; window.setTimeout(() => void read(), 0); }
    });
    refreshRef.current = () => void read(); actionRef.current = mutate;
    void read();
    const timer = window.setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible); window.addEventListener('online', visible); window.addEventListener('offline', offline);
    return () => {
      disposed = true; generation++; controllers.forEach(controller => controller.abort());
      window.clearInterval(timer); subscription.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible); window.removeEventListener('online', visible); window.removeEventListener('offline', offline);
      refreshRef.current = () => {}; actionRef.current = async () => false;
    };
  }, [enabled]);

  const refresh = useCallback(() => refreshRef.current(), []);
  const action = useCallback((body: AtlasWatchMutation) => actionRef.current(body), []);
  return { watches, loading, busy, error, stale, refresh, action };
}
