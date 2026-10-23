'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { emptySocialAttention, parseSocialAttention, SOCIAL_ATTENTION_REFRESH, SOCIAL_INBOX_INVALIDATE, type SocialProvider, type SocialProviderAttention } from '@/lib/social-attention';

type Snapshot = { workerId: string; instagram: SocialProviderAttention; facebook: SocialProviderAttention };
const empty = (workerId = ''): Snapshot => ({ workerId, instagram: emptySocialAttention(), facebook: emptySocialAttention() });
const PROVIDERS: SocialProvider[] = ['instagram', 'facebook'];

/** One global subscription and one small summary request serve both social tabs. */
export function useSocialAttention(enabled: boolean, workerId?: string | null) {
  const [state, setState] = useState<Snapshot>(() => empty());
  const current = useRef({ enabled, workerId }); current.current = { enabled, workerId };
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!enabled || !workerId) { setState(empty()); return; }
    const sb = supabaseBrowser();
    let disposed = false, generation = 0, owner = '', loading = false, queued = false, failures = 0;
    let request: AbortController | null = null;
    let poll: number | undefined, debounce: number | undefined;
    let snapshot = empty(workerId);
    const valid = (version: number) => !disposed && version === generation && current.current.enabled && current.current.workerId === workerId;
    const publish = (next: Snapshot) => { snapshot = next; setState(next); };
    const invalidate = () => { generation++; request?.abort(); request = null; loading = false; queued = false; window.clearTimeout(debounce); };
    const failed = (message: string) => publish({ ...snapshot,
      instagram: { ...snapshot.instagram, error: message }, facebook: { ...snapshot.facebook, error: message } });
    const schedule = () => {
      window.clearTimeout(poll);
      if (!disposed) poll = window.setTimeout(() => void load(), Math.min(300_000, 60_000 * 2 ** Math.min(failures, 3)));
    };
    const load = async () => {
      if (disposed || document.hidden) { schedule(); return; }
      if (loading) { queued = true; return; }
      loading = true; const version = generation;
      try {
        const { data } = await sb.auth.getSession();
        if (!valid(version)) return;
        if (!data.session) { publish(empty(workerId)); throw new Error('Inicia sesión para comprobar las redes sociales.'); }
        if (owner && owner !== data.session.user.id) { publish(empty(workerId)); }
        owner = data.session.user.id;
        const controller = new AbortController(); request = controller;
        const timer = window.setTimeout(() => controller.abort(), 12_000);
        let response: Response, payload: any;
        try {
          response = await fetch('/api/central/social-attention', {
            cache: 'no-store', headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: controller.signal,
          });
          payload = await response.json();
        } finally { window.clearTimeout(timer); }
        if (!valid(version)) return;
        if (!response.ok || !payload?.ok) {
          if (response.status === 401 || response.status === 403) publish(empty(workerId));
          throw new Error('No se pudo actualizar el recuento de redes sociales.');
        }
        if ((payload.user_id && payload.user_id !== owner) || (payload.worker_id && String(payload.worker_id) !== workerId)) {
          publish(empty(workerId)); throw new Error('La sesión cambió. Vuelve a abrir el panel.');
        }
        const next: Snapshot = { workerId,
          instagram: parseSocialAttention(payload.instagram, snapshot.instagram),
          facebook: parseSocialAttention(payload.facebook, snapshot.facebook) };
        const changed = PROVIDERS.filter(provider => snapshot[provider].revision && snapshot[provider].revision !== next[provider].revision);
        publish(next); failures = 0;
        for (const provider of changed) window.dispatchEvent(new CustomEvent(SOCIAL_INBOX_INVALIDATE, { detail: { provider } }));
      } catch (error) {
        if (valid(version)) { failures++; failed(error instanceof Error && error.name !== 'AbortError' ? error.message : 'El recuento está tardando en actualizarse.'); }
      } finally {
        if (valid(version)) {
          loading = false; request = null;
          if (queued) { queued = false; debounce = window.setTimeout(() => void load(), 500); }
          schedule();
        }
      }
    };
    const changed = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), 500);
    };
    const visible = () => { if (!document.hidden) changed(); else { invalidate(); schedule(); } };
    const offline = () => { invalidate(); failures++; failed('Sin conexión. Se muestra el último recuento confirmado.'); schedule(); };
    const auth = sb.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id || '';
      if (event === 'SIGNED_OUT' || (owner && next !== owner)) {
        invalidate(); owner = next; publish(empty(workerId));
        if (next) changed();
      }
    });
    const channel = sb.channel(`central-social-attention:${workerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tc_social_inbox_activity' }, () => changed())
      .subscribe();
    publish(empty(workerId)); refreshRef.current = changed; void load();
    window.addEventListener(SOCIAL_ATTENTION_REFRESH, changed);
    window.addEventListener('focus', changed); window.addEventListener('online', changed); window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; invalidate(); window.clearTimeout(poll); refreshRef.current = () => {};
      auth.data.subscription.unsubscribe(); void sb.removeChannel(channel);
      window.removeEventListener(SOCIAL_ATTENTION_REFRESH, changed);
      window.removeEventListener('focus', changed); window.removeEventListener('online', changed); window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, workerId]);

  const own = enabled && !!workerId && state.workerId === workerId;
  return { ...(own ? state : empty()), refresh };
}
