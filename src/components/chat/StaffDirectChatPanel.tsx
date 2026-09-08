"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellRing, ChevronDown, ChevronLeft, MessageCircle, RefreshCw, Search, Send, Volume2, VolumeX } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./StaffDirectChatPanel.module.css";

type Contact = { id: string; display_name: string; role: string; team: string | null; state: string };
type Thread = { id: string; central_worker_id?: string | null; tarotist_worker_id?: string | null; last_message_at?: string | null; last_message_preview?: string | null; unread_count: number; contact?: Contact | null; legacy?: boolean };
type ChatMessage = { id: string; thread_id: string; sender_worker_id: string; sender_display_name: string; text: string; created_at: string; read_at?: string | null; client_message_id?: string | null; pending?: boolean; failed?: boolean };
type Mode = "central" | "tarotista" | "admin";

const sb = supabaseBrowser();
const SOUND_KEY = "tc_staff_chat_sound";
const FILTERS = ["todos", "conectados", "no-leidos"] as const;

async function token() { const { data } = await sb.auth.getSession(); return data.session?.access_token || ""; }
async function jsonRequest(url: string, init?: RequestInit) {
  const accessToken = await token();
  if (!accessToken) throw new Error("Tu sesión ha caducado.");
  const res = await fetch(url, { ...init, cache: "no-store", headers: { ...(init?.headers || {}), Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo conectar con el chat.");
  return data;
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TC"; }
function presence(state: string) {
  const value = String(state || "offline").toLowerCase();
  if (["online", "connected", "conectado", "active"].includes(value)) return { key: "online", label: "Conectado" };
  if (["break", "pause", "descanso", "bathroom"].includes(value)) return { key: "break", label: "Descanso" };
  return { key: "offline", label: "Desconectado" };
}
function dayLabel(iso: string) {
  const date = new Date(iso); const now = new Date(); const yesterday = new Date(); yesterday.setDate(now.getDate() - 1);
  const key = date.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  if (key === now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" })) return "Hoy";
  if (key === yesterday.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" })) return "Ayer";
  return date.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });
}
function timeLabel(iso: string) { return new Date(iso).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }); }
function playNotice(volume: number) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext; if (!AudioCtx) return;
    const ctx = new AudioCtx(); const gain = ctx.createGain(); gain.gain.setValueAtTime(Math.max(.02, volume / 100) * .18, ctx.currentTime); gain.connect(ctx.destination);
    [880, 1174].forEach((frequency, index) => { const oscillator = ctx.createOscillator(); oscillator.type = "sine"; oscillator.frequency.value = frequency; oscillator.connect(gain); const start = ctx.currentTime + index * .11; oscillator.start(start); oscillator.stop(start + .12); });
    window.setTimeout(() => void ctx.close(), 500);
  } catch { /* El navegador puede bloquear audio antes de la primera interacción. */ }
}

