'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useAttendance } from '@/hooks/useAttendance';
import { isPanelPath } from '@/lib/attendance/panel-session';
import { chatRequest } from '@/lib/staff-chat-client';
import { CHAT_SOUND_KEY, CHAT_DEFAULT_VOLUME, chatSoundPreferences, chatVolume, chatUnreadTotal, canReadStaffChat } from '@/lib/staff-chat-alerts';

export type StaffChatContact = { id: string; display_name: string; role: string; team: string | null; state: string };
export type StaffChatMessage = { id: string; thread_id: string; sender_worker_id: string; sender_display_name: string; text: string; created_at: string; read_at?: string | null; client_message_id?: string | null; pending?: boolean; failed?: boolean };
export type StaffChatThread = { id: string; central_worker_id?: string | null; tarotist_worker_id?: string | null; last_message_at?: string | null; last_message_preview?: string | null; unread_count: number; contact?: StaffChatContact | null; legacy?: boolean; latest_incoming?: StaffChatMessage | null };
type Actor = { id: string; role: 'central' | 'tarotista' | 'admin'; display_name: string };
type Overview = { me: Actor | null; contacts: StaffChatContact[]; threads: StaffChatThread[] };
type Notice = StaffChatMessage;
type ChatContextValue = Overview & {
  mode: Actor['role']; unreadTotal: number; loading: boolean; error: string; live: boolean;
  sound: boolean; volume: number; audioReady: boolean; notificationPermission: string;
  refresh: () => Promise<void>; setSound: (value: boolean) => void; setVolume: (value: number) => void;
  testSound: () => Promise<void>; enableNotifications: () => Promise<void>;
  setVisibleThread: (surface: string, threadId: string | null) => void;
  incoming: StaffChatMessage | null; notice: Notice | null; dismissNotice: () => void;
  openRequest: { threadId: string; version: number } | null; requestOpen: (threadId: string) => void;
};
const EMPTY: Overview = { me: null, contacts: [], threads: [] };
const Context = createContext<ChatContextValue | null>(null);

