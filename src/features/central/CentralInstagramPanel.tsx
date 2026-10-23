"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ExternalLink, Facebook, Instagram, MessageCircle, MessagesSquare, RefreshCw, Search, Send, Sparkles, TriangleAlert } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { INSTAGRAM_REPLY_TEMPLATES, type InstagramConnection, type InstagramInboxResult, type InstagramMessagesResult, type InstagramThread } from "@/lib/instagram-inbox";
import { SOCIAL_ATTENTION_REFRESH, SOCIAL_INBOX_INVALIDATE, type SocialProvider, type SocialProviderAttention } from "@/lib/social-attention";
import styles from "./CentralInstagramPanel.module.css";

type Kind = InstagramThread["kind"];
type DetailResult = InstagramMessagesResult & { observedAt?: string };
type ThreadDetail = DetailResult & { threadId: string };
type RequestPayload = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal };
type RequestContext = "inbox" | "messages" | "send" | "resolve" | "read";

class InstagramRequestError extends Error {
  constructor(code: string, readonly publicMessage: string | null) { super(code); }
}

function errorCopy(error: unknown, context: RequestContext) {
  const code = error instanceof Error ? error.message : "";
  const publicMessage = error instanceof InstagramRequestError ? error.publicMessage : null;
  const fallback = context === "inbox" ? "No se pudo cargar la bandeja de Instagram. Actualiza; si continúa, avisa a administración."
    : context === "messages" ? "No se pudo cargar esta conversación. Actualiza; si continúa, avisa a administración."
    : context === "read" ? "No se pudo guardar la revisión. El contenido sigue pendiente; vuelve a intentarlo."
    : context === "resolve" ? "No se pudo guardar la comprobación del envío. Actualiza y vuelve a intentarlo."
    : "No se pudo enviar la respuesta. Actualiza la conversación antes de volver a intentarlo.";
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
    case "META_REJECTED": return publicMessage || fallback;
    default: return publicMessage || fallback;
  }
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function socialLink(value: string | null | undefined, provider: SocialProvider) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const domain = `${provider}.com`;
    return url.protocol === "https:" && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}

