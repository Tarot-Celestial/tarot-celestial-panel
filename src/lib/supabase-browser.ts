// src/lib/supabase-browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __tcSupabaseBrowserClient: SupabaseClient | undefined;
  // eslint-disable-next-line no-var
  var __tcSupabaseClienteBrowserClient: SupabaseClient | undefined;
}

let client: SupabaseClient | null = null;
let clienteClient: SupabaseClient | null = null;

const SESSION_REFRESH_MARGIN_MS = 60_000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

function sessionNeedsRefresh(session: any): boolean {
  const expiresAt = Number(session?.expires_at || 0) * 1000;
  return Boolean(session?.refresh_token) && (!expiresAt || expiresAt <= Date.now() + SESSION_REFRESH_MARGIN_MS);
}

function temporaryRefreshError(error: any): boolean {
  const status = Number(error?.status || 0);
  return Boolean(error) && (error.name === "AuthRetryableFetchError" || status === 429 || status >= 500);
}

function browserFetchForProject(projectUrl: string): typeof fetch {
  const projectOrigin = new URL(projectUrl).origin;
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const target = new URL(request?.url || String(input));
    const method = String(init?.method || request?.method || "GET").toUpperCase();
    if (typeof window === "undefined" || target.origin !== projectOrigin || !target.pathname.startsWith("/auth/v1/")) {
      return fetch(input, init);
    }

    // setSession verifies the user through the SDK. Keep that verification on
    // the panel's origin; only this exact Auth read is delegated to the server.
    const verifyUser = target.pathname === "/auth/v1/user" && method === "GET";
    const headers = new Headers(init?.headers || request?.headers);
    const controller = new AbortController();
    const upstreamSignal = init?.signal || request?.signal;
    const abort = () => controller.abort();
    if (upstreamSignal?.aborted) abort();
    else upstreamSignal?.addEventListener("abort", abort, { once: true });
    // Initialization can refresh a stored session before setSession/getSession
    // settle. Bound that network request too, not just user verification. A
    // fetch abort remains retryable in Auth, so an outage never signs out the
    // user. The SDK's 30s refresh retry window plus this 10s attempt deadline
    // also bounds the complete refresh operation (under 40s).
    const timer = setTimeout(abort, AUTH_REQUEST_TIMEOUT_MS);
    try {
      const response = verifyUser ? await fetch("/api/auth/user", {
        method: "GET",
        headers: { Authorization: headers.get("authorization") || "" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      }) : await fetch(input, { ...init, signal: controller.signal });
      // Auth responses are small JSON documents. Keep cancellation active
      // through the body, otherwise headers followed by a stalled body can
      // still hold the SDK's initialization indefinitely. Return the original
      // response with its headers/status unchanged for the SDK to interpret.
      if (response.body) await response.clone().arrayBuffer();
      return response;
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abort);
    }
  };
}

export function supabaseBrowserStorageKey(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");

  const projectRef = new URL(url).hostname.split(".")[0];
  if (!projectRef) throw new Error("Invalid env NEXT_PUBLIC_SUPABASE_URL");
  return `sb-${projectRef}-auth-token`;
}

function createBrowserClient(storageKey: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const browserClient = createClient(url, anon, {
    global: { fetch: browserFetchForProject(url) },
    auth: {
      storageKey,
      // ✅ Mantén refresh y persistencia
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,

      // ✅ Recomendado en SPA / Next.js client
      flowType: "pkce",

      // ❌ NO storageKey personalizado (ok como lo tenías)
    },
  });

  // Las pestañas del panel realizan varias consultas en paralelo. Si el JWT
  // está a punto de vencer, renueva una sola vez y comparte el resultado con
  // todas ellas; así evitamos ráfagas de refresh y respuestas 401 intermitentes.
  let sessionRefreshPromise: Promise<any> | null = null;
  const originalGetSession = browserClient.auth.getSession.bind(browserClient.auth);
  browserClient.auth.getSession = (async () => {
    const current = await originalGetSession();
    const session = current.data.session;
    if (current.error || !session || !sessionNeedsRefresh(session)) return current;

    if (!sessionRefreshPromise) {
      sessionRefreshPromise = browserClient.auth
        .refreshSession(session)
        .finally(() => { sessionRefreshPromise = null; });
    }

    const refreshed = await sessionRefreshPromise;
    if (refreshed.data.session) {
      return { data: { session: refreshed.data.session }, error: null };
    }

    // A temporary proactive-refresh error does not invalidate a still-live
    // access token. Protected APIs continue to verify that token themselves.
    if (temporaryRefreshError(refreshed.error) && Number(session.expires_at || 0) * 1000 > Date.now()) return current;
    return { data: { session: null }, error: refreshed.error || current.error };
  }) as typeof browserClient.auth.getSession;

  // Evita llamadas repetidas a /auth/v1/user desde el navegador.
  // Para el panel basta la sesión local; las APIs siguen validando roles con service role.
  const originalGetUser = browserClient.auth.getUser.bind(browserClient.auth);
  browserClient.auth.getUser = (async (jwt?: string) => {
    if (jwt) return originalGetUser(jwt);
    const { data, error } = await browserClient.auth.getSession();
    return { data: { user: data.session?.user ?? null }, error } as any;
  }) as any;

  return browserClient;
}

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  if (globalThis.__tcSupabaseBrowserClient) {
    client = globalThis.__tcSupabaseBrowserClient;
    return client;
  }

  client = createBrowserClient(supabaseBrowserStorageKey());

  globalThis.__tcSupabaseBrowserClient = client;
  return client;
}

export function supabaseClienteBrowser(): SupabaseClient {
  if (clienteClient) return clienteClient;
  if (globalThis.__tcSupabaseClienteBrowserClient) {
    clienteClient = globalThis.__tcSupabaseClienteBrowserClient;
    return clienteClient;
  }

  // El panel cliente usa una sesión independiente. De esta forma iniciar
  // sesión como central/admin en otra pestaña no reemplaza al cliente.
  clienteClient = createBrowserClient(`${supabaseBrowserStorageKey()}-cliente`);
  globalThis.__tcSupabaseClienteBrowserClient = clienteClient;
  return clienteClient;
}