export function StaffChatProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const enabled = isPanelPath(path);
  const attendance = useAttendance();
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [live, setLive] = useState(false);
  const [sound, setSoundState] = useState(true), [volume, setVolumeState] = useState(CHAT_DEFAULT_VOLUME), [audioReady, setAudioReady] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState('default');
  const [incoming, setIncoming] = useState<StaffChatMessage | null>(null), [notice, setNotice] = useState<Notice | null>(null);
  const [openRequest, setOpenRequest] = useState<{ threadId: string; version: number } | null>(null);
  const [authRevision, setAuthRevision] = useState(0);
  const overviewRef = useRef(EMPTY), activeRef = useRef(enabled), generation = useRef(0), userRef = useRef('');
  const hydrated = useRef(false), visibleThreads = useRef(new Map<string, string>()), connected = useRef(false);
  const preferences = useRef({ enabled: true, volume: CHAT_DEFAULT_VOLUME });
  const audio = useRef<AudioContext | null>(null), seen = useRef(new Set<string>()), noticeTimer = useRef<number>();
  const desktopNotices = useRef(new Set<Notification>());
  const pending = useRef<Promise<void> | null>(null), queued = useRef(false), startedAt = useRef(Date.now());
  activeRef.current = enabled;
  connected.current = attendance.online && attendance.status === 'working' && !!attendance.sessionId && Date.parse(attendance.expiresAt || '') > Date.now() && !attendance.error;

  const requestOpen = useCallback((threadId: string) => {
    setOpenRequest(current => ({ threadId, version: (current?.version || 0) + 1 }));
    setNotice(null);
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const setVisibleThread = useCallback((surface: string, threadId: string | null) => {
    if (threadId) visibleThreads.current.set(surface, threadId);
    else visibleThreads.current.delete(surface);
  }, []);

  const unlockAudio = useCallback(async () => {
    try {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      if (!audio.current || audio.current.state === 'closed') audio.current = new AudioCtor();
      if (audio.current.state === 'suspended') await audio.current.resume();
      setAudioReady(audio.current.state === 'running');
    } catch { setAudioReady(false); }
  }, []);
  const playSound = useCallback(async () => {
    const ctx = audio.current;
    if (!ctx || ctx.state !== 'running' || preferences.current.volume === 0) return;
    const strength = preferences.current.volume / 100 * 0.55;
    // Reuse the context unlocked by a real click. Bounded envelopes avoid clicks
    // and clipping; the device's own volume always remains under user control.
    for (const [index, hz] of [740, 1046, 740, 1046].entries()) {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      const at = ctx.currentTime + index * 0.2;
      oscillator.type = 'sine'; oscillator.frequency.value = hz;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(strength, at + 0.015);
      gain.gain.setValueAtTime(strength, at + 0.1); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(at); oscillator.stop(at + 0.19);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }, []);
  const testSound = useCallback(async () => { await unlockAudio(); await playSound(); }, [unlockAudio, playSound]);
  const savePreferences = useCallback((next: { enabled: boolean; volume: number }) => {
    preferences.current = next; setSoundState(next.enabled); setVolumeState(next.volume);
    try { localStorage.setItem(CHAT_SOUND_KEY, JSON.stringify(next)); } catch { /* storage may be disabled */ }
  }, []);
  const setSound = useCallback((value: boolean) => {
    savePreferences({ ...preferences.current, enabled: value });
    if (value) void unlockAudio();
  }, [savePreferences, unlockAudio]);
  const setVolume = useCallback((value: number) => savePreferences({ ...preferences.current, volume: chatVolume(value) }), [savePreferences]);
  const enableNotifications = useCallback(async () => {
    if (!('Notification' in window)) { setNotificationPermission('unsupported'); return; }
    try { setNotificationPermission(await Notification.requestPermission()); } catch { setNotificationPermission('unsupported'); }
  }, []);

  const announce = useCallback((message: StaffChatMessage) => {
    if (!message.id || seen.current.has(message.id)) return;
    seen.current.add(message.id);
    if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!);
    setIncoming(message);
    // Reconcile sends from another tab/device immediately, without notifying
    // the sender about their own message.
    if (message.sender_worker_id === overviewRef.current.me?.id) return;
    if (canReadStaffChat(document.visibilityState === 'visible', document.hasFocus(), connected.current, message.thread_id, visibleThreads.current.values())) return;
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 9000);
    const actorId = overviewRef.current.me?.id;
    const noticeGeneration = generation.current;
    const announceOnce = async () => {
      if (!actorId || actorId !== overviewRef.current.me?.id || !activeRef.current) return;
      // Share only receipt IDs across tabs, never message bodies or credentials.
      const key = `tc:chat:announced:${actorId}`;
      try {
        const stored = JSON.parse(localStorage.getItem(key) || '[]');
        const ids: string[] = Array.isArray(stored) ? stored : [];
        if (ids.includes(message.id)) return;
        localStorage.setItem(key, JSON.stringify([...ids.slice(-79), message.id]));
      } catch { /* in-memory dedupe remains available */ }
      if (preferences.current.enabled) await playSound();
      if (noticeGeneration !== generation.current || actorId !== overviewRef.current.me?.id || !activeRef.current) return;
      if ('Notification' in window && Notification.permission === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
        try {
          const desktopNotice = new Notification(`${message.sender_display_name || 'Un compañero'} te ha escrito`, { body: 'Tienes un nuevo mensaje en el chat del equipo.', tag: `tc-chat-${message.thread_id}` });
          desktopNotices.current.add(desktopNotice);
          desktopNotice.onclose = () => desktopNotices.current.delete(desktopNotice);
          desktopNotice.onclick = () => {
            if (noticeGeneration === generation.current && actorId === overviewRef.current.me?.id && activeRef.current) { window.focus(); requestOpen(message.thread_id); }
            desktopNotice.close(); desktopNotices.current.delete(desktopNotice);
          };
        } catch { /* browsers without desktop notifications still show the toast */ }
      }
    };
    // Web Locks prevent two open tabs from sounding for the same message.
    if (typeof navigator !== 'undefined' && navigator.locks) void navigator.locks.request(`tc-chat-notice-${actorId}`, announceOnce).catch(() => undefined);
    else void announceOnce();
  }, [playSound, requestOpen]);

  const refresh = useCallback(async () => {
    if (!activeRef.current) return;
    if (pending.current) { queued.current = true; return pending.current; }
    const version = generation.current;
    const run = async () => {
      try {
        if (!hydrated.current) setLoading(true);
        const data = await chatRequest('/api/chat/threads');
        if (version !== generation.current || !activeRef.current) return;
        const next: Overview = { me: data.me || null, contacts: Array.isArray(data.contacts) ? data.contacts : [], threads: Array.isArray(data.threads) ? data.threads : [] };
        const previous = overviewRef.current;
        overviewRef.current = next; setOverview(next); setError('');
        if (hydrated.current) {
          for (const thread of next.threads) {
            const message = thread.latest_incoming;
            const old = previous.threads.find(item => item.id === thread.id);
            if (message && thread.unread_count > 0 && message.id !== old?.latest_incoming?.id && Date.parse(message.created_at) >= startedAt.current) announce(message);
          }
        } else {
          for (const thread of next.threads) if (thread.latest_incoming) seen.current.add(thread.latest_incoming.id);
        }
        hydrated.current = true;
      } catch (reason) {
        if (version === generation.current && activeRef.current) setError(reason instanceof Error ? reason.message : 'Chat temporalmente no disponible.');
      } finally {
        if (version === generation.current) setLoading(false);
      }
    };
    const task = run(); pending.current = task;
    await task;
    if (pending.current === task) {
      pending.current = null;
      if (queued.current) { queued.current = false; void refresh(); }
    }
  }, [announce]);

  useEffect(() => {
    const apply = () => {
      let value = chatSoundPreferences(null);
      try { value = chatSoundPreferences(localStorage.getItem(CHAT_SOUND_KEY)); } catch {}
      preferences.current = value; setSoundState(value.enabled); setVolumeState(value.volume);
    };
    apply();
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
    const storage = (event: StorageEvent) => { if (event.key === CHAT_SOUND_KEY) apply(); };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => { void unlockAudio(); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [enabled, unlockAudio]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const auth = sb.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id || '';
      if (nextUser !== userRef.current) {
        userRef.current = nextUser; generation.current++; hydrated.current = false; startedAt.current = Date.now();
        overviewRef.current = EMPTY; setOverview(EMPTY); setIncoming(null); setNotice(null); setOpenRequest(null); seen.current.clear(); visibleThreads.current.clear();
        window.clearTimeout(noticeTimer.current);
        for (const notification of desktopNotices.current) notification.close(); desktopNotices.current.clear();
        setAuthRevision(value => value + 1);
      }
      if (session?.access_token) void sb.realtime.setAuth(session.access_token);
    });
    return () => { auth.data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!enabled) {
      generation.current++; overviewRef.current = EMPTY; setOverview(EMPTY); hydrated.current = false;
      setNotice(null); setIncoming(null); setOpenRequest(null); visibleThreads.current.clear(); seen.current.clear(); setLive(false);
      window.clearTimeout(noticeTimer.current);
      for (const notification of desktopNotices.current) notification.close(); desktopNotices.current.clear();
      void audio.current?.close().catch(() => undefined); audio.current = null; setAudioReady(false);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30000);
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [enabled, authRevision, refresh]);
  useEffect(() => {
    if (!enabled || !overview.me?.id) return;
    const sb = supabaseBrowser(); let disposed = false; let channel: ReturnType<typeof sb.channel> | null = null;
    const version = generation.current;
    void sb.auth.getSession().then(async ({ data }) => {
      if (disposed || !data.session?.access_token) return;
      await sb.realtime.setAuth(data.session.access_token);
      if (disposed) return;
      channel = sb.channel(`staff-chat-notifications-${overview.me!.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
          if (disposed || generation.current !== version) return;
          const row = payload.new;
          const message: StaffChatMessage = { id: String(row.id || ''), thread_id: String(row.thread_id || ''), sender_worker_id: String(row.sender_worker_id || ''), sender_display_name: String(row.sender_display_name || 'Compañero'), text: String(row.body || ''), created_at: String(row.created_at || ''), client_message_id: row.client_message_id ? String(row.client_message_id) : null };
          if (overviewRef.current.threads.some(thread => thread.id === message.thread_id)) announce(message);
          // Unknown/new threads are verified against the authenticated overview;
          // its latest_incoming also recovers an event missed while reconnecting.
          void refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_reads', filter: `worker_id=eq.${overview.me!.id}` }, () => { void refresh(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () => { void refresh(); })
        .subscribe(status => { if (!disposed) { setLive(status === 'SUBSCRIBED'); if (status === 'SUBSCRIBED') void refresh(); } });
    }).catch(() => { if (!disposed) setLive(false); });
    return () => { disposed = true; setLive(false); if (channel) void sb.removeChannel(channel); };
  }, [enabled, overview.me?.id, authRevision, announce, refresh]);
  useEffect(() => () => { window.clearTimeout(noticeTimer.current); void audio.current?.close().catch(() => undefined); }, []);

  const unreadTotal = chatUnreadTotal(overview.threads);
  const value = useMemo<ChatContextValue>(() => ({ ...overview, mode: overview.me?.role || 'central', unreadTotal, loading, error, live,
    sound, volume, audioReady, notificationPermission, refresh, setSound, setVolume, testSound, enableNotifications,
    setVisibleThread, incoming, notice, dismissNotice, requestOpen, openRequest,
  }), [overview, unreadTotal, loading, error, live, sound, volume, audioReady, notificationPermission, refresh, setSound, setVolume, testSound, enableNotifications, setVisibleThread, incoming, notice, dismissNotice, requestOpen, openRequest]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStaffChat() {
  const context = useContext(Context);
  if (!context) throw new Error('useStaffChat requiere StaffChatProvider');
  return context;
}