export default function StaffDirectChatPanel() {
  const [mode, setMode] = useState<Mode>("central"); const [meId, setMeId] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]); const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedContactId, setSelectedContactId] = useState(""); const [selectedThreadId, setSelectedThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [search, setSearch] = useState(""); const [filter, setFilter] = useState<(typeof FILTERS)[number]>("todos");
  const [composer, setComposer] = useState(""); const [busy, setBusy] = useState(true); const [sending, setSending] = useState(false); const [error, setError] = useState("");
  const [live, setLive] = useState(false); const [hasMore, setHasMore] = useState(false); const [cursor, setCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  const [sound, setSound] = useState(true); const [volume, setVolume] = useState(72); const [toast, setToast] = useState<{ name: string; text: string; threadId: string } | null>(null);
  const [mobileConversation, setMobileConversation] = useState(false); const [newBelow, setNewBelow] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null); const selectedRef = useRef(""); const meRef = useRef(""); const soundRef = useRef(true); const volumeRef = useRef(72);

  const selectedThread = useMemo(() => threads.find((item) => item.id === selectedThreadId) || null, [threads, selectedThreadId]);
  const selectedContact = useMemo(() => contacts.find((item) => item.id === selectedContactId) || selectedThread?.contact || null, [contacts, selectedContactId, selectedThread]);
  const threadByContact = useMemo(() => new Map(threads.filter((item) => item.contact?.id).map((item) => [String(item.contact!.id), item])), [threads]);
  const unreadTotal = useMemo(() => threads.reduce((sum, item) => sum + Number(item.unread_count || 0), 0), [threads]);
  const sortedContacts = useMemo(() => contacts.map((contact) => ({ contact, thread: threadByContact.get(contact.id) })).filter(({ contact, thread }) => {
    const q = search.trim().toLowerCase(); if (q && !contact.display_name.toLowerCase().includes(q)) return false;
    if (filter === "conectados") return presence(contact.state).key === "online";
    if (filter === "no-leidos") return Number(thread?.unread_count || 0) > 0;
    return true;
  }).sort((a, b) => Number(Boolean(b.thread?.unread_count)) - Number(Boolean(a.thread?.unread_count)) || ["online", "break", "offline"].indexOf(presence(a.contact.state).key) - ["online", "break", "offline"].indexOf(presence(b.contact.state).key) || a.contact.display_name.localeCompare(b.contact.display_name)), [contacts, filter, search, threadByContact]);

  useEffect(() => { const saved = localStorage.getItem(SOUND_KEY); if (saved) { try { const value = JSON.parse(saved); setSound(value.enabled !== false); setVolume(Number(value.volume || 72)); } catch {} } }, []);
  useEffect(() => { selectedRef.current = selectedThreadId; meRef.current = meId; soundRef.current = sound; volumeRef.current = volume; localStorage.setItem(SOUND_KEY, JSON.stringify({ enabled: sound, volume })); }, [meId, selectedThreadId, sound, volume]);
  useEffect(() => { window.dispatchEvent(new CustomEvent("tc-chat-unread", { detail: { count: unreadTotal } })); }, [unreadTotal]);

  const loadOverview = useCallback(async (silent = false) => {
    try {
      if (!silent) setBusy(true); const data = await jsonRequest(`/api/chat/threads?t=${Date.now()}`);
      setMode(data.mode); setMeId(String(data.me?.id || "")); setContacts(Array.isArray(data.contacts) ? data.contacts : []); setThreads(Array.isArray(data.threads) ? data.threads : []); setError("");
      setSelectedContactId((current) => current || String(data.threads?.[0]?.contact?.id || data.contacts?.[0]?.id || ""));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chat no disponible."); } finally { if (!silent) setBusy(false); }
  }, []);

  const openContact = useCallback(async (contactId: string) => {
    setSelectedContactId(contactId); setMobileConversation(true); setError("");
    const existing = threadByContact.get(contactId); if (existing) { setSelectedThreadId(existing.id); return; }
    try { const data = await jsonRequest("/api/chat/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_worker_id: contactId }) }); setSelectedThreadId(String(data.thread.id)); await loadOverview(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo abrir la conversación."); }
  }, [loadOverview, threadByContact]);

  const loadMessages = useCallback(async (threadId: string, before?: string | null) => {
    if (!threadId) return;
    const data = await jsonRequest(`/api/chat/messages?thread_id=${encodeURIComponent(threadId)}${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    setMessages((current) => before ? [...data.messages, ...current] : data.messages); setHasMore(Boolean(data.has_more)); setCursor(data.next_cursor || null);
    if (!before) { setThreads((current) => current.map((item) => item.id === threadId ? { ...item, unread_count: 0 } : item)); setNewBelow(0); window.setTimeout(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, 40); }
  }, []);

  useEffect(() => { void loadOverview(false); const poll = window.setInterval(() => { if (document.visibilityState === "visible") void loadOverview(true); }, 45000); const focus = () => void loadOverview(true); window.addEventListener("focus", focus); return () => { window.clearInterval(poll); window.removeEventListener("focus", focus); }; }, [loadOverview]);
  useEffect(() => { if (selectedThreadId) void loadMessages(selectedThreadId).catch((reason) => setError(reason instanceof Error ? reason.message : "No se cargaron los mensajes.")); else setMessages([]); }, [loadMessages, selectedThreadId]);

  useEffect(() => {
    const channel = sb.channel(`staff-chat-${meId || "session"}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
      const row: any = payload.new || {}; if (!row.id || String(row.sender_worker_id) === meRef.current) return;
      const thread = threads.find((item) => item.id === String(row.thread_id)); if (!thread) { void loadOverview(true); return; }
      const isOpen = selectedRef.current === String(row.thread_id) && document.visibilityState === "visible";
      const incoming: ChatMessage = { id: String(row.id), thread_id: String(row.thread_id), sender_worker_id: String(row.sender_worker_id), sender_display_name: String(row.sender_display_name || thread.contact?.display_name || "Contacto"), text: String(row.body || ""), created_at: String(row.created_at), read_at: null };
      if (isOpen) {
        setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
        const box = listRef.current; const nearBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 120; if (nearBottom) window.setTimeout(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, 30); else setNewBelow((value) => value + 1);
        void loadMessages(String(row.thread_id)).catch(() => undefined);
      } else {
        const notice = { name: incoming.sender_display_name, text: incoming.text, threadId: incoming.thread_id }; setToast(notice); window.setTimeout(() => setToast(null), 6500);
        if (soundRef.current) playNotice(volumeRef.current);
        if (Notification.permission === "granted") new Notification(`Nuevo mensaje de ${notice.name}`, { body: notice.text.slice(0, 110), tag: `chat-${notice.threadId}` });
      }
      void loadOverview(true);
    }).subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { void sb.removeChannel(channel); };
  }, [loadMessages, loadOverview, meId, threads]);

  async function send() {
    const text = composer.trim(); if (!text || !selectedThreadId || sending || text.length > 2000) return;
    const clientId = crypto.randomUUID(); const optimistic: ChatMessage = { id: `tmp-${clientId}`, client_message_id: clientId, thread_id: selectedThreadId, sender_worker_id: meId, sender_display_name: "Tú", text, created_at: new Date().toISOString(), pending: true };
    setComposer(""); setSending(true); setMessages((current) => [...current, optimistic]); window.setTimeout(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, 20);
    try { const data = await jsonRequest("/api/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: selectedThreadId, text, client_message_id: clientId }) }); setMessages((current) => current.map((item) => item.id === optimistic.id ? data.message : item)); await loadOverview(true); }
    catch (reason) { setMessages((current) => current.map((item) => item.id === optimistic.id ? { ...item, pending: false, failed: true } : item)); setError(reason instanceof Error ? reason.message : "No se pudo enviar."); } finally { setSending(false); }
  }

  async function enableNotifications() { if (!("Notification" in window)) return; await Notification.requestPermission(); }
  async function loadOlder() { if (!cursor || loadingMore) return; const box = listRef.current; const previousHeight = box?.scrollHeight || 0; setLoadingMore(true); try { await loadMessages(selectedThreadId, cursor); window.setTimeout(() => { if (box) box.scrollTop = box.scrollHeight - previousHeight; }, 20); } finally { setLoadingMore(false); } }
  const selectedPresence = presence(selectedContact?.state || "offline"); let previousDay = "";

  return <section className={styles.shell}>
    {toast ? <button className={styles.toast} onClick={() => { const thread = threads.find((item) => item.id === toast.threadId); if (thread?.contact?.id) void openContact(thread.contact.id); setToast(null); }}><BellRing size={19}/><span><b>Nuevo mensaje de {toast.name}</b><small>{toast.text}</small></span></button> : null}
    <header className={styles.top}><div><span className={styles.eyebrow}>COMUNICACIÓN INTERNA</span><h2>Chat del equipo</h2><p>Conversaciones privadas entre Centrales y Tarotistas.</p></div><div className={styles.controls}><span className={`${styles.live} ${live ? styles.liveOn : ""}`}>● {live ? "Chat en vivo" : "Reconectando"}</span><button onClick={() => void loadOverview(false)} title="Actualizar"><RefreshCw size={16}/></button><button onClick={() => setSound((value) => !value)} title="Sonido de mensajes">{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button>{sound ? <input aria-label="Volumen" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))}/> : null}<button onClick={() => void enableNotifications()} title="Activar notificaciones"><Bell size={17}/></button></div></header>
    {error ? <div className={styles.error}>{error}</div> : null}
    <div className={`${styles.workspace} ${mobileConversation ? styles.mobileOpen : ""}`}>
      <aside className={styles.contacts}><div className={styles.search}><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${mode === "tarotista" ? "central" : "tarotista"}…`}/></div><div className={styles.filters}>{FILTERS.map((item) => <button key={item} className={filter === item ? styles.activeFilter : ""} onClick={() => setFilter(item)}>{item === "no-leidos" ? "No leídos" : item[0].toUpperCase() + item.slice(1)}</button>)}</div><div className={styles.contactList}>{busy ? <div className={styles.empty}>Cargando contactos…</div> : sortedContacts.map(({ contact, thread }) => { const state = presence(contact.state); return <button key={contact.id} className={`${styles.contact} ${selectedContactId === contact.id ? styles.activeContact : ""}`} onClick={() => void openContact(contact.id)}><span className={`${styles.avatar} ${styles[`team${String(contact.team || "").toLowerCase()}`] || ""}`}>{initials(contact.display_name)}</span><span className={styles.contactText}><b>{contact.display_name}</b><small><i className={styles[state.key]}/> {state.label}{contact.team ? ` · ${contact.team}` : ""}</small><em>{thread?.last_message_preview || "Iniciar conversación"}</em></span>{thread?.unread_count ? <span className={styles.badge}>{thread.unread_count}</span> : null}</button>; })}{!busy && !sortedContacts.length ? <div className={styles.empty}>No hay contactos activos.</div> : null}</div></aside>
      <main className={styles.conversation}>{selectedContact ? <><div className={styles.chatHeader}><button className={styles.back} onClick={() => setMobileConversation(false)}><ChevronLeft size={18}/> Volver</button><span className={styles.avatar}>{initials(selectedContact.display_name)}</span><div><b>{selectedContact.display_name}</b><small>{selectedContact.role === "central" ? "Central" : "Tarotista"} · <i className={styles[selectedPresence.key]}/> {selectedPresence.label}</small></div></div><div className={styles.messages} ref={listRef} onScroll={(event) => { if (event.currentTarget.scrollTop < 45 && hasMore) void loadOlder(); }}>{hasMore ? <button className={styles.older} onClick={() => void loadOlder()}>{loadingMore ? "Cargando…" : "Cargar mensajes anteriores"}</button> : null}{messages.map((message) => { const label = dayLabel(message.created_at); const showDay = label !== previousDay; previousDay = label; const own = message.sender_worker_id === meId; return <div key={message.id}>{showDay ? <div className={styles.day}>{label}</div> : null}<div className={`${styles.messageRow} ${own ? styles.ownRow : ""}`}><article className={`${styles.bubble} ${own ? styles.ownBubble : ""} ${message.failed ? styles.failed : ""}`}><p>{message.text}</p><footer><span>{timeLabel(message.created_at)}</span>{own ? <span>{message.failed ? "Error · Reintentar" : message.pending ? "Enviando…" : message.read_at ? "✓✓ Leído" : "✓ Enviado"}</span> : null}</footer></article></div></div>; })}{!messages.length ? <div className={styles.emptyChat}><MessageCircle size={38}/><b>Comienza la conversación</b><span>Los mensajes aparecerán aquí al instante.</span></div> : null}</div>{newBelow ? <button className={styles.newBelow} onClick={() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; setNewBelow(0); }}>Nuevos mensajes ({newBelow}) <ChevronDown size={15}/></button> : null}<form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={composer} maxLength={2000} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Escribe un mensaje…"/><span>{composer.length}/2000</span><button disabled={!composer.trim() || sending || !selectedThreadId} title="Enviar"><Send size={18}/></button></form></> : <div className={styles.emptyChat}><MessageCircle size={48}/><b>Selecciona un contacto</b><span>Elige a quién quieres escribir.</span></div>}</main>
    </div>
  </section>;
}
