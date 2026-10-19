'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { AtlasData, AtlasMessage } from './atlas-types';

const blank = (): AtlasData => ({ overview: null, messages: [], memories: [], jobs: [], aiConfigured: null });
type Payload = Partial<AtlasData> & { ok?: boolean; error?: string; message?: AtlasMessage };
type Mutation = { action: string; requestId?: string; message?: string; proposalId?: string; id?: string; password?: string };

export function useAtlas() {
  const [data, setData] = useState<AtlasData>(blank);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const refreshRef = useRef<() => void>(() => {});
  const mutateRef = useRef<(body: Mutation) => Promise<boolean>>(async () => false);
  const requestIds = useRef(new Map<string, string>());
  const chatAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const identityVersion = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const auth = supabaseBrowser().auth;
    let disposed = false, generation = 0, revision = 0, owner: string | null = null, reading = false, writing = false, fullReadQueued = false;
    const controllers = new Set<AbortController>();
    const current = (version: number) => !disposed && generation === version;
    const reset = () => {
      generation++; identityVersion.current++;
      controllers.forEach(controller => controller.abort()); controllers.clear();
      reading = false; writing = false; fullReadQueued = false; requestIds.current.clear(); chatAttempt.current = null;
      setData(blank()); setBusy(''); setError(''); setStale(false); setLoading(false);
      setIdentityEpoch(previous => previous + 1);
    };
    const merge = (payload: Payload) => setData(previous => ({
      overview: payload.overview === undefined ? previous.overview : payload.overview,
      messages: Array.isArray(payload.messages) ? payload.messages : previous.messages,
      memories: Array.isArray(payload.memories) ? payload.memories : previous.memories,
      jobs: Array.isArray(payload.jobs) ? payload.jobs : previous.jobs,
      aiConfigured: typeof payload.aiConfigured === 'boolean' ? payload.aiConfigured : previous.aiConfigured,
    }));
    const request = async (body?: Mutation, light = false): Promise<Payload | null> => {
      const version = generation;
      const { data: sessionData } = await auth.getSession();
      if (!current(version)) return null;
      if (!sessionData.session) throw new Error('Inicia sesión como administrador para hablar con Atlas.');
      if (owner && owner !== sessionData.session.user.id) { reset(); owner = sessionData.session.user.id; window.setTimeout(() => void read(), 0); return null; }
      owner = sessionData.session.user.id;
      const controller = new AbortController(); controllers.add(controller);
      const timer = window.setTimeout(() => controller.abort(), body ? 90_000 : 20_000);
      try {
        const response = await fetch(`/api/admin/atlas${light ? '?overview=1' : ''}`, {
          method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json() as Payload;
        if (!current(version)) return null;
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Atlas no pudo completar la petición. Puedes reintentar.');
        return payload;
      } finally { window.clearTimeout(timer); controllers.delete(controller); }
    };
    const read = async (light = false) => {
      if (disposed || document.hidden || writing) return;
      if (reading) { if (!light) fullReadQueued = true; return; }
      reading = true; const version = generation, readRevision = revision;
      if (!light) setLoading(true);
      try {
        const payload = await request(undefined, light);
        if (payload && current(version) && revision === readRevision) { merge(payload); setStale(false); setError(''); }
      } catch (reason) {
        if (current(version) && revision === readRevision) {
          setStale(true);
          setError(reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'La consulta tardó demasiado. Los datos anteriores no se han actualizado.');
        }
      } finally {
        if (current(version)) {
          reading = false; setLoading(false);
          if (fullReadQueued) { fullReadQueued = false; window.setTimeout(() => void read(), 0); }
        }
      }
    };
    const mutate = async (body: Mutation) => {
      if (disposed || writing) return false;
      writing = true; revision++; const version = generation;
      let committed = false;
      setBusy(body.proposalId || body.id || body.action); setError('');
      if (body.action === 'chat' && body.message) {
        const previousAssistant = [...dataRef.current.messages].reverse().find(message => message.role === 'assistant');
        const sensitive = previousAssistant?.sensitiveFollowup || /contrase[nñ]a|password|\bclave\b/i.test(body.message);
        const text = sensitive ? '[Solicitud de cambio de contraseña. Usa el formulario protegido para la nueva contraseña.]' : body.message;
        const message: AtlasMessage = { id: `request:${body.requestId}`, role: 'user', text, cards: [] };
        setData(previous => ({ ...previous, messages: previous.messages.some(item => item.id === message.id) ? previous.messages : [...previous.messages, message] }));
      }
      try {
        const payload = await request(body);
        if (!payload || !current(version)) return false;
        merge(payload);
        if (payload.message) setData(previous => ({ ...previous, messages: previous.messages.some(message => message.id === payload.message!.id)
          ? previous.messages.map(message => message.id === payload.message!.id ? payload.message! : message)
          : [...previous.messages, payload.message!] }));
        if (body.proposalId) setData(previous => ({ ...previous, messages: previous.messages.map(message => message.proposal && message.proposal.id === body.proposalId
          ? { ...message, proposal: { ...message.proposal, status: body.action === 'cancel_proposal' ? 'cancelled' : 'completed' } } : message) }));
        if (body.action === 'delete_memory') setData(previous => ({ ...previous, memories: previous.memories.filter(memory => memory.id !== body.id) }));
        setStale(false);
        committed = true;
        return true;
      } catch (reason) {
        if (current(version)) setError(reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'No recibí la confirmación. Reintenta la misma acción para comprobar el resultado sin duplicarla.');
        return false;
      } finally {
        if (current(version)) {
          writing = false; setBusy('');
          // Reconcile server history, new memories and assignments after a committed action.
          if (committed) window.setTimeout(() => void read(), 0);
        }
      }
    };
    const visible = () => { if (!document.hidden) void read(true); };
    const offline = () => { setStale(true); setError('Sin conexión. Los datos conservan la fecha de la última consulta.'); };
    const subscription = auth.onAuthStateChange((event, session) => {
      const nextOwner = session?.user.id || null;
      if (event === 'SIGNED_OUT' || (owner !== null && nextOwner !== owner)) {
        reset(); owner = nextOwner;
        if (nextOwner) window.setTimeout(() => void read(), 0);
      }
    });
    refreshRef.current = () => void read(); mutateRef.current = mutate;
    void read();
    const timer = window.setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible); window.addEventListener('online', visible); window.addEventListener('offline', offline);
    return () => {
      disposed = true; generation++; identityVersion.current++; controllers.forEach(controller => controller.abort());
      window.clearInterval(timer); subscription.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible); window.removeEventListener('online', visible); window.removeEventListener('offline', offline);
      refreshRef.current = () => {}; mutateRef.current = async () => false;
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);
  const chat = useCallback(async (message: string) => {
    const text = message.trim(); if (!text) return false;
    const identity = identityVersion.current;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    if (identity !== identityVersion.current) return false;
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (chatAttempt.current?.fingerprint !== fingerprint) chatAttempt.current = { fingerprint, id: crypto.randomUUID() };
    const attempt = chatAttempt.current;
    const result = await mutateRef.current({ action: 'chat', message: text, requestId: attempt.id });
    if (result && chatAttempt.current === attempt) chatAttempt.current = null;
    return result;
  }, []);
  const action = useCallback((kind: 'execute' | 'cancel_proposal' | 'delete_memory', id: string, password?: string) => {
    const key = `${kind}:${id}`;
    if (!requestIds.current.has(key)) requestIds.current.set(key, crypto.randomUUID());
    return mutateRef.current({ action: kind, requestId: requestIds.current.get(key), ...(kind === 'delete_memory' ? { id } : { proposalId: id }), ...(password ? { password } : {}) });
  }, []);
  return { ...data, loading, busy, error, stale, identityEpoch, refresh, chat, action };
}
