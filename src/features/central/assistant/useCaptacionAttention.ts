'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getActiveBrand } from '@/components/global/BrandSwitcher';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { CAPTACION_ATTENTION_REFRESH, captacionAnnouncementDue, parseCaptacionAttention, type CaptacionAttentionItem, type CaptacionAttentionNotice } from '@/lib/captacion-attention';

type State = { identity: string; notice: CaptacionAttentionNotice | null; error: string };
type Options = { enabled: boolean; workerId?: string | null; blocked?: boolean; onReminder?: () => void };
const empty: State = { identity: '', notice: null, error: '' };

export function useCaptacionAttention({ enabled, workerId, blocked = false, onReminder }: Options) {
  const [brand, setBrand] = useState<'celestial' | 'orion'>('celestial');
  const [state, setState] = useState<State>(empty);
  const current = useRef({ enabled, workerId, brand, blocked, onReminder });
  current.current = { enabled, workerId, brand, blocked, onReminder };
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const dismiss = useCallback(() => setState(previous => ({ ...previous, notice: null })), []);

  useEffect(() => {
    const update = () => setBrand(getActiveBrand());
    update(); window.addEventListener('tc-brand-changed', update);
    return () => window.removeEventListener('tc-brand-changed', update);
  }, []);

  useEffect(() => {
    if (!enabled || !workerId) { setState(empty); return; }
    const identity = `${workerId}:${brand}`, sb = supabaseBrowser();
    const tabId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let disposed = false, generation = 0, userId = '', loading = false, claiming = false;
    let fetchedAt = 0, clockOffset = 0, snapshotValid = false;
    let rows: CaptacionAttentionItem[] = [], controller: AbortController | null = null;
    let coalesced: number | undefined;
    let fallbackTimer: number | undefined;
    let finishFallback: (() => void) | undefined;
    const valid = (version: number) => !disposed && generation === version && current.current.enabled
      && current.current.workerId === workerId && current.current.brand === brand;
    const key = () => `tc-captacion-attention-v1:${userId}:${identity}`;
    const hide = (error = '') => { if (!disposed) setState(previous => previous.identity === identity && !previous.notice && previous.error === error ? previous : { identity, notice: null, error }); };
    const invalidate = () => {
      generation++; controller?.abort(); controller = null; loading = false; snapshotValid = false;
      window.clearTimeout(coalesced); coalesced = undefined;
    };
    const fail = (error: unknown) => {
      snapshotValid = false;
      hide(error instanceof Error && error.name !== 'AbortError' ? error.message : 'No puedo comprobar Captación ahora. Reintentaré al recuperar la conexión.');
    };
    const readDelivery = (): { at?: number; owner?: string } => {
      try { const value = JSON.parse(window.localStorage.getItem(key()) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
    };

    const check = async () => {
      if (disposed || document.hidden || !snapshotValid || !userId || claiming || current.current.blocked || Date.now() - fetchedAt > 20_000) return;
      const version = generation, now = Date.now() + clockOffset;
      rows = parseCaptacionAttention(rows, now);
      if (!rows.length) { hide(); return; }
      if (!captacionAnnouncementDue(readDelivery().at, now)) return;
      claiming = true;
      const claim = async (serialized: boolean) => {
        if (!valid(version) || document.hidden || current.current.blocked || !snapshotValid) return;
        const delivered = readDelivery();
        if (!captacionAnnouncementDue(delivered.at, now)) return;
        const record = { at: now, owner: tabId };
        // A shared, non-sensitive delivery time prevents refreshes and other
        // windows from announcing the same queue again during this minute.
        try { window.localStorage.setItem(key(), JSON.stringify(record)); }
        catch { fail(new Error('Activa el almacenamiento del navegador para recibir avisos de Captación sin duplicados.')); return; }
        if (!serialized) {
          // Older browsers lack Web Locks. Let competing tabs settle their
          // shared claim, then only the last owner displays the notification.
          await new Promise<void>(resolve => {
            finishFallback = resolve;
            fallbackTimer = window.setTimeout(() => { finishFallback = undefined; resolve(); }, 80);
          });
        }
        if (!valid(version) || document.hidden || current.current.blocked || !snapshotValid || readDelivery().owner !== tabId) return;
        const active = parseCaptacionAttention(rows, Date.now() + clockOffset);
        if (!active.length) return;
        setState({ identity, error: '', notice: { key: `${identity}:${now}`, announcedAt: now, items: active } });
        current.current.onReminder?.();
      };
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
          await navigator.locks.request(key(), { ifAvailable: true }, async lock => { if (lock) await claim(true); });
        } else await claim(false);
      } catch (error) { if (valid(version)) fail(error); }
      finally { claiming = false; }
    };

    const load = async () => {
      if (disposed || document.hidden || loading) return;
      loading = true;
      const version = generation;
      try {
        const { data } = await sb.auth.getSession();
        if (!valid(version)) return;
        if (!data.session) { rows = []; throw new Error('Inicia sesión para recibir los avisos de Captación.'); }
        if (userId && data.session.user.id !== userId) { invalidate(); rows = []; userId = data.session.user.id; hide(); window.setTimeout(() => void load(), 0); return; }
        userId = data.session.user.id;
        const requestController = new AbortController(); controller = requestController;
        const timeout = window.setTimeout(() => requestController.abort(), 12_000);
        try {
          const response = await fetch(`/api/captacion/attention?brand=${brand}`, {
            cache: 'no-store', signal: requestController.signal,
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          const payload = await response.json();
          if (!valid(version)) return;
          if (!response.ok || !payload.ok) {
            if (response.status === 401 || response.status === 403) rows = [];
            throw new Error('No puedo comprobar Captación ahora. Reintentaré al recuperar la conexión.');
          }
          if (payload.worker_id !== workerId || payload.user_id !== userId || payload.brand !== brand || !Number.isFinite(Date.parse(payload.server_time))) {
            rows = []; throw new Error('La sesión cambió. Abre de nuevo el panel para recibir avisos.');
          }
          fetchedAt = Date.now(); clockOffset = Date.parse(payload.server_time) - fetchedAt;
          rows = parseCaptacionAttention(payload.items, fetchedAt + clockOffset); snapshotValid = true;
          setState(previous => ({ identity, error: '', notice: previous.identity === identity && previous.notice && rows.length
            ? { ...previous.notice, items: rows } : null }));
          void check();
        } finally { window.clearTimeout(timeout); }
      } catch (error) { if (valid(version)) fail(error); }
      finally { if (valid(version)) { loading = false; controller = null; } }
    };
    const visible = () => { if (!document.hidden) void load(); };
    const changed = () => { invalidate(); hide(); coalesced = window.setTimeout(() => { coalesced = undefined; void load(); }, 900); };
    const offline = () => { invalidate(); fail(new Error('Sin conexión. Los avisos de Captación volverán al reconectar.')); };
    const storage = (event: StorageEvent) => {
      if (userId && event.key === key() && readDelivery().owner !== tabId) hide();
    };
    const subscription = sb.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id || '';
      if (event === 'SIGNED_OUT' || (userId && nextUser !== userId)) {
        invalidate(); rows = []; userId = nextUser; hide();
        if (nextUser) window.setTimeout(visible, 0);
      }
    });
    const channel = sb.channel(`captacion-attention-${identity}-${tabId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'captacion_leads' }, changed)
      .subscribe(status => { if (status === 'SUBSCRIBED') visible(); });
    setState({ ...empty, identity }); refreshRef.current = changed; void load();
    const poll = window.setInterval(visible, 15_000), tick = window.setInterval(() => void check(), 1_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible); window.addEventListener('online', changed);
    window.addEventListener('offline', offline); window.addEventListener('storage', storage);
    window.addEventListener(CAPTACION_ATTENTION_REFRESH, changed);
    return () => {
      disposed = true; invalidate(); refreshRef.current = () => {};
      window.clearInterval(poll); window.clearInterval(tick); window.clearTimeout(fallbackTimer); finishFallback?.();
      subscription.data.subscription.unsubscribe(); void sb.removeChannel(channel);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible); window.removeEventListener('online', changed);
      window.removeEventListener('offline', offline); window.removeEventListener('storage', storage);
      window.removeEventListener(CAPTACION_ATTENTION_REFRESH, changed);
    };
  }, [enabled, workerId, brand]);

  const own = enabled && !!workerId && state.identity === `${workerId}:${brand}`;
  return { notice: own && !blocked ? state.notice : null, error: own ? state.error : '', refresh, dismiss, brand };
}
