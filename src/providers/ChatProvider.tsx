'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStaffChat } from '@/providers/StaffChatProvider';
import { chatRequest } from '@/lib/staff-chat-client';

// Compatibility for older central shortcuts. The shared provider is the only
// owner of subscriptions, unread counts and notification preferences.
export type ChatThread = { id: string; title?: string | null; tarotist_display_name?: string | null; tarotist_worker_id?: string | null; last_message_text?: string | null; last_message_at?: string | null; unread_count?: number | null };
export type ChatMessage = { id: string; thread_id: string; sender_worker_id?: string | null; sender_display_name?: string | null; text?: string | null; created_at?: string | null };
export type ChatContextValue = {
  loading: boolean; message: string; threads: ChatThread[]; messages: ChatMessage[]; selectedThreadId: string; unreadTotal: number;
  setSelectedThreadId: (id: string) => void; loadThreads: (silent?: boolean) => Promise<void>;
  loadMessages: (id?: string, silent?: boolean) => Promise<void>; sendMessage: (text: string) => Promise<void>;
  openThreadWithTarotist: (id: string) => Promise<string>; clearMessage: () => void;
};
const Context = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chat = useStaffChat();
  const actorId = chat.me?.id || '';
  const [local, setLocal] = useState<{ actorId: string; selectedThreadId: string; messages: ChatMessage[] }>({ actorId, selectedThreadId: '', messages: [] });
  const actorRef = useRef(actorId), generation = useRef(0), messageRequest = useRef(0), mounted = useRef(true);
  const selection = useRef({ actorId, threadId: '' });
  actorRef.current = actorId;
  // Hide the old account's state during the first render, before effects reset it.
  const selectedThreadId = local.actorId === actorId ? local.selectedThreadId : '';
  const messages = local.actorId === actorId ? local.messages : [];
  useEffect(() => {
    generation.current++; messageRequest.current++;
    selection.current = { actorId, threadId: '' };
    setLocal({ actorId, selectedThreadId: '', messages: [] });
  }, [actorId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; messageRequest.current++; };
  }, []);
  const setSelectedThreadId = useCallback((id: string) => {
    if (!mounted.current || actorRef.current !== actorId || !actorId) return;
    generation.current++; messageRequest.current++;
    selection.current = { actorId, threadId: id };
    setLocal(current => ({ actorId, selectedThreadId: id, messages: current.actorId === actorId && current.selectedThreadId === id ? current.messages : [] }));
  }, [actorId]);
  const threads = useMemo(() => chat.threads.map(thread => ({ ...thread, tarotist_display_name: thread.contact?.display_name, last_message_text: thread.last_message_preview })), [chat.threads]);
  const loadThreads = useCallback(async (_silent?: boolean) => { await chat.refresh(); }, [chat.refresh]);
  const loadMessages = useCallback(async (id?: string, _silent?: boolean) => {
    const threadId = id || selection.current.threadId;
    if (!actorId || actorRef.current !== actorId || selection.current.actorId !== actorId || !threadId || threadId !== selection.current.threadId) return;
    const version = generation.current, request = ++messageRequest.current;
    const isCurrent = () => mounted.current && actorRef.current === actorId && generation.current === version && messageRequest.current === request && selection.current.threadId === threadId;
    try {
      const result = await chatRequest(`/api/chat/messages?thread_id=${encodeURIComponent(threadId)}`);
      if (!isCurrent()) return;
      setLocal(current => current.actorId === actorId && current.selectedThreadId === threadId ? { ...current, messages: result.messages || [] } : current);
    } catch (error) { if (isCurrent()) throw error; }
  }, [actorId]);
  const sendMessage = useCallback(async (text: string) => {
    const threadId = selection.current.threadId, version = generation.current;
    if (!actorId || actorRef.current !== actorId || selection.current.actorId !== actorId || !threadId || !text.trim()) return;
    const isCurrent = () => mounted.current && actorRef.current === actorId && generation.current === version && selection.current.threadId === threadId;
    try {
      await chatRequest('/api/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread_id: threadId, text: text.trim(), client_message_id: crypto.randomUUID() }) });
      if (!isCurrent()) return;
      await chat.refresh();
      if (isCurrent()) await loadMessages(threadId);
    } catch (error) { if (isCurrent()) throw error; }
  }, [actorId, chat.refresh, loadMessages]);
  const openThreadWithTarotist = useCallback(async (workerId: string) => {
    if (!actorId || actorRef.current !== actorId || !mounted.current) return '';
    let version = ++generation.current;
    const isCurrent = () => mounted.current && actorRef.current === actorId && generation.current === version;
    try {
      const result = await chatRequest('/api/chat/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_worker_id: workerId }) });
      if (!isCurrent()) return '';
      const id = String(result.thread.id); setSelectedThreadId(id); version = generation.current;
      await chat.refresh();
      if (!isCurrent()) return '';
      chat.requestOpen(id); return id;
    } catch (error) { if (isCurrent()) throw error; return ''; }
  }, [actorId, chat.refresh, chat.requestOpen, setSelectedThreadId]);
  const value: ChatContextValue = { loading: chat.loading, message: chat.error, threads, messages, selectedThreadId, unreadTotal: chat.unreadTotal,
    setSelectedThreadId, loadThreads, loadMessages, sendMessage, openThreadWithTarotist, clearMessage: () => {} };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChat() {
  const value = useContext(Context);
  if (!value) throw new Error('useChat requiere ChatProvider');
  return value;
}
