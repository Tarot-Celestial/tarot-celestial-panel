type BackgroundFetchOptions = {
  key?: string;
  timeoutMs?: number;
};

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const MAX_BACKOFF_MS = 5 * 60_000;
const inFlight = new Map<string, Promise<Response>>();

let consecutiveFailures = 0;
let blockedUntil = 0;

export class BackgroundRequestPausedError extends Error {
  constructor() {
    super("Actualización automática pausada mientras el servicio se recupera");
    this.name = "BackgroundRequestPausedError";
  }
}

function requestKey(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === "string") return `${init?.method || "GET"}:${input}`;
  if (input instanceof URL) return `${init?.method || "GET"}:${input.toString()}`;
  return `${init?.method || input.method || "GET"}:${input.url}`;
}

function registerFailure() {
  consecutiveFailures += 1;
  const delay = Math.min(MAX_BACKOFF_MS, 15_000 * 2 ** Math.min(consecutiveFailures - 1, 5));
  blockedUntil = Math.max(blockedUntil, Date.now() + delay);
}

function registerSuccess() {
  consecutiveFailures = 0;
  blockedUntil = 0;
}

async function performFetch(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (RETRYABLE_STATUS.has(response.status)) registerFailure();
    else if (response.ok) registerSuccess();
    return response;
  } catch (error) {
    if (!upstreamSignal?.aborted) registerFailure();
    throw error;
  } finally {
    window.clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

/**
 * Para lecturas automáticas: evita solicitudes duplicadas y abre un circuito
 * temporal cuando el backend devuelve errores 5xx o deja de responder.
 * Las acciones iniciadas por el usuario deben seguir usando fetch directamente.
 */
export async function backgroundFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: BackgroundFetchOptions = {}
) {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    throw new BackgroundRequestPausedError();
  }
  if (Date.now() < blockedUntil) throw new BackgroundRequestPausedError();

  const key = options.key || requestKey(input, init);
  let shared = inFlight.get(key);
  if (!shared) {
    shared = performFetch(input, init, options.timeoutMs ?? 12_000);
    inFlight.set(key, shared);
    void shared.finally(() => {
      if (inFlight.get(key) === shared) inFlight.delete(key);
    }).catch(() => undefined);
  }

  const response = await shared;
  return response.clone();
}

