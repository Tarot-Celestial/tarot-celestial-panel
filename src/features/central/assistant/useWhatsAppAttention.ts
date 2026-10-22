'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { WHATSAPP_ATTENTION_REFRESH, parseWhatsAppAttention, type WhatsAppAttentionItem, type WhatsAppAttentionNotice, type WhatsAppAttentionSnapshot } from '@/lib/whatsapp-attention';

type State = WhatsAppAttentionSnapshot & { workerId: string; notice: WhatsAppAttentionNotice | null };
type Delivery = { baseline: number; seen: Record<string, number>; initialized?: boolean; owner?: string; announcementOwner?: string; announcementKey?: string };
type Options = { enabled: boolean; workerId?: string | null; onReminder?: () => void };
const empty: State = { workerId: '', count: 0, unreadChats: 0, error: '', accountId: null, session: null, notice: null };

export function useWhatsAppAttention({ enabled, workerId, onReminder }: Options) {
  const [state, setState] = useState<State>(empty);
  const current = useRef({ enabled, workerId, onReminder }); current.current = { enabled, workerId, onReminder };
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const dismiss = useCallback(() => setState(previous => ({ ...previous, notice: null })), []);

  useEffect(() => {
    if (!enabled || !workerId) { setState(empty); return; }
    const sb = supabaseBrowser(), tabId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let disposed = false, generation = 0, userId = '', identity = '', loading = false;
    let controller: AbortController | null = null, coalesced: number | undefined;
    let fallbackTimer: number | undefined, finishFallback: (() => void) | undefined;
    const valid = (version: number) => !disposed && generation === version && current.current.enabled && current.current.workerId === workerId;
    const key = () => `tc-whatsapp-attention-v1:${userId}:${workerId}:${identity}`;
    const invalidate = () => { generation++; controller?.abort(); controller = null; loading = false; window.clearTimeout(coalesced); };
    const clear = () => { identity = ''; setState({ ...empty, workerId }); };
    const fail = (message: string) => setState(previous => ({ ...previous, workerId, notice: null, error: message }));
    const read = (): Delivery | null => {
      try {
        const value = JSON.parse(window.localStorage.getItem(key()) || 'null');
        return value && Number.isFinite(value.baseline) && value.seen && typeof value.seen === 'object' && !Array.isArray(value.seen) ? value : null;
      } catch { return null; }
    };
    const announce = async (items: WhatsAppAttentionItem[], count: number, serverNow: number, version: number) => {
      const claim = async (serialized: boolean) => {
        if (!valid(version) || document.hidden) return;
        const stored = read(), previous = stored?.initialized ? stored : null;
        // Baseline existing unread messages once. Later history syncs and read
        // counter changes are never described as new inbound messages.
        // WhatsApp timestamps have second precision. A message arriving later
        // in the baseline's same second must still count as a new event.
        const baseline = previous?.baseline ?? Math.floor(serverNow / 1000) * 1000;
        const seen: Record<string, number> = Object.fromEntries(Object.entries(previous?.seen || {}).filter(([, at]) => Number.isFinite(at) && serverNow - at < 7 * 86_400_000));
        const incoming = items.filter(item => item.last_incoming_id && !Object.hasOwn(seen, item.last_incoming_id)
          && item.last_incoming_at && Date.parse(item.last_incoming_at) >= baseline && Date.parse(item.last_incoming_at) <= serverNow + 30_000);
        const notify = count > 0 && (!previous || incoming.length > 0);
        if (previous && !notify && items.every(item => !item.last_incoming_id || Object.hasOwn(seen, item.last_incoming_id))) return;
        for (const item of items) if (item.last_incoming_id) seen[item.last_incoming_id] = serverNow;
        const bounded = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 6000));
        try { window.localStorage.setItem(key(), JSON.stringify({ ...(previous || { baseline, seen: {}, initialized: false }), owner: tabId })); }
        catch { fail('Activa el almacenamiento del navegador para recibir avisos de WhatsApp sin duplicados.'); return; }
        if (!serialized) await new Promise<void>(resolve => { finishFallback = resolve; fallbackTimer = window.setTimeout(() => { finishFallback = undefined; resolve(); }, 80); });
        if (!valid(version) || document.hidden || read()?.owner !== tabId) return;
        const announcementKey = notify ? `${identity}:${serverNow}:${Math.random()}` : previous?.announcementKey;
        try { window.localStorage.setItem(key(), JSON.stringify({ baseline, seen: bounded, initialized: true, owner: tabId, announcementKey, announcementOwner: notify ? tabId : previous?.announcementOwner })); }
        catch { fail('No puedo guardar el estado de los avisos de WhatsApp.'); return; }
        if (!notify) return;
        setState(previousState => ({ ...previousState, notice: { key: announcementKey!, initial: !previous, count, items: previous ? incoming : items } }));
        current.current.onReminder?.();
      };
      if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(key(), { ifAvailable: true }, async lock => { if (lock) await claim(true); });
      else await claim(false);
    };
    const load = async () => {
      if (disposed || document.hidden || loading) return;
      loading = true; const version = generation;
      try {
        const { data } = await sb.auth.getSession();
        if (!valid(version)) return;
        if (!data.session) { clear(); fail('Inicia sesión para comprobar los mensajes de WhatsApp.'); return; }
        if (userId && userId !== data.session.user.id) { invalidate(); clear(); userId = data.session.user.id; window.setTimeout(() => void load(), 0); return; }
        userId = data.session.user.id;
        const request = new AbortController(); controller = request;
        // The local bridge can wait up to 24s for the PC. Do not pile up reads.
        const timeout = window.setTimeout(() => request.abort(), 28_000);
        try {
          const response = await fetch('/api/central/whatsapp?action=attention', { cache: 'no-store', headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: request.signal });
          const payload = await response.json();
          if (!valid(version)) return;
          if (!response.ok || !payload.ok) {
            if (response.status === 401 || response.status === 403) clear();
            throw new Error(response.status === 409 ? 'WhatsApp no está conectado. Revisa su vinculación; el contador está sin actualizar.' : 'No puedo actualizar WhatsApp ahora. Reintentaré al recuperar la conexión.');
          }
          if (payload.user_id !== userId || payload.worker_id !== workerId || typeof payload.session !== 'string' || !payload.session || typeof payload.account_id !== 'string' || !payload.account_id
            || !Number.isFinite(Date.parse(payload.server_time)) || !Number.isSafeInteger(payload.unread_total) || payload.unread_total < 0 || !Number.isSafeInteger(payload.unread_chats) || payload.unread_chats < 0) {
            clear(); throw new Error('La sesión de WhatsApp cambió. Vuelve a abrir el panel.');
          }
          const items = parseWhatsAppAttention(payload.items), nextIdentity = JSON.stringify([payload.session, payload.account_id]);
          const same = identity === nextIdentity; identity = nextIdentity;
          setState(previous => {
            const remaining = previous.notice?.items.filter(item => items.some(active => active.id === item.id)) || [];
            return { workerId, count: payload.unread_total, unreadChats: payload.unread_chats, error: '', session: payload.session, accountId: payload.account_id,
              notice: same && previous.notice && payload.unread_total > 0 && remaining.length ? { ...previous.notice, count: payload.unread_total, items: remaining } : null };
          });
          await announce(items, payload.unread_total, Date.parse(payload.server_time), version);
        } finally { window.clearTimeout(timeout); }
      } catch (error) { if (valid(version)) fail(error instanceof Error && error.name !== 'AbortError' ? error.message : 'WhatsApp está tardando en responder. El contador está sin actualizar.'); }
      finally { if (valid(version)) { loading = false; controller = null; } }
    };
    const visible = () => { if (!document.hidden) void load(); };
    const changed = () => { invalidate(); coalesced = window.setTimeout(() => { coalesced = undefined; void load(); }, 250); };
    const visibility = () => { if (document.hidden) { invalidate(); setState(previous => ({ ...previous, notice: null })); } else visible(); };
    const offline = () => { invalidate(); fail('Sin conexión. WhatsApp está sin actualizar hasta que vuelvas a conectar.'); };
    const storage = (event: StorageEvent) => { const delivered = read(); if (userId && identity && event.key === key() && delivered?.announcementKey && delivered.announcementOwner !== tabId) setState(previous => ({ ...previous, notice: null })); };
    const subscription = sb.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id || '';
      if (event === 'SIGNED_OUT' || (userId && nextUser !== userId)) { invalidate(); clear(); userId = nextUser; if (nextUser) window.setTimeout(visible, 0); }
    });
    setState({ ...empty, workerId }); refreshRef.current = changed; void load();
    const poll = window.setInterval(visible, 15_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', visible); window.addEventListener('online', changed); window.addEventListener('offline', offline);
    window.addEventListener('storage', storage); window.addEventListener(WHATSAPP_ATTENTION_REFRESH, changed);
    return () => {
      disposed = true; invalidate(); refreshRef.current = () => {};
      window.clearInterval(poll); window.clearTimeout(fallbackTimer); finishFallback?.(); subscription.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', visible); window.removeEventListener('online', changed); window.removeEventListener('offline', offline);
      window.removeEventListener('storage', storage); window.removeEventListener(WHATSAPP_ATTENTION_REFRESH, changed);
    };
  }, [enabled, workerId]);

  const own = enabled && !!workerId && state.workerId === workerId;
  return { ...(own ? state : empty), refresh, dismiss };
}
