"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ExternalLink, Instagram, MessageCircle, MessagesSquare, RefreshCw, Search, Send, Sparkles, TriangleAlert } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { INSTAGRAM_REPLY_TEMPLATES, type InstagramConnection, type InstagramInboxResult, type InstagramMessagesResult, type InstagramThread } from "@/lib/instagram-inbox";
import styles from "./CentralInstagramPanel.module.css";

type Kind = InstagramThread["kind"];
type ThreadDetail = InstagramMessagesResult & { threadId: string };
type RequestPayload = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal };

function errorCopy(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "NO_AUTH": case "UNAUTHORIZED": return "Tu sesión ha caducado. Vuelve a entrar en el panel.";
    case "FORBIDDEN": return "Tu usuario no tiene acceso a la bandeja de Instagram.";
    case "INSTAGRAM_NOT_CONNECTED": case "NOT_CONNECTED": case "TOKEN_MISSING": return "La cuenta de Instagram necesita conectarse desde el panel de administración.";
    case "WRONG_ACCOUNT": return "Administración debe conectar @tarotcelestialof para que aparezca su bandeja aquí.";
    case "INSTAGRAM_PERMISSION_REQUIRED": case "PERMISSION_REQUIRED": case "META_PERMISSION": return "Instagram no ha autorizado esta función. Administración debe revisar los permisos de comentarios y mensajes.";
    case "INSTAGRAM_TOKEN_EXPIRED": case "TOKEN_EXPIRED": return "La conexión de Instagram ha caducado. Administración debe volver a conectar la cuenta.";
    case "REPLY_WINDOW_CLOSED": case "WINDOW_CLOSED": return "Ha terminado el plazo para responder por mensaje desde el panel. Espera un nuevo mensaje del cliente o revisa la conversación en Instagram.";
    case "STALE_CONVERSATION": case "REPLY_CONFLICT": case "STALE_REPLY": return "Otra central ya respondió. Hemos actualizado la conversación: revisa la respuesta antes de enviar la tuya.";
    case "PRIVATE_REPLY_CLOSED": return "Este comentario ya recibió un mensaje privado o ha pasado el plazo disponible. Puedes responder públicamente o esperar a que la persona escriba por mensaje.";
    case "SEND_UNCERTAIN": return "Instagram no ha confirmado el resultado del envío. Revisa la conversación en Instagram antes de volver a responder para evitar duplicarlo.";
    case "SEND_IN_PROGRESS": case "SEND_PENDING": return "Esta respuesta ya se está procesando. Actualiza la conversación antes de volver a intentarlo.";
    case "RATE_LIMITED": case "META_RATE_LIMIT": return "Instagram está limitando las consultas. Espera un momento y vuelve a intentarlo.";
    case "META_REJECTED": return "Instagram rechazó la respuesta. Revisa los permisos y el plazo de la conversación antes de editar el mensaje y volver a intentarlo.";
    default: return "No se pudo completar la acción. Vuelve a actualizar; si continúa, avisa a administración.";
  }
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function instagramLink(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "instagram.com" || url.hostname.endsWith(".instagram.com")) ? url.href : null;
  } catch { return null; }
}

function mergeThreads(current: InstagramThread[], incoming: InstagramThread[]) {
  const entries = new Map(current.map(thread => [thread.id, thread]));
  incoming.forEach(thread => entries.set(thread.id, thread));
  return [...entries.values()];
}