function mergeThreads(current: InstagramThread[], incoming: InstagramThread[]) {
  const entries = new Map(current.map(thread => [thread.id, thread]));
  incoming.forEach(thread => entries.set(thread.id, thread));
  return [...entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

type Props = { provider?: SocialProvider; attention?: SocialProviderAttention };

export default function CentralInstagramPanel({ provider = "instagram", attention }: Props = {}) {
  return <SocialInbox key={`${provider}:${attention?.accountId || ''}`} provider={provider} attention={attention} />;
}

function SocialInbox({ provider = "instagram", attention }: Props) {
  const network = provider === "facebook" ? "Facebook" : "Instagram";
  const NetworkIcon = provider === "facebook" ? Facebook : Instagram;
  const accountLabel = provider === "facebook" ? "Tarot Celestial" : "@tarotcelestialof";
  const accountUrl = provider === "facebook" ? "https://www.facebook.com/112980835232394" : "https://www.instagram.com/tarotcelestialof/";
  const inboxUrl = provider === "facebook" ? "https://business.facebook.com/latest/inbox/all?asset_id=112980835232394" : "https://www.instagram.com/direct/inbox/";
  const copy = useCallback((cause: unknown, context: RequestContext) => errorCopy(cause, context).replaceAll("Instagram", network).replaceAll("@tarotcelestialof", accountLabel), [network, accountLabel]);
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
  const [detailError, setDetailError] = useState<{ threadId: string; message: string } | null>(null);
  const [readError, setReadError] = useState<{ threadId: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [replyMode, setReplyMode] = useState<"public" | "private">("private");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Record<string, boolean>>({});
  const [checkedPending, setCheckedPending] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const mounted = useRef(false);
  const currentKind = useRef(kind);
  const selectedId = useRef<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const sendLock = useRef(false);
  const loadedOlder = useRef(false);
  const threadsRef = useRef(threads); threadsRef.current = threads;
  const reading = useRef(new Set<string>());
  const acknowledged = useRef<Record<string, string>>({});
  const inboxLoading = useRef(false);
  const detailLoadingRef = useRef(false);
  const inboxFailures = useRef(0);
  const detailFailures = useRef(0);
  const inboxNextAttempt = useRef(0);
  const detailNextAttempt = useRef(0);
  const authOwner = useRef<string | null | undefined>(undefined);
  const authEpoch = useRef(0);
  const inboxController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const attempts = useRef<Record<string, { text: string; requestId: string; expectedLastReplyAt: string | null; replyMode: "public" | "private" }>>({});
  const composer = useRef<HTMLTextAreaElement>(null);
  currentKind.current = kind;
  selectedId.current = selected?.id ?? null;
  const draft = selected ? drafts[selected.id] || "" : "";
  const currentDetail = detail?.threadId === selected?.id ? detail : null;
  const currentDetailError = detailError && detailError.threadId === selected?.id ? detailError.message : null;
  const blockedByUncertainty = Boolean(selected && uncertain[selected.id]);
  const privateComment = selected?.kind === "comment" && replyMode === "private";
  const publicComment = selected?.kind === "comment" && replyMode === "public";
  const canReply = Boolean((privateComment ? currentDetail?.canPrivateReply : currentDetail?.canReply) && !blockedByUncertainty && !currentDetailError);
  const canPrepareTemplate = Boolean((selected?.kind === "comment" ? currentDetail?.canPrivateReply : currentDetail?.canReply) && !blockedByUncertainty && !currentDetailError);
  const pendingSend = currentDetail?.pendingSend;
  const canResolvePending = Boolean(pendingSend && Date.now() - Date.parse(pendingSend.createdAt) >= 60_000);
  const replyHint = privateComment ? currentDetail?.privateReplyHint : currentDetail?.replyHint;
  const disabledReplyReason = currentDetailError || (blockedByUncertainty || pendingSend
    ? "Hay un envío pendiente de comprobar. Revisa su resultado en la red social antes de responder."
    : detailLoading ? "Cargando la conversación…"
    : replyHint || "La respuesta no está disponible. Pulsa «Actualizar» para comprobar esta conversación.");
  const currentReadError = readError && readError.threadId === selected?.id ? readError.message : null;
  const visibleError = currentDetailError || currentReadError || error;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; inboxController.current?.abort(); detailController.current?.abort(); }; }, []);
  useEffect(() => { setCheckedPending(false); }, [pendingSend?.requestId]);
  useEffect(() => {
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      const owner = session?.user.id || null;
      const changed = authOwner.current !== undefined && authOwner.current !== owner;
      authOwner.current = owner;
      if (!owner || changed) {
        authEpoch.current++; inboxController.current?.abort(); detailController.current?.abort();
        ++listRequest.current; ++detailRequest.current;
        selectedId.current = null; loadedOlder.current = false; attempts.current = {};
        threadsRef.current = []; sendLock.current = false;
        inboxLoading.current = false; detailLoadingRef.current = false;
        reading.current.clear(); acknowledged.current = {};
        setThreads([]); setSelected(null); setDetail(null); setCursor(null); setConnection(null);
        setDrafts({}); setUncertain({}); setQuery(""); setPartialHint(null); setNotice(null);
        setError(null); setDetailError(null); setReadError(null); setLoading(false); setLoadingMore(false); setDetailLoading(false); setSending(false);
      }
      if (changed && owner) setAuthRevision(previous => previous + 1);
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const api = useCallback(async <T,>(params: URLSearchParams, init: RequestPayload = {}): Promise<T> => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("NO_AUTH");
    if (authOwner.current === undefined) authOwner.current = data.session?.user.id || null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    // Sending remains bounded by the server's audited operation; only reads are timed out here.
    const timer = init.method !== "POST" || params.get("action") === "read" ? window.setTimeout(abort, 25_000) : null;
    try {
      const response = await fetch(`/api/central/${provider}?${params}`, {
        method: init.method || "GET", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const json = await response.json().catch(() => null);
      if (!json && init.method === "POST") throw new Error(params.get("action") === "read" ? "READ_UNAVAILABLE" : "SEND_UNCERTAIN");
      if (!response.ok || !json?.ok) throw new InstagramRequestError(json?.code || `HTTP_${response.status}`, typeof json?.error === "string" ? json.error : null);
      return json as T;
    } finally {
      if (timer !== null) window.clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }, [sb, provider]);

  const loadInbox = useCallback(async (requestedKind: Kind, next?: string | null, quiet = false, signal?: AbortSignal) => {
    if (quiet && (inboxLoading.current || Date.now() < inboxNextAttempt.current)) return;
    inboxController.current?.abort();
    const controller = new AbortController(); inboxController.current = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const request = ++listRequest.current;
    inboxLoading.current = true;
    if (next) setLoadingMore(true); else if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ action: "inbox", kind: requestedKind });
      if (next) params.set("cursor", next);
      const result = await api<InstagramInboxResult>(params, { signal: controller.signal });
      if (!mounted.current || currentKind.current !== requestedKind || request !== listRequest.current) return;
      setConnection(result.connection);
      const nextThreads = mergeThreads(threadsRef.current, result.threads);
      threadsRef.current = nextThreads; setThreads(nextThreads);
      if (next || !loadedOlder.current) setCursor(result.nextCursor || null);
      if (next) loadedOlder.current = true;
      setPartialHint(result.partialHint || null);
      inboxFailures.current = 0; inboxNextAttempt.current = 0;
      if (!quiet) setError(null);
    } catch (cause) {
      if (!signal?.aborted && mounted.current && currentKind.current === requestedKind && request === listRequest.current) {
        inboxFailures.current++;
        inboxNextAttempt.current = Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(inboxFailures.current, 3));
        setError(copy(cause, "inbox"));
        setConnection(previous => ({ username: previous?.username || accountLabel, connected: previous?.connected || false, ready: false, message: copy(cause, "inbox") }));
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (request === listRequest.current) inboxLoading.current = false;
      if (mounted.current && request === listRequest.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [api, copy, accountLabel]);

  const markReviewed = useCallback(async (threadId: string, through: string | undefined, messages: InstagramMessagesResult["messages"]) => {
    if (!through || !Number.isFinite(Date.parse(through)) || !messages.length || document.hidden || !mounted.current || selectedId.current !== threadId
      || reading.current.has(threadId) || acknowledged.current[threadId] === through || !(threadsRef.current.find(thread => thread.id === threadId)?.unread)) return;
    reading.current.add(threadId);
    const epoch = authEpoch.current;
    try {
      const receipt = await api<{ ok: true; unread?: number }>(new URLSearchParams({ action: "read" }), { method: "POST", body: { threadId, through } });
      if (!mounted.current || epoch !== authEpoch.current) return;
      acknowledged.current[threadId] = through;
      if (selectedId.current === threadId) setReadError(null);
      if (Number.isSafeInteger(receipt.unread) && Number(receipt.unread) >= 0) {
        const next = threadsRef.current.map(thread => thread.id === threadId ? { ...thread, unread: receipt.unread } : thread);
        threadsRef.current = next; setThreads(next);
      }
      window.dispatchEvent(new CustomEvent(SOCIAL_ATTENTION_REFRESH, { detail: { provider } }));
      // Only a server response clears a pending badge. Newer arrivals remain unread.
      if (receipt.unread === undefined) await loadInbox(currentKind.current, null, true);
    } catch (cause) {
      if (mounted.current && epoch === authEpoch.current && selectedId.current === threadId) setReadError({ threadId, message: copy(cause, "read") });
    } finally { if (epoch === authEpoch.current) reading.current.delete(threadId); }
  }, [api, loadInbox, provider, copy]);

  const loadDetail = useCallback(async (threadId: string, quiet = false, signal?: AbortSignal) => {
    if (quiet && (detailLoadingRef.current || Date.now() < detailNextAttempt.current)) return;
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const request = ++detailRequest.current;
    detailLoadingRef.current = true;
    if (!quiet) setDetailLoading(true);
    try {
      const attempt = attempts.current[threadId];
      const params = new URLSearchParams({ action: "messages", threadId });
      if (attempt) params.set("requestId", attempt.requestId);
      const result = await api<DetailResult>(params, { signal: controller.signal });
      if (!mounted.current || selectedId.current !== threadId || request !== detailRequest.current) return;
      setDetail({ ...result, threadId });
      setDetailError(null);
      detailFailures.current = 0; detailNextAttempt.current = 0;
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
        detailFailures.current++;
        detailNextAttempt.current = Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(detailFailures.current, 3));
        setDetailError({ threadId, message: copy(cause, "messages") });
        setDetail(previous => previous?.threadId === threadId ? { ...previous, canReply: false, canPrivateReply: false } : previous);
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (request === detailRequest.current) detailLoadingRef.current = false;
      if (mounted.current && request === detailRequest.current) setDetailLoading(false);
    }
  }, [api, copy]);

  useEffect(() => {
    if (detail && detail.threadId === selected?.id) void markReviewed(detail.threadId, detail.observedAt, detail.messages);
  }, [detail, selected?.id, markReviewed]);

  useEffect(() => {
    const controller = new AbortController();
    void loadInbox(kind, null, false, controller.signal);
    const refresh = () => {
      if (document.hidden || sendLock.current) return;
      void loadInbox(kind, null, true, controller.signal).then(() => {
        if (selectedId.current && !controller.signal.aborted && !document.hidden && !sendLock.current) void loadDetail(selectedId.current, true, controller.signal);
      });
    };
    let debounce: number | undefined;
    const invalidated = (event: Event) => {
      if ((event as CustomEvent<{ provider?: SocialProvider }>).detail?.provider !== provider) return;
      window.clearTimeout(debounce); debounce = window.setTimeout(refresh, 500);
    };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    window.addEventListener(SOCIAL_INBOX_INVALIDATE, invalidated);
    return () => { controller.abort(); window.clearInterval(interval); window.clearTimeout(debounce); document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); window.removeEventListener(SOCIAL_INBOX_INVALIDATE, invalidated); };
  }, [kind, loadInbox, loadDetail, authRevision, provider]);

  useEffect(() => {
    if (!selected?.id) return;
    const controller = new AbortController();
    const threadId = selected.id;
    void loadDetail(threadId, false, controller.signal);
    return () => controller.abort();
  }, [selected?.id, loadDetail]);

  const selectThread = (thread: InstagramThread) => {
    if (sendLock.current) return;
    if (selectedId.current === thread.id) { void loadDetail(thread.id); return; }
    setSelected(thread); setDetail(null); setDetailError(null); setReadError(null); setNotice(null); setError(null); setCheckedPending(false); setReplyMode(thread.kind === "comment" ? "public" : "private");
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
    const epoch = authEpoch.current;
    sendLock.current = true;
    setSending(true); setError(null); setNotice(null);
    try {
      await api(new URLSearchParams({ action: "send" }), { method: "POST", body: { threadId, ...attempt } });
      if (!mounted.current || epoch !== authEpoch.current) return;
      delete attempts.current[threadId];
      setDrafts(previousDrafts => ({ ...previousDrafts, [threadId]: "" }));
      setNotice(publicComment ? "Respuesta publicada en el comentario." : `Mensaje privado enviado a ${network}.`);
      window.dispatchEvent(new CustomEvent(SOCIAL_ATTENTION_REFRESH, { detail: { provider } }));
      await Promise.all([loadDetail(threadId, true), loadInbox(currentKind.current, null, true)]);
    } catch (cause) {
      if (!mounted.current || epoch !== authEpoch.current) return;
      const code = cause instanceof Error ? cause.message : "";
      // A lost network response may follow a successful delivery. Keep the same
      // operation ID and block a new send until a human checks the conversation.
      if (["SEND_UNCERTAIN", "SEND_IN_PROGRESS", "SEND_PENDING", "SERVICE_UNAVAILABLE"].includes(code) || cause instanceof TypeError || code.startsWith("HTTP_5")) {
        setUncertain(previousUncertain => ({ ...previousUncertain, [threadId]: true }));
        setError(copy(new Error("SEND_UNCERTAIN"), "send"));
      } else {
        setError(copy(cause, "send"));
        if (["STALE_CONVERSATION", "REPLY_CONFLICT", "STALE_REPLY", "META_RATE_LIMIT", "META_PERMISSION", "TOKEN_EXPIRED", "META_REJECTED"].includes(code)) delete attempts.current[threadId];
      }
      await loadDetail(threadId, true);
    } finally {
      if (epoch === authEpoch.current) {
        sendLock.current = false;
        if (mounted.current) setSending(false);
      }
    }
  }

  async function resolvePending(outcome: "sent" | "not_sent") {
    if (!selected || !pendingSend || !checkedPending || !canResolvePending || sendLock.current) return;
    const threadId = selected.id;
    const epoch = authEpoch.current;
    sendLock.current = true; setSending(true); setError(null);
    try {
      await api(new URLSearchParams({ action: "resolve" }), { method: "POST", body: { threadId, requestId: pendingSend.requestId, outcome, confirmed: true } });
      if (!mounted.current || epoch !== authEpoch.current) return;
      delete attempts.current[threadId];
      setUncertain(previous => ({ ...previous, [threadId]: false }));
      setCheckedPending(false);
      if (outcome === "sent") setDrafts(previous => previous[threadId]?.trim() === pendingSend.text ? { ...previous, [threadId]: "" } : previous);
      setNotice(outcome === "sent" ? "Comprobación guardada: el mensaje se envió." : "Comprobación guardada: no se envió. Puedes revisar el borrador antes de enviarlo.");
      window.dispatchEvent(new CustomEvent(SOCIAL_ATTENTION_REFRESH, { detail: { provider } }));
      await loadDetail(threadId, true);
    } catch (cause) {
      if (mounted.current && epoch === authEpoch.current) setError(copy(cause, "resolve"));
    } finally {
      if (epoch === authEpoch.current) {
        sendLock.current = false;
        if (mounted.current) setSending(false);
      }
    }
  }

  const normalizedQuery = query.trim().replace(/^@/, "").toLocaleLowerCase("es");
  const filtered = threads.filter(thread => `${thread.name} ${thread.username || ""} ${thread.preview}`.toLocaleLowerCase("es").includes(normalizedQuery));
  const selectedLink = socialLink(selected?.permalink, provider);
  const comments = kind === "comment";

  return <section className={`${styles.wrap} ${provider === 'facebook' ? styles.facebook : ''}`} aria-labelledby={`central-${provider}-title`}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}><NetworkIcon size={16} aria-hidden="true" /> CONVERSACIONES QUE CONECTAN</span><h2 id={`central-${provider}-title`}>{network}</h2><p><a href={accountUrl} target="_blank" rel="noopener noreferrer">{accountLabel} <ExternalLink size={12} aria-hidden="true" /></a> · Mensajes y comentarios, en un mismo lugar.</p></div>
      <div className={styles.toolbar}><span className={`${styles.badge} ${connection?.ready ? styles.ready : ""}`}><i aria-hidden="true" />{connection?.ready ? "Cuenta disponible" : loading ? "Comprobando conexión" : "Conexión por revisar"}</span><button className={styles.ghostButton} type="button" disabled={loading || loadingMore || sending} onClick={() => { void loadInbox(kind); if (selected) void loadDetail(selected.id); }}><RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" /> Actualizar</button></div>
    </header>

    {attention ? <div className={styles.pendingSummary} role="status"><strong>{attention.error ? 'Recuento pendiente de actualizar' : `${attention.count} pendientes de revisar`}</strong><span>{attention.messages} mensajes · {attention.comments} comentarios</span><small>La revisión se comparte entre las centrales.</small></div> : null}
    {visibleError ? <div className={styles.error} role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{visibleError}</span>{currentReadError && selected ? <button type="button" className={styles.ghostButton} onClick={() => void loadDetail(selected.id)} disabled={detailLoading || sending}>Reintentar revisión</button> : null}</div> : null}
    {connection && !connection.ready ? <div className={styles.setup} role="status"><strong>Necesitamos revisar la conexión de {network}</strong><p>{connection.message || `Administración debe comprobar la conexión y los permisos de esta cuenta. La bandeja mostrará aquí los mensajes y comentarios que ${network} permita consultar.`}</p></div> : null}
    {connection?.ready && connection.message ? <p className={styles.hint}>{connection.message}</p> : null}

    <div className={`${styles.inbox} ${selected ? styles.hasSelection : ""}`}>
      <div className={styles.threadList}>
        <div className={styles.tabs} role="group" aria-label="Tipo de conversación">
          {([['message', 'Mensajes', MessagesSquare], ['comment', 'Comentarios', MessageCircle]] as const).map(([value, label, Icon]) => {
            const pending = attention ? value === 'message' ? attention.messages : attention.comments : 0;
            return <button key={value} type="button" aria-pressed={kind === value} disabled={sending} className={kind === value ? styles.activeTab : ""} onClick={() => { if (kind === value) return; ++listRequest.current; ++detailRequest.current; loadedOlder.current = false; inboxLoading.current = false; detailLoadingRef.current = false; inboxNextAttempt.current = 0; detailNextAttempt.current = 0; setKind(value); threadsRef.current = []; setThreads([]); setSelected(null); setDetail(null); setCursor(null); setQuery(""); setNotice(null); setPartialHint(null); setReadError(null); }}><Icon size={16} aria-hidden="true" />{label}{pending > 0 ? <span className={styles.unreadBadge} aria-label={`${pending} pendientes de revisar${attention?.error ? ', recuento sin actualizar' : ''}`}>{pending}</span> : null}</button>;
          })}
        </div>
        <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label={`Buscar ${comments ? "comentarios" : "mensajes"}`} placeholder="Buscar en la bandeja…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className={styles.listBody} aria-busy={loading}>
          {loading && !threads.length ? <p className={styles.empty} role="status">Consultando {network}…</p> : null}
          {!loading && !filtered.length ? <div className={styles.empty}><NetworkIcon size={26} aria-hidden="true" /><strong>{normalizedQuery ? "Sin coincidencias entre los resultados cargados" : cursor ? comments ? "Sin comentarios en estas publicaciones" : "Sin mensajes en esta página" : comments ? "Sin comentarios disponibles" : "Sin mensajes disponibles"}</strong><p>{cursor ? comments ? "Quedan publicaciones por consultar. Pulsa «Cargar anteriores» para seguir revisando." : "Quedan conversaciones por consultar. Pulsa «Cargar anteriores» para continuar." : normalizedQuery ? "Prueba otro nombre o texto." : connection?.ready ? "La bandeja se actualiza mientras está visible." : `Los contactos aparecerán cuando ${network} permita consultar la bandeja.`}</p></div> : null}
          <ul>{filtered.map(thread => <li key={thread.id}><button className={`${styles.thread} ${selected?.id === thread.id ? styles.activeThread : ""} ${thread.unread ? styles.unreadThread : ''}`} aria-pressed={selected?.id === thread.id} disabled={sending} type="button" onClick={() => selectThread(thread)}><span className={styles.avatar} aria-hidden="true">{(thread.name || thread.username || (provider === 'facebook' ? 'FB' : 'IG')).slice(0, 2).toUpperCase()}</span><span className={styles.threadCopy}><span className={styles.threadTitle}><strong>{thread.name || thread.username || `Contacto de ${network}`}</strong><time dateTime={thread.updatedAt}>{timeLabel(thread.updatedAt)}</time></span><span className={styles.preview}>{thread.preview || (comments ? "Comentario en una publicación" : "Abrir conversación")}</span></span>{thread.unread && thread.unread > 0 ? <span className={styles.unreadBadge} aria-label={`${thread.unread} pendientes de revisar`}>{thread.unread}</span> : null}</button></li>)}</ul>
          {cursor ? <button type="button" className={styles.loadMore} disabled={loadingMore || loading || sending} onClick={() => void loadInbox(kind, cursor)}>{loadingMore ? "Cargando…" : "Cargar anteriores"}</button> : null}
          {partialHint ? <p className={styles.partial}>{partialHint}</p> : null}
        </div>
      </div>

      <div className={styles.conversation}>
        {!selected ? <div className={styles.placeholder}><span className={styles.placeholderIcon}><NetworkIcon size={36} strokeWidth={1.4} aria-hidden="true" /></span><h3>Cada conversación, una oportunidad</h3><p>Abre un mensaje o comentario, conoce desde dónde nos escriben y prepara la respuesta que necesiten.</p><div><span>1 · Panel y Oráculo</span><span>2 · Primera consulta gratis</span></div></div> : <>
          <header className={styles.conversationHeader}><button type="button" className={styles.backButton} disabled={sending} aria-label="Volver a la bandeja" onClick={() => setSelected(null)}><ArrowLeft size={18} /></button><div><strong>{selected.name || selected.username || `Contacto de ${network}`}</strong><span>{selected.kind === "comment" ? "Comentario en una publicación" : "Mensaje privado"}{selected.username ? ` · @${selected.username.replace(/^@/, "")}` : ""}</span></div>{selectedLink ? <a href={selectedLink} target="_blank" rel="noopener noreferrer" aria-label={`Abrir publicación en ${network}`}><ExternalLink size={18} /></a> : null}</header>
          <div className={styles.messages} aria-busy={detailLoading} aria-label={selected.kind === "comment" ? "Comentario y respuestas" : "Mensajes de la conversación"}>
            {detailLoading && !currentDetail ? <p className={styles.empty} role="status">Abriendo conversación…</p> : null}
            {currentDetail?.messages.map(message => <article key={message.id} className={`${styles.bubble} ${message.fromMe ? styles.ours : styles.theirs}`}>{message.senderName ? <strong>{message.senderName}</strong> : null}<p>{message.text || `Contenido multimedia. Ábrelo en ${network} para consultarlo.`}</p><time dateTime={message.createdAt}>{message.fromMe ? "Equipo · " : ""}{timeLabel(message.createdAt)}</time></article>)}
            {currentDetail && !currentDetail.messages.length ? <p className={styles.empty}>{network} no ha devuelto contenido para esta conversación.</p> : null}
          </div>
          <form className={styles.composer} onSubmit={send}>
            {pendingSend ? <div className={styles.pendingReview}><strong>Comprueba el envío pendiente</strong><p>Abre {network} y comprueba si esta respuesta se envió antes de elegir. Esto guarda el resultado; no envía otro mensaje.</p><blockquote>{pendingSend.text}</blockquote><div><a href={inboxUrl} target="_blank" rel="noopener noreferrer">Abrir mensajes privados <ExternalLink size={12} aria-hidden="true" /></a>{selectedLink ? <a href={selectedLink} target="_blank" rel="noopener noreferrer">Ver publicación <ExternalLink size={12} aria-hidden="true" /></a> : null}</div>{!canResolvePending ? <p>Espera un minuto desde el intento para dar tiempo a confirmar el resultado.</p> : null}<label><input type="checkbox" checked={checkedPending} disabled={sending || !canResolvePending} onChange={event => setCheckedPending(event.target.checked)} />He comprobado la conversación en {network}.</label><div><button type="button" disabled={sending || !checkedPending || !canResolvePending} onClick={() => void resolvePending("sent")}>Sí, se envió</button><button type="button" disabled={sending || !checkedPending || !canResolvePending} onClick={() => void resolvePending("not_sent")}>No se envió</button></div></div> : null}
            <div className={styles.templateLabel}><Sparkles size={14} aria-hidden="true" /><span>Prepara una respuesta</span><small>Puedes editarla antes de enviar.</small></div>
            <div className={styles.templates}>{INSTAGRAM_REPLY_TEMPLATES.map(template => <button key={template.id} type="button" disabled={sending || !canPrepareTemplate} title={template.description} onClick={() => { setReplyMode("private"); updateDraft(provider === "facebook" ? template.text.replaceAll("?source=instagram", "") : template.text); composer.current?.focus(); }}><strong>{template.title}</strong><span>{template.description}</span></button>)}</div>
            {selected.kind === "comment" ? <div className={styles.replyModes} role="group" aria-label="Dónde enviar la respuesta"><button type="button" disabled={sending} aria-pressed={replyMode === "public"} onClick={() => setReplyMode("public")}>Respuesta pública</button><button type="button" disabled={sending || !currentDetail?.canPrivateReply} aria-pressed={replyMode === "private"} onClick={() => setReplyMode("private")}>Mensaje privado</button></div> : null}
            {publicComment ? <p className={styles.replyHint}>Esta respuesta será visible para todos. Las opciones de arriba preparan un mensaje privado con enlaces.</p> : null}
            {privateComment ? <p className={styles.replyHint}>Enviarás un mensaje privado a quien comentó. Solo se permite uno por comentario; espera su respuesta para continuar la conversación.</p> : null}
            {replyHint && !currentDetailError ? <p className={styles.replyHint}>{replyHint}</p> : null}
            {selected.kind === "comment" && currentDetail?.privateReplySent ? <p className={styles.replyHint}>Ya se envió un mensaje privado para este comentario.</p> : null}
            {blockedByUncertainty ? <p className={styles.replyHint}>Envío pendiente de comprobar. Revisa el resultado en la red social; este panel no repetirá el mensaje automáticamente.</p> : null}
            {notice ? <p className={styles.success} role="status">{notice}</p> : null}
            <label className={styles.replyLabel} htmlFor="instagram-reply">{publicComment ? "Respuesta pública al comentario" : "Tu mensaje privado"}</label>
            <textarea id="instagram-reply" ref={composer} maxLength={1000} rows={4} value={draft} disabled={sending || !canReply} onChange={event => updateDraft(event.target.value)} placeholder={canReply ? "Escribe tu respuesta o elige una de las opciones…" : disabledReplyReason} />
            <div className={styles.sendRow}><small>{draft.length}/1000 · {publicComment ? "Visible en la publicación" : "Mensaje privado"}</small><button className={styles.sendButton} type="submit" disabled={sending || !canReply || !draft.trim()}><Send size={16} aria-hidden="true" />{sending ? "Enviando…" : publicComment ? "Publicar respuesta" : "Enviar mensaje privado"}</button></div>
          </form>
        </>}
      </div>
    </div>
  </section>;
}
