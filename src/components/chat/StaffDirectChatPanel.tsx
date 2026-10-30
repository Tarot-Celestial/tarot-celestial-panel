"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, ChevronLeft, MessageCircle, RefreshCw, Search, Volume2, VolumeX } from "lucide-react";
import { useAttendance } from "@/hooks/useAttendance";
import { usePanelSessionAccess } from "@/hooks/usePanelSessionAccess";
import { chatRequest } from "@/lib/staff-chat-client";
import { releaseChatMediaDraft, uploadStaffChatMedia, type StaffChatMediaDraft } from "@/lib/staff-chat-media";
import { useStaffChat, type StaffChatMessage } from "@/providers/StaffChatProvider";
import StaffChatComposer from "./StaffChatComposer";
import StaffChatAttachment from "./StaffChatAttachment";
import styles from "./StaffDirectChatPanel.module.css";

const FILTERS = ["todos", "conectados", "no-leidos"] as const;
type Page = { messages: StaffChatMessage[]; has_more: boolean; next_cursor: string | null };
type ThreadHistory = { messages: StaffChatMessage[]; hasMore: boolean; cursor: string | null; loaded: boolean; scrollTop: number | null };
function draftKey(threadId: string, contactId: string) { return threadId ? `thread:${threadId}` : `contact:${contactId}`; }

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "TC"; }
function presence(state: string) {
  const value = String(state || "offline").toLowerCase();
  if (["online", "connected", "conectado", "active", "working"].includes(value)) return { key: "online", label: "Conectado" };
  if (["break", "pause", "descanso", "bathroom"].includes(value)) return { key: "break", label: "Descanso" };
  return { key: "offline", label: "Desconectado" };
}
function dayLabel(iso: string) {
  const date = new Date(iso), now = new Date();
  const calendarKey = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
  };
  const key = calendarKey(date), today = calendarKey(now), [year, month, day] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  if (key === today) return "Hoy";
  if (key === yesterday) return "Ayer";
  return date.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });
}
function timeLabel(iso: string) { return new Date(iso).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }); }
function messageKey(message: StaffChatMessage) { return message.client_message_id ? `${message.sender_worker_id}:${message.client_message_id}` : message.id; }
// A refreshed page updates delivery/read receipts without discarding older pages
// or duplicating an optimistic message that the server has already accepted.
function mergeMessages(current: StaffChatMessage[], incoming: StaffChatMessage[]) {
  const merged = new Map(current.map(message => [messageKey(message), message]));
  const keysById = new Map(current.map(message => [message.id, messageKey(message)]));
  for (const message of incoming) {
    const key = messageKey(message), previousKey = keysById.get(message.id);
    const previous = merged.get(key) || (previousKey ? merged.get(previousKey) : undefined);
    if (previousKey && previousKey !== key) merged.delete(previousKey);
    merged.set(key, { ...previous, ...message, attachment: message.attachment || previous?.attachment, read_at: message.read_at || previous?.read_at, pending: message.pending || false, failed: message.failed || false });
    keysById.set(message.id, key);
  }
  return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export default function StaffDirectChatPanel({ compact = false }: { compact?: boolean }) {
  const { me, mode, contacts, threads, loading, error: sharedError, live, sound, volume, audioReady, notificationPermission, refresh, setSound, setVolume, testSound, enableNotifications, setVisibleThread, incoming, openRequest } = useStaffChat();
  const attendance = useAttendance();
  const { connected, verificationPending } = usePanelSessionAccess(attendance);
  const surfaceId = useId();
  const meId = me?.id || "";
  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("todos");
  const [composer, setComposer] = useState("");
  const [mediaDraft, setMediaDraft] = useState<StaffChatMediaDraft | null>(null);
  const [error, setError] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mobileConversation, setMobileConversation] = useState(false);
  const [narrow, setNarrow] = useState(true);
  const [focused, setFocused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [messageViewportVisible, setMessageViewportVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [readCandidate, setReadCandidate] = useState<string | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const shellRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selection = useRef({ threadId: "", contactId: "", generation: 0 });
  const actorRef = useRef(meId);
  const activeRef = useRef(false);
  const mounted = useRef(true);
  const initialLoaded = useRef(false);
  const latestRequest = useRef<AbortController | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const pendingSends = useRef(new Set<string>());
  const outbox = useRef(new Map<string, StaffChatMessage[]>());
  const histories = useRef(new Map<string, ThreadHistory>());
  const drafts = useRef(new Map<string, string>());
  const openingContacts = useRef(new Set<string>());
  const knownThreads = useRef(new Map<string, string>());
  const mediaDrafts = useRef(new Map<string, StaffChatMediaDraft>());
  const mediaOutbox = useRef(new Map<string, StaffChatMediaDraft>());
  const readAck = useRef(new Map<string, string>());
  const readInFlight = useRef(new Set<string>());
  const scrollToEnd = useRef(false);
  const scrollRestore = useRef<{ height: number; top: number } | null>(null);
  const restoreThreadTop = useRef<number | null>(null);
  const handledOpen = useRef<number | null>(null);
  const handledIncoming = useRef(new Set<string>());
  actorRef.current = meId;
  const conversationVisible = onScreen && (!narrow || mobileConversation);
  const active = conversationVisible && focused && connected && !!meId;
  activeRef.current = active;

  const selectedThread = threads.find(thread => thread.id === selectedThreadId);
  const selectedContact = contacts.find(contact => contact.id === selectedContactId) || selectedThread?.contact || null;
  const threadByContact = useMemo(() => {
    const map = new Map<string, (typeof threads)[number]>();
    for (const thread of threads) if (thread.contact?.id && !map.has(thread.contact.id)) map.set(thread.contact.id, thread);
    return map;
  }, [threads]);
  const contactThreads = useMemo(() => threads.filter(thread => thread.contact?.id === selectedContactId), [threads, selectedContactId]);
  const sortedContacts = useMemo(() => contacts.map(contact => ({ contact, thread: threadByContact.get(contact.id) })).filter(({ contact, thread }) => {
    if (search.trim() && !contact.display_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filter === "conectados") return presence(contact.state).key === "online";
    if (filter === "no-leidos") return Number(thread?.unread_count || 0) > 0;
    return true;
  }).sort((a, b) => Number(Boolean(b.thread?.unread_count)) - Number(Boolean(a.thread?.unread_count)) || ["online", "break", "offline"].indexOf(presence(a.contact.state).key) - ["online", "break", "offline"].indexOf(presence(b.contact.state).key) || a.contact.display_name.localeCompare(b.contact.display_name)), [contacts, filter, search, threadByContact]);

  const updateThreadMessages = useCallback((threadId: string, incoming: StaffChatMessage[]) => {
    const history = histories.current.get(threadId) || { messages: [], hasMore: false, cursor: null, loaded: false, scrollTop: null };
    const merged = mergeMessages(history.messages, incoming);
    histories.current.set(threadId, { ...history, messages: merged });
    if (selection.current.threadId === threadId) setMessages(merged);
  }, []);

  const chooseThread = useCallback((threadId: string, contactId: string, reset = false) => {
    if (!reset && selection.current.threadId === threadId && selection.current.contactId === contactId) return;
    const previous = histories.current.get(selection.current.threadId);
    if (!reset && previous && listRef.current) previous.scrollTop = listRef.current.scrollTop;
    selection.current = { threadId, contactId, generation: selection.current.generation + 1 };
    latestRequest.current?.abort(); olderRequest.current?.abort();
    const history = histories.current.get(threadId);
    initialLoaded.current = history?.loaded || false; scrollToEnd.current = history?.scrollTop == null; scrollRestore.current = null;
    restoreThreadTop.current = history?.scrollTop ?? null;
    setSelectedContactId(contactId); setSelectedThreadId(threadId);
    setMessages(mergeMessages(history?.messages || [], outbox.current.get(threadId) || [])); setComposer(drafts.current.get(draftKey(threadId, contactId)) || ""); setError("");
    setMediaDraft(mediaDrafts.current.get(draftKey(threadId, contactId)) || null);
    setCursor(history?.cursor || null); setHasMore(history?.hasMore || false); setLoadingMore(false); setMessageLoading(false);
    setOpening(false); setReadCandidate(null); setNewBelow(0); setAtBottom(true);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; selection.current.generation++; latestRequest.current?.abort(); olderRequest.current?.abort();
      new Set([...mediaDrafts.current.values(), ...mediaOutbox.current.values()]).forEach(releaseChatMediaDraft);
    };
  }, []);
  useEffect(() => {
    new Set([...mediaDrafts.current.values(), ...mediaOutbox.current.values()]).forEach(releaseChatMediaDraft);
    mediaDrafts.current.clear(); mediaOutbox.current.clear();
    histories.current.clear(); drafts.current.clear(); openingContacts.current.clear(); knownThreads.current.clear();
    outbox.current.clear(); pendingSends.current.clear(); readAck.current.clear(); readInFlight.current.clear(); handledOpen.current = null; handledIncoming.current.clear();
    chooseThread("", "", true);
  }, [meId, chooseThread]);
  useEffect(() => {
    const syncFocus = () => setFocused(document.visibilityState === "visible" && document.hasFocus());
    const media = window.matchMedia("(max-width: 760px)");
    const syncSize = () => setNarrow(compact || media.matches);
    syncFocus(); syncSize();
    document.addEventListener("visibilitychange", syncFocus); window.addEventListener("focus", syncFocus); window.addEventListener("blur", syncFocus); media.addEventListener("change", syncSize);
    const observer = new IntersectionObserver(entries => setOnScreen(entries.some(entry => entry.isIntersecting)));
    if (shellRef.current) observer.observe(shellRef.current);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", syncFocus); window.removeEventListener("focus", syncFocus); window.removeEventListener("blur", syncFocus); media.removeEventListener("change", syncSize); };
  }, [compact]);
  useEffect(() => {
    if (openRequest && handledOpen.current !== openRequest.version) {
      const thread = threads.find(item => item.id === openRequest.threadId);
      if (!thread?.contact) return;
      handledOpen.current = openRequest.version; chooseThread(thread.id, thread.contact.id); setMobileConversation(true);
      return;
    }
    if (!selectedContactId && !openRequest && contacts.length) {
      const first = threads.find(thread => thread.contact)?.contact || contacts[0];
      chooseThread(threadByContact.get(first.id)?.id || "", first.id);
    }
  }, [openRequest, threads, contacts, selectedContactId, threadByContact, chooseThread]);

  const loadMessages = useCallback(async (before?: string) => {
    const selected = selection.current, actor = actorRef.current;
    if (!selected.threadId || !actor || !activeRef.current) return;
    const controller = new AbortController();
    if (before) {
      if (olderRequest.current) return;
      olderRequest.current = controller; setLoadingMore(true);
    } else {
      latestRequest.current?.abort(); latestRequest.current = controller;
      if (!initialLoaded.current) setMessageLoading(true);
    }
    const isCurrent = () => mounted.current && !controller.signal.aborted && actorRef.current === actor && selection.current.generation === selected.generation && selection.current.threadId === selected.threadId;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const data: Page = await chatRequest(`/api/chat/messages?thread_id=${encodeURIComponent(selected.threadId)}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { signal: controller.signal });
      if (!isCurrent()) return;
      const page = (Array.isArray(data.messages) ? data.messages : []).filter(message => message.thread_id === selected.threadId);
      const confirmed = new Set(page.map(messageKey));
      outbox.current.set(selected.threadId, (outbox.current.get(selected.threadId) || []).filter(message => !confirmed.has(messageKey(message))));
      for (const message of page) {
        if (message.sender_worker_id === actor && message.client_message_id && mediaOutbox.current.has(message.client_message_id)) {
          releaseChatMediaDraft(mediaOutbox.current.get(message.client_message_id)); mediaOutbox.current.delete(message.client_message_id);
        }
      }
      const box = listRef.current;
      if (before && box) scrollRestore.current = { height: box.scrollHeight, top: box.scrollTop };
      if (!before && (!initialLoaded.current || (box && box.scrollHeight - box.scrollTop - box.clientHeight < 70))) scrollToEnd.current = true;
      const history = histories.current.get(selected.threadId) || { messages: [], hasMore: false, cursor: null, loaded: false, scrollTop: null };
      if (before || !initialLoaded.current) {
        setHasMore(data.has_more); setCursor(data.next_cursor);
        history.hasMore = data.has_more; history.cursor = data.next_cursor;
      }
      history.loaded = true; histories.current.set(selected.threadId, history);
      initialLoaded.current = true;
      updateThreadMessages(selected.threadId, page);
      setReadRevision(value => value + 1);
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : "No se pudo cargar la conversación.");
    } finally {
      window.clearTimeout(timeout);
      if (before && olderRequest.current === controller) { olderRequest.current = null; if (mounted.current) setLoadingMore(false); }
      if (!before && latestRequest.current === controller) { latestRequest.current = null; if (mounted.current) setMessageLoading(false); }
    }
  }, [updateThreadMessages]);
  useEffect(() => {
    if (!active || !selectedThreadId) return;
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(), 15000);
    return () => { window.clearInterval(timer); latestRequest.current?.abort(); olderRequest.current?.abort(); };
  }, [active, selectedThreadId, loadMessages]);
  useEffect(() => {
    if (active && incoming?.thread_id === selectedThreadId) {
      const box = listRef.current;
      const nearBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 70;
      if (!handledIncoming.current.has(incoming.id)) {
        handledIncoming.current.add(incoming.id);
        if (nearBottom) scrollToEnd.current = true;
        else setNewBelow(value => value + 1);
      }
      // The authenticated provider has validated this thread. Display its event
      // immediately; the GET reconciles history and receipts in the background.
      updateThreadMessages(selectedThreadId, [incoming]);
      void loadMessages();
    }
  }, [incoming, active, selectedThreadId, loadMessages, updateThreadMessages]);
  useEffect(() => {
    setVisibleThread(surfaceId, active && messageViewportVisible && atBottom && selectedThreadId ? selectedThreadId : null);
    return () => setVisibleThread(surfaceId, null);
  }, [active, messageViewportVisible, atBottom, selectedThreadId, setVisibleThread, surfaceId]);

  const measureVisibleMessages = useCallback(() => {
    const box = listRef.current;
    if (!box || !activeRef.current || !box.clientHeight || document.visibilityState !== "visible" || !document.hasFocus()) { setReadCandidate(null); setMessageViewportVisible(false); return; }
    const bounds = box.getBoundingClientRect();
    const viewport = { top: Math.max(0, bounds.top), bottom: Math.min(window.innerHeight, bounds.bottom) };
    if (viewport.bottom <= viewport.top || bounds.right <= 0 || bounds.left >= window.innerWidth) { setReadCandidate(null); setMessageViewportVisible(false); return; }
    setMessageViewportVisible(true);
    const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 70;
    setAtBottom(bottom); if (bottom) setNewBelow(0);
    let last: string | null = null;
    for (const row of box.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const rowBounds = row.getBoundingClientRect();
      if (rowBounds.bottom > viewport.top && rowBounds.bottom <= viewport.bottom + 1 && rowBounds.top < viewport.bottom) last = row.dataset.messageId || null;
    }
    setReadCandidate(last);
  }, []);
  useEffect(() => {
    window.addEventListener("scroll", measureVisibleMessages, { passive: true, capture: true });
    window.addEventListener("resize", measureVisibleMessages);
    return () => { window.removeEventListener("scroll", measureVisibleMessages, true); window.removeEventListener("resize", measureVisibleMessages); };
  }, [measureVisibleMessages]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const box = listRef.current;
      if (box && restoreThreadTop.current != null) { box.scrollTop = restoreThreadTop.current; restoreThreadTop.current = null; scrollToEnd.current = false; }
      else if (box && scrollRestore.current) { box.scrollTop += box.scrollHeight - scrollRestore.current.height; scrollRestore.current = null; }
      else if (box && scrollToEnd.current) { box.scrollTop = box.scrollHeight; scrollToEnd.current = false; }
      measureVisibleMessages();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, active, measureVisibleMessages]);
  useEffect(() => {
    if (!active || !selectedThreadId || !readCandidate || readAck.current.get(selectedThreadId) === readCandidate || readInFlight.current.has(selectedThreadId)) return;
    const actor = meId, threadId = selectedThreadId, candidate = readCandidate;
    let confirmed = false;
    readInFlight.current.add(threadId);
    void chatRequest("/api/chat/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, through_message_id: candidate }) }).then(() => {
      if (actorRef.current !== actor || !mounted.current) return;
      confirmed = true; readAck.current.set(threadId, candidate); void refresh();
    }).catch(() => { /* Keep the unread count until the server confirms the receipt. */ }).finally(() => {
      if (actorRef.current === actor) { readInFlight.current.delete(threadId); if (mounted.current && confirmed) setReadRevision(value => value + 1); }
    });
  }, [active, readCandidate, readRevision, selectedThreadId, meId, refresh]);

  async function openContact(contactId: string) {
    const current = selection.current;
    const existing = (current.contactId === contactId ? threads.find(thread => thread.id === current.threadId && thread.contact?.id === contactId) : null) || threadByContact.get(contactId);
    const threadId = existing?.id || knownThreads.current.get(contactId) || "";
    chooseThread(threadId, contactId); setMobileConversation(true);
    if (threadId || !connected || openingContacts.current.has(contactId)) return;
    const generation = selection.current.generation, actor = meId;
    setOpening(true);
    openingContacts.current.add(contactId);
    try {
      const data = await chatRequest("/api/chat/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_worker_id: contactId }) });
      if (!mounted.current || actorRef.current !== actor) return;
      knownThreads.current.set(contactId, String(data.thread.id));
      if (selection.current.generation !== generation) return;
      chooseThread(String(data.thread.id), contactId); void refresh();
    } catch (reason) {
      if (mounted.current && actorRef.current === actor && selection.current.generation === generation) setError(reason instanceof Error ? reason.message : "No se pudo abrir la conversación.");
    } finally {
      if (actorRef.current === actor) openingContacts.current.delete(contactId);
      if (mounted.current && actorRef.current === actor && selection.current.generation === generation) setOpening(false);
    }
  }

  async function send(retry?: StaffChatMessage) {
    const text = (retry ? retry.text : composer).trim(), threadId = retry?.thread_id || selectedThreadId;
    const media = retry?.client_message_id ? mediaOutbox.current.get(retry.client_message_id) : mediaDrafts.current.get(draftKey(selectedThreadId, selectedContactId));
    if ((!text && !media && !retry?.attachment) || !threadId || !connected || !meId || text.length > 2000) return;
    if (!retry && (outbox.current.get(threadId) || []).some(message => message.pending)) return;
    const clientId = retry?.client_message_id || crypto.randomUUID();
    if (pendingSends.current.has(clientId)) return;
    const actor = meId;
    const optimistic: StaffChatMessage = { ...retry, id: retry?.id || `tmp-${clientId}`, client_message_id: clientId, thread_id: threadId, sender_worker_id: actor, sender_display_name: me?.display_name || "Tú", text, attachment: media ? { id: media.attachmentId || media.clientUploadId, kind: media.kind, mime_type: media.mimeType, file_name: media.file.name, size_bytes: media.file.size } : retry?.attachment, created_at: retry?.created_at || new Date().toISOString(), pending: true, failed: false };
    if (media) mediaOutbox.current.set(clientId, media);
    pendingSends.current.add(clientId);
    outbox.current.set(threadId, mergeMessages(outbox.current.get(threadId) || [], [optimistic]));
    setError(""); if (!retry) { setComposer(""); drafts.current.delete(draftKey(selectedThreadId, selectedContactId)); mediaDrafts.current.delete(draftKey(selectedThreadId, selectedContactId)); setMediaDraft(null); }
    scrollToEnd.current = true; updateThreadMessages(threadId, [optimistic]);
    try {
      const stillActor = () => mounted.current && actorRef.current === actor;
      const attachmentId = media ? await uploadStaffChatMedia(media, threadId, stillActor, actor) : retry?.attachment?.id;
      if (!stillActor()) return;
      const data = await chatRequest("/api/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, text, client_message_id: clientId, expected_worker_id: actor, ...(attachmentId ? { attachment_id: attachmentId } : {}) }) });
      if (!mounted.current || actorRef.current !== actor) return;
      outbox.current.set(threadId, (outbox.current.get(threadId) || []).filter(message => message.client_message_id !== clientId));
      releaseChatMediaDraft(mediaOutbox.current.get(clientId)); mediaOutbox.current.delete(clientId);
      updateThreadMessages(threadId, [data.message]);
      void refresh();
    } catch (reason) {
      if (!mounted.current || actorRef.current !== actor) return;
      // A refresh may have already recovered a successful send whose POST
      // response was lost. Keep that confirmed message instead of failing it.
      if (!(outbox.current.get(threadId) || []).some(message => message.client_message_id === clientId)) return;
      const failed = { ...optimistic, pending: false, failed: true };
      outbox.current.set(threadId, mergeMessages(outbox.current.get(threadId) || [], [failed]));
      updateThreadMessages(threadId, [failed]);
      if (selection.current.threadId === threadId) setError(reason instanceof Error ? reason.message : "No se pudo confirmar el envío. Puedes reintentarlo.");
    } finally { if (actorRef.current === actor) pendingSends.current.delete(clientId); }
  }

  function changeMediaDraft(next: StaffChatMediaDraft | null) {
    const key = draftKey(selectedThreadId, selectedContactId);
    releaseChatMediaDraft(mediaDrafts.current.get(key));
    if (next) mediaDrafts.current.set(key, next); else mediaDrafts.current.delete(key);
    setMediaDraft(next);
  }

  const selectedPresence = presence(selectedContact?.state || "offline");
  const sending = messages.some(message => message.pending);
  const notificationLabel = notificationPermission === "granted" ? "Notificaciones activadas" : notificationPermission === "denied" ? "Notificaciones bloqueadas en el navegador" : notificationPermission === "unsupported" ? "Notificaciones no disponibles" : "Activar notificaciones";
  let previousDay = "";

  return <section ref={shellRef} className={`${styles.shell} ${compact ? styles.compact : ""}`} aria-label="Chat del equipo">
    <header className={styles.top}>
      <div><span className={styles.eyebrow}>COMUNICACIÓN INTERNA</span><h2>Chat del equipo</h2><p>Conversaciones privadas entre Centrales y Tarotistas.</p></div>
      <div className={styles.controls}>
        <span className={`${styles.live} ${live ? styles.liveOn : ""}`}>● {live ? "Chat en vivo" : "Reconectando"}</span>
        <button type="button" onClick={() => { void refresh(); void loadMessages(); }} aria-label="Actualizar chat" title="Actualizar chat"><RefreshCw size={16}/></button>
        <button type="button" onClick={() => setSound(!sound)} aria-label={sound ? "Silenciar mensajes" : "Activar sonido de mensajes"} aria-pressed={sound} title="Sonido de mensajes">{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button>
        <label className={styles.volume}>Volumen <input aria-label="Volumen de mensajes" type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))}/><output>{volume}%</output></label>
        <button type="button" onClick={() => void testSound()} className={styles.testSound}>Probar sonido</button>
        <small className={styles.audioState}>{!sound || volume === 0 ? "Avisos silenciados" : audioReady ? "Sonido listo" : "Pulsa Probar sonido para activarlo"}</small>
        <button type="button" onClick={() => void enableNotifications()} disabled={notificationPermission === "denied" || notificationPermission === "unsupported"} aria-label={notificationLabel} title={notificationLabel}><Bell size={17}/><span>{notificationLabel}</span></button>
      </div>
    </header>
    {error || sharedError ? <div className={styles.error} role="alert">{error || sharedError}</div> : null}
    {!connected ? <div className={styles.connectionNotice}>Pulsa Conectado para enviar mensajes y confirmar su lectura.</div> : null}
    {verificationPending ? <div className={styles.connectionNotice}>Comprobando la conexión del panel…</div> : null}
    <div className={`${styles.workspace} ${mobileConversation ? styles.mobileOpen : ""}`}>
      <aside className={styles.contacts} aria-label="Contactos del equipo">
        <div className={styles.search}><Search size={16}/><input aria-label="Buscar contacto" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Buscar ${mode === "tarotista" ? "central" : "tarotista"}…`}/></div>
        <div className={styles.filters}>{FILTERS.map(item => <button key={item} type="button" className={filter === item ? styles.activeFilter : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "no-leidos" ? "No leídos" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
        <div className={styles.contactList}>{loading && !contacts.length ? <div className={styles.empty}>Cargando contactos…</div> : sortedContacts.map(({ contact, thread }) => {
          const state = presence(contact.state);
          return <button key={contact.id} type="button" className={`${styles.contact} ${selectedContactId === contact.id ? styles.activeContact : ""}`} aria-pressed={selectedContactId === contact.id} onClick={() => void openContact(contact.id)}>
            <span className={`${styles.avatar} ${styles[`team${String(contact.team || "").toLowerCase()}`] || ""}`}>{initials(contact.display_name)}</span>
            <span className={styles.contactText}><b>{contact.display_name}</b><small><i className={styles[state.key]}/> {state.label}{contact.team ? ` · ${contact.team}` : ""}</small><em>{thread?.last_message_preview || "Iniciar conversación"}</em></span>
            {thread?.unread_count ? <span className={styles.badge} aria-label={`${thread.unread_count} mensajes no leídos`}>{thread.unread_count}</span> : null}
          </button>;
        })}{!loading && !sortedContacts.length ? <div className={styles.empty}>No hay contactos que coincidan.</div> : null}</div>
      </aside>
      <div className={styles.conversation} aria-label="Conversación">{selectedContact ? <>
        <div className={styles.chatHeader}><button type="button" className={styles.back} onClick={() => setMobileConversation(false)}><ChevronLeft size={18}/> Volver</button><span className={styles.avatar}>{initials(selectedContact.display_name)}</span><div><b>{selectedContact.display_name}</b><small>{selectedContact.role === "central" ? "Central" : selectedContact.role === "admin" ? "Administración" : "Tarotista"} · <i className={styles[selectedPresence.key]}/> {selectedPresence.label}</small></div>
          {mode === "admin" && contactThreads.length > 1 ? <label className={styles.threadChooser}><span>Conversación</span><select aria-label="Conversación con central" value={selectedThreadId} onChange={event => chooseThread(event.target.value, selectedContactId)}>{contactThreads.map(thread => <option key={thread.id} value={thread.id}>Conversación con {thread.central_display_name || `Central ${String(thread.central_worker_id || thread.id).slice(0, 8)}`}{thread.unread_count ? ` · ${thread.unread_count} sin leer` : ""}</option>)}</select></label> : null}
        </div>
        <div className={styles.messages} ref={listRef} role="log" aria-label={`Mensajes con ${selectedContact.display_name}`} aria-busy={messageLoading || opening} onScroll={() => measureVisibleMessages()}>
          {hasMore ? <button type="button" className={styles.older} disabled={loadingMore || !active} onClick={() => { if (cursor) void loadMessages(cursor); }}>{loadingMore ? "Cargando…" : "Cargar mensajes anteriores"}</button> : null}
          {messages.map(message => {
            const label = dayLabel(message.created_at), showDay = label !== previousDay; previousDay = label;
            const own = message.sender_worker_id === meId;
            return <div key={message.id} data-message-id={message.pending || message.failed ? undefined : message.id}>
              {showDay ? <div className={styles.day}>{label}</div> : null}
              <div className={`${styles.messageRow} ${own ? styles.ownRow : ""}`}><article className={`${styles.bubble} ${own ? styles.ownBubble : ""} ${message.failed ? styles.failed : ""}`}>
                {message.attachment ? <StaffChatAttachment attachment={message.attachment} localPreview={message.client_message_id ? mediaOutbox.current.get(message.client_message_id)?.previewUrl : undefined}/> : null}
                {message.text && !(message.attachment && ["📷 Imagen", "🎤 Nota de voz"].includes(message.text)) ? <p>{message.text}</p> : null}
                <footer><span>{timeLabel(message.created_at)}</span>{own ? message.failed ? <button type="button" className={styles.retry} disabled={!connected} onClick={() => void send(message)}>Reintentar envío</button> : <span>{message.pending ? "Enviando…" : message.read_at ? "✓✓ Leído" : "✓ Enviado"}</span> : null}</footer></article></div>
            </div>;
          })}
          {!messages.length ? <div className={styles.emptyChat}><MessageCircle size={38}/><b>{messageLoading || opening ? "Cargando conversación…" : "Comienza la conversación"}</b><span>{!selectedThreadId && !opening ? "Selecciona este contacto para iniciar el chat." : "Los mensajes aparecerán aquí."}</span></div> : null}
        </div>
        {newBelow ? <button type="button" className={styles.newBelow} onClick={() => { const box = listRef.current; if (box) box.scrollTop = box.scrollHeight; setNewBelow(0); measureVisibleMessages(); }}>Nuevos mensajes ({newBelow}) <ChevronDown size={15}/></button> : null}
        <StaffChatComposer key={`${meId}:${draftKey(selectedThreadId, selectedContactId)}`} text={composer} onText={value => { setComposer(value); drafts.current.set(draftKey(selectedThreadId, selectedContactId), value); }} draft={mediaDraft} onDraft={changeMediaDraft} onSend={() => void send()} disabled={!connected || !selectedThreadId} sending={sending}/>
      </> : <div className={styles.emptyChat}><MessageCircle size={48}/><b>Selecciona un contacto</b><span>Elige a quién quieres escribir.</span></div>}</div>
    </div>
  </section>;
}