export default function CentralInstagramPanel() {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [kind, setKind] = useState<Kind>("message");
  const [connection, setConnection] = useState<InstagramConnection | null>(null);
  const [threads, setThreads] = useState<InstagramThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [partialHint, setPartialHint] = useState<string | null>(null);
  const [selected, setSelected] = useState<InstagramThread | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyMode, setReplyMode] = useState<"public" | "private">("private");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Record<string, boolean>>({});
  const [checkedPending, setCheckedPending] = useState(false);
  const mounted = useRef(false);
  const currentKind = useRef(kind);
  const selectedId = useRef<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const sendLock = useRef(false);
  const attempts = useRef<Record<string, { text: string; requestId: string; expectedLastReplyAt: string | null; replyMode: "public" | "private" }>>({});
  const composer = useRef<HTMLTextAreaElement>(null);
  currentKind.current = kind;
  selectedId.current = selected?.id ?? null;
  const draft = selected ? drafts[selected.id] || "" : "";
  const currentDetail = detail?.threadId === selected?.id ? detail : null;
  const blockedByUncertainty = Boolean(selected && uncertain[selected.id]);
  const privateComment = selected?.kind === "comment" && replyMode === "private";
  const publicComment = selected?.kind === "comment" && replyMode === "public";
  const canReply = Boolean((privateComment ? currentDetail?.canPrivateReply : currentDetail?.canReply) && !blockedByUncertainty);
  const canPrepareTemplate = Boolean((selected?.kind === "comment" ? currentDetail?.canPrivateReply : currentDetail?.canReply) && !blockedByUncertainty);
  const pendingSend = currentDetail?.pendingSend;
  const canResolvePending = Boolean(pendingSend && Date.now() - Date.parse(pendingSend.createdAt) >= 60_000);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setCheckedPending(false); }, [pendingSend?.requestId]);

  const api = useCallback(async <T,>(params: URLSearchParams, init: RequestPayload = {}): Promise<T> => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("NO_AUTH");
    const response = await fetch(`/api/central/instagram?${params}`, {
      method: init.method || "GET", cache: "no-store", signal: init.signal,
      headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await response.json().catch(() => null);
    if (!json && init.method === "POST") throw new Error("SEND_UNCERTAIN");
    if (!response.ok || !json?.ok) throw new Error(json?.code || json?.error || `HTTP_${response.status}`);
    return json as T;
  }, [sb]);

  const loadInbox = useCallback(async (requestedKind: Kind, next?: string | null, quiet = false, signal?: AbortSignal) => {
    const request = ++listRequest.current;
    if (next) setLoadingMore(true); else if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ action: "inbox", kind: requestedKind });
      if (next) params.set("cursor", next);
      const result = await api<InstagramInboxResult>(params, { signal });
      if (!mounted.current || currentKind.current !== requestedKind || request !== listRequest.current) return;
      setConnection(result.connection);
      setThreads(previous => next ? mergeThreads(previous, result.threads) : result.threads);
      setCursor(result.nextCursor || null);
      setPartialHint(result.partialHint || null);
      if (!quiet) setError(null);
    } catch (cause) {
      if (!signal?.aborted && mounted.current && currentKind.current === requestedKind && request === listRequest.current) {
        setError(errorCopy(cause));
        setConnection(previous => ({ username: previous?.username || "tarotcelestialof", connected: previous?.connected || false, ready: false, message: errorCopy(cause) }));
      }
    } finally {
      if (mounted.current && request === listRequest.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [api]);

  const loadDetail = useCallback(async (threadId: string, quiet = false, signal?: AbortSignal) => {
    const request = ++detailRequest.current;
    if (!quiet) setDetailLoading(true);
    try {
      const attempt = attempts.current[threadId];
      const params = new URLSearchParams({ action: "messages", threadId });
      if (attempt) params.set("requestId", attempt.requestId);
      const result = await api<InstagramMessagesResult>(params, { signal });
      if (!mounted.current || selectedId.current !== threadId || request !== detailRequest.current) return;
      setDetail({ ...result, threadId });
      if (attempt && attempts.current[threadId]?.requestId === attempt.requestId && !result.pendingSend) {
        const confirmed = result.requestStatus === "sent" || result.requestStatus === "confirmed_sent";
        const canTryAgain = ["failed", "not_found", "confirmed_not_sent"].includes(result.requestStatus || "");
        if (confirmed || canTryAgain) {
          delete attempts.current[threadId];
          setUncertain(previous => ({ ...previous, [threadId]: false }));
          if (confirmed) {
            setDrafts(previous => previous[threadId]?.trim() === attempt.text ? { ...previous, [threadId]: "" } : previous);
            setError(null); setNotice("Envío comprobado: la respuesta ya se envió.");
          } else setNotice("No hay un envío confirmado de este intento. Revisa el borrador antes de volver a enviarlo.");
        }
      }
    } catch (cause) {
      if (!signal?.aborted && mounted.current && selectedId.current === threadId && request === detailRequest.current) {
        setError(errorCopy(cause));
        setDetail(previous => previous?.threadId === threadId ? { ...previous, canReply: false, canPrivateReply: false } : previous);
      }
    } finally {
      if (mounted.current && request === detailRequest.current) setDetailLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    void loadInbox(kind, null, false, controller.signal);
    const refresh = () => { if (!document.hidden && !sendLock.current) void loadInbox(kind, null, true, controller.signal); };
    const interval = window.setInterval(refresh, kind === "comment" ? 300_000 : 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [kind, loadInbox]);

  useEffect(() => {
    if (!selected?.id) return;
    const controller = new AbortController();
    const threadId = selected.id;
    void loadDetail(threadId, false, controller.signal);
    const refresh = () => { if (!document.hidden && !sendLock.current) void loadDetail(threadId, true, controller.signal); };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [selected?.id, loadDetail]);

  const selectThread = (thread: InstagramThread) => {
    if (sendLock.current) return;
    if (selectedId.current === thread.id) { void loadDetail(thread.id); return; }
    setSelected(thread); setDetail(null); setNotice(null); setError(null); setCheckedPending(false); setReplyMode(thread.kind === "comment" ? "public" : "private");
  };
  const updateDraft = (text: string) => {
    if (selected) setDrafts(previous => ({ ...previous, [selected.id]: text }));
    setNotice(null);
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !currentDetail || !canReply || !draft.trim() || sendLock.current) return;
    const threadId = selected.id;
    const text = draft.trim();
    const previous = attempts.current[threadId];
    const attempt = previous?.text === text && previous.replyMode === replyMode ? previous : { text, requestId: crypto.randomUUID(), expectedLastReplyAt: currentDetail.lastReplyAt, replyMode };
    attempts.current[threadId] = attempt;
    sendLock.current = true;
    setSending(true); setError(null); setNotice(null);
    try {
      await api(new URLSearchParams({ action: "send" }), { method: "POST", body: { threadId, ...attempt } });
      if (!mounted.current) return;
      delete attempts.current[threadId];
      setDrafts(previousDrafts => ({ ...previousDrafts, [threadId]: "" }));
      setNotice(publicComment ? "Respuesta publicada en el comentario." : "Mensaje privado enviado a Instagram.");
      await Promise.all([loadDetail(threadId, true), loadInbox(currentKind.current, null, true)]);
    } catch (cause) {
      if (!mounted.current) return;
      const code = cause instanceof Error ? cause.message : "";
      // A lost network response may follow a successful delivery. Keep the same
      // operation ID and block a new send until a human checks the conversation.
      if (["SEND_UNCERTAIN", "SEND_IN_PROGRESS", "SEND_PENDING", "SERVICE_UNAVAILABLE"].includes(code) || cause instanceof TypeError || code.startsWith("HTTP_5")) {
        setUncertain(previousUncertain => ({ ...previousUncertain, [threadId]: true }));
        setError(errorCopy(new Error("SEND_UNCERTAIN")));
      } else {
        setError(errorCopy(cause));
        if (["STALE_CONVERSATION", "REPLY_CONFLICT", "STALE_REPLY", "META_RATE_LIMIT", "META_PERMISSION", "TOKEN_EXPIRED", "META_REJECTED"].includes(code)) delete attempts.current[threadId];
      }
      await loadDetail(threadId, true);
    } finally {
      sendLock.current = false;
      if (mounted.current) setSending(false);
    }
  }

  async function resolvePending(outcome: "sent" | "not_sent") {
    if (!selected || !pendingSend || !checkedPending || !canResolvePending || sendLock.current) return;
    const threadId = selected.id;
    sendLock.current = true; setSending(true); setError(null);
    try {
      await api(new URLSearchParams({ action: "resolve" }), { method: "POST", body: { threadId, requestId: pendingSend.requestId, outcome, confirmed: true } });
      if (!mounted.current) return;
      delete attempts.current[threadId];
      setUncertain(previous => ({ ...previous, [threadId]: false }));
      setCheckedPending(false);
      if (outcome === "sent") setDrafts(previous => previous[threadId]?.trim() === pendingSend.text ? { ...previous, [threadId]: "" } : previous);
      setNotice(outcome === "sent" ? "Comprobación guardada: el mensaje se envió." : "Comprobación guardada: no se envió. Puedes revisar el borrador antes de enviarlo.");
      await loadDetail(threadId, true);
    } catch (cause) {
      if (mounted.current) setError(errorCopy(cause));
    } finally {
      sendLock.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const filtered = threads.filter(thread => `${thread.name} ${thread.username || ""} ${thread.preview}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const selectedLink = instagramLink(selected?.permalink);
  const comments = kind === "comment";

  return <section className={styles.wrap} aria-labelledby="central-instagram-title">
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}><Instagram size={16} aria-hidden="true" /> CONVERSACIONES QUE CONECTAN</span><h2 id="central-instagram-title">Instagram</h2><p><a href="https://www.instagram.com/tarotcelestialof/" target="_blank" rel="noopener noreferrer">@tarotcelestialof <ExternalLink size={12} aria-hidden="true" /></a> · Mensajes y comentarios, en un mismo lugar.</p></div>
      <div className={styles.toolbar}><span className={`${styles.badge} ${connection?.ready ? styles.ready : ""}`}><i aria-hidden="true" />{connection?.ready ? "Cuenta disponible" : loading ? "Comprobando conexión" : "Conexión por revisar"}</span><button className={styles.ghostButton} type="button" disabled={loading || loadingMore || sending} onClick={() => { void loadInbox(kind); if (selected) void loadDetail(selected.id); }}><RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" /> Actualizar</button></div>
    </header>

    {error ? <div className={styles.error} role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{error}</span></div> : null}
    {connection && !connection.ready ? <div className={styles.setup} role="status"><strong>Necesitamos revisar la conexión de Instagram</strong><p>{connection.message || "Administración debe comprobar la conexión y los permisos de esta cuenta. La bandeja mostrará aquí los mensajes y comentarios que Instagram permita consultar."}</p></div> : null}
    {connection?.ready && connection.message ? <p className={styles.hint}>{connection.message}</p> : null}

    <div className={`${styles.inbox} ${selected ? styles.hasSelection : ""}`}>
      <div className={styles.threadList}>
        <div className={styles.tabs} role="group" aria-label="Tipo de conversación">
          {([['message', 'Mensajes', MessagesSquare], ['comment', 'Comentarios', MessageCircle]] as const).map(([value, label, Icon]) => <button key={value} type="button" aria-pressed={kind === value} disabled={sending} className={kind === value ? styles.activeTab : ""} onClick={() => { if (kind === value) return; setKind(value); setThreads([]); setSelected(null); setDetail(null); setCursor(null); setQuery(""); setNotice(null); }}><Icon size={16} aria-hidden="true" />{label}</button>)}
        </div>
        <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label={`Buscar ${comments ? "comentarios" : "mensajes"}`} placeholder="Buscar en la bandeja…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className={styles.listBody} aria-busy={loading}>
          {loading && !threads.length ? <p className={styles.empty} role="status">Consultando Instagram…</p> : null}
          {!loading && !filtered.length ? <div className={styles.empty}><Instagram size={26} aria-hidden="true" /><strong>{query ? "No hay coincidencias" : comments ? "Sin comentarios disponibles" : "Sin mensajes disponibles"}</strong><p>{query ? "Prueba otro nombre o texto." : connection?.ready ? "Actualiza para consultar nuevas conversaciones de la cuenta." : "Los contactos aparecerán cuando Instagram permita consultar la bandeja."}</p></div> : null}
          <ul>{filtered.map(thread => <li key={thread.id}><button className={`${styles.thread} ${selected?.id === thread.id ? styles.activeThread : ""}`} aria-pressed={selected?.id === thread.id} disabled={sending} type="button" onClick={() => selectThread(thread)}><span className={styles.avatar} aria-hidden="true">{(thread.name || thread.username || "IG").slice(0, 2).toUpperCase()}</span><span className={styles.threadCopy}><span className={styles.threadTitle}><strong>{thread.name || thread.username || "Contacto de Instagram"}</strong><time dateTime={thread.updatedAt}>{timeLabel(thread.updatedAt)}</time></span><span className={styles.preview}>{thread.preview || (comments ? "Comentario en una publicación" : "Abrir conversación")}</span></span></button></li>)}</ul>
          {cursor ? <button type="button" className={styles.loadMore} disabled={loadingMore || loading || sending} onClick={() => void loadInbox(kind, cursor)}>{loadingMore ? "Cargando…" : "Cargar anteriores"}</button> : null}
          {partialHint ? <p className={styles.partial}>{partialHint}</p> : null}
        </div>
      </div>

      <div className={styles.conversation}>
        {!selected ? <div className={styles.placeholder}><span className={styles.placeholderIcon}><Instagram size={36} strokeWidth={1.4} aria-hidden="true" /></span><h3>Cada conversación, una oportunidad</h3><p>Abre un mensaje o comentario, conoce desde dónde nos escriben y prepara la respuesta que necesiten.</p><div><span>1 · Panel y Oráculo</span><span>2 · Primera consulta gratis</span></div></div> : <>
          <header className={styles.conversationHeader}><button type="button" className={styles.backButton} disabled={sending} aria-label="Volver a la bandeja" onClick={() => setSelected(null)}><ArrowLeft size={18} /></button><div><strong>{selected.name || selected.username || "Contacto de Instagram"}</strong><span>{selected.kind === "comment" ? "Comentario en una publicación" : "Mensaje privado"}{selected.username ? ` · @${selected.username.replace(/^@/, "")}` : ""}</span></div>{selectedLink ? <a href={selectedLink} target="_blank" rel="noopener noreferrer" aria-label="Abrir publicación en Instagram"><ExternalLink size={18} /></a> : null}</header>
          <div className={styles.messages} aria-busy={detailLoading} aria-label={selected.kind === "comment" ? "Comentario y respuestas" : "Mensajes de la conversación"}>
            {detailLoading && !currentDetail ? <p className={styles.empty} role="status">Abriendo conversación…</p> : null}
            {currentDetail?.messages.map(message => <article key={message.id} className={`${styles.bubble} ${message.fromMe ? styles.ours : styles.theirs}`}>{message.senderName ? <strong>{message.senderName}</strong> : null}<p>{message.text || "Contenido multimedia. Ábrelo en Instagram para consultarlo."}</p><time dateTime={message.createdAt}>{message.fromMe ? "Equipo · " : ""}{timeLabel(message.createdAt)}</time></article>)}
            {currentDetail && !currentDetail.messages.length ? <p className={styles.empty}>Instagram no ha devuelto contenido para esta conversación.</p> : null}
          </div>
          <form className={styles.composer} onSubmit={send}>
            {pendingSend ? <div className={styles.pendingReview}><strong>Comprueba el envío pendiente</strong><p>Abre Instagram y comprueba si esta respuesta se envió antes de elegir. Esto guarda el resultado; no envía otro mensaje.</p><blockquote>{pendingSend.text}</blockquote><div><a href="https://www.instagram.com/direct/inbox/" target="_blank" rel="noopener noreferrer">Abrir mensajes privados <ExternalLink size={12} aria-hidden="true" /></a>{selectedLink ? <a href={selectedLink} target="_blank" rel="noopener noreferrer">Ver publicación <ExternalLink size={12} aria-hidden="true" /></a> : null}</div>{!canResolvePending ? <p>Espera un minuto desde el intento para dar tiempo a confirmar el resultado.</p> : null}<label><input type="checkbox" checked={checkedPending} disabled={sending || !canResolvePending} onChange={event => setCheckedPending(event.target.checked)} />He comprobado la conversación en Instagram.</label><div><button type="button" disabled={sending || !checkedPending || !canResolvePending} onClick={() => void resolvePending("sent")}>Sí, se envió</button><button type="button" disabled={sending || !checkedPending || !canResolvePending} onClick={() => void resolvePending("not_sent")}>No se envió</button></div></div> : null}
            <div className={styles.templateLabel}><Sparkles size={14} aria-hidden="true" /><span>Prepara una respuesta</span><small>Puedes editarla antes de enviar.</small></div>
            <div className={styles.templates}>{INSTAGRAM_REPLY_TEMPLATES.map(template => <button key={template.id} type="button" disabled={sending || !canPrepareTemplate} title={template.description} onClick={() => { setReplyMode("private"); updateDraft(template.text); composer.current?.focus(); }}><strong>{template.title}</strong><span>{template.description}</span></button>)}</div>
            {selected.kind === "comment" ? <div className={styles.replyModes} role="group" aria-label="Dónde enviar la respuesta"><button type="button" disabled={sending} aria-pressed={replyMode === "public"} onClick={() => setReplyMode("public")}>Respuesta pública</button><button type="button" disabled={sending || !currentDetail?.canPrivateReply} aria-pressed={replyMode === "private"} onClick={() => setReplyMode("private")}>Mensaje privado</button></div> : null}
            {publicComment ? <p className={styles.replyHint}>Esta respuesta será visible para todos. Las opciones de arriba preparan un mensaje privado con enlaces.</p> : null}
            {privateComment ? <p className={styles.replyHint}>Enviarás un mensaje privado a quien comentó. Solo se permite uno por comentario; espera su respuesta para continuar la conversación.</p> : null}
            {(privateComment ? currentDetail?.privateReplyHint : currentDetail?.replyHint) ? <p className={styles.replyHint}>{privateComment ? currentDetail?.privateReplyHint : currentDetail?.replyHint}</p> : null}
            {selected.kind === "comment" && currentDetail?.privateReplySent ? <p className={styles.replyHint}>Ya se envió un mensaje privado para este comentario.</p> : null}
            {blockedByUncertainty ? <p className={styles.replyHint}>Envío pendiente de comprobar. Revisa el resultado en Instagram; este panel no repetirá el mensaje automáticamente.</p> : null}
            {notice ? <p className={styles.success} role="status">{notice}</p> : null}
            <label className={styles.replyLabel} htmlFor="instagram-reply">{publicComment ? "Respuesta pública al comentario" : "Tu mensaje privado"}</label>
            <textarea id="instagram-reply" ref={composer} maxLength={1000} rows={4} value={draft} disabled={sending || !canReply} onChange={event => updateDraft(event.target.value)} placeholder={canReply ? "Escribe tu respuesta o elige una de las opciones…" : "La respuesta se habilita al comprobar los permisos y el plazo de esta conversación."} />
            <div className={styles.sendRow}><small>{draft.length}/1000 · {publicComment ? "Visible en la publicación" : "Mensaje privado"}</small><button className={styles.sendButton} type="submit" disabled={sending || !canReply || !draft.trim()}><Send size={16} aria-hidden="true" />{sending ? "Enviando…" : publicComment ? "Publicar respuesta" : "Enviar mensaje privado"}</button></div>
          </form>
        </>}
      </div>
    </div>
  </section>;
}
