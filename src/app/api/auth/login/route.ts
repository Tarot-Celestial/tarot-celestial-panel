import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Auth puede tardar varios segundos durante una recuperación de PostgreSQL.
// Se mantiene un límite para no dejar la función colgada, pero 6 s provocaba
// falsos negativos incluso en peticiones que Supabase terminaba resolviendo.
const SUPABASE_REQUEST_TIMEOUT_MS = 12000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error("Supabase request timed out");
      timeoutError.name = "SupabaseTimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id");
  let stage: "authentication" | "worker_lookup" = "authentication";
  let upstreamStatus: number | null = null;
  // The SDK can discard the HTTP status when a gateway returns HTML instead
  // of JSON. Keep only the status, scoped to this login request.
  const loginFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchWithTimeout(input, init);
    upstreamStatus = response.status;
    return response;
  };
  console.log(JSON.stringify({
    level: "info",
    message: "login_started",
    route: "/api/auth/login",
    requestId,
  }));

  try {
    const body = await request.json().catch(() => null) as {
      email?: unknown;
      password?: unknown;
    } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) return json({ ok: false, error: "MISSING_CREDENTIALS" }, 400);

    const url = env("NEXT_PUBLIC_SUPABASE_URL");
    const authClient = createClient(url, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { fetch: loginFetch },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.user || !data.session) {
      throw new Error("Incomplete authentication response");
    }

    stage = "worker_lookup";
    upstreamStatus = null;
    const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
      global: { fetch: loginFetch },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: worker, error: workerError } = await admin
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (workerError) throw workerError;
    if (!worker?.id) return json({ ok: false, error: "NO_WORKER" }, 403);
    if (worker.is_active === false) return json({ ok: false, error: "WORKER_DISABLED" }, 403);

    const role = String(worker.role || "").toLowerCase();
    if (!["admin", "central", "tarotista"].includes(role)) {
      return json({ ok: false, error: "INVALID_ROLE" }, 403);
    }

    console.log(JSON.stringify({
      level: "info",
      message: "login_completed",
      route: "/api/auth/login",
      requestId,
      durationMs: Date.now() - startedAt,
    }));
    return json({ ok: true, role, session: data.session });
  } catch (error) {
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const errorStatus = Number(details.status);
    const status = upstreamStatus ?? (Number.isInteger(errorStatus) && errorStatus >= 100 && errorStatus <= 599 ? errorStatus : null);
    const upstreamCode = typeof details.code === "string" && /^[a-z0-9_]{1,64}$/i.test(details.code) ? details.code : null;
    const timedOut = details.name === "AbortError" || details.name === "SupabaseTimeoutError" || (
      typeof details.message === "string" && /fetch|network|timeout|abort|connection/i.test(details.message)
    );
    let publicError = "AUTH_SERVICE_UNAVAILABLE";
    let responseStatus = 503;
    if (status === 402) {
      publicError = "AUTH_SERVICE_RESTRICTED";
      responseStatus = 402;
    } else if (status === 429) {
      publicError = "AUTH_RATE_LIMITED";
      responseStatus = 429;
    } else if (timedOut) {
      publicError = "SUPABASE_TIMEOUT";
    } else if (stage === "authentication" && status !== null && status >= 400 && status < 500) {
      // Unknown client errors (including invalid API keys) are service errors,
      // never evidence that the person's password was incorrect.
      const knownErrors: Record<string, string> = {
        invalid_credentials: "INVALID_CREDENTIALS",
        email_not_confirmed: "AUTH_EMAIL_NOT_CONFIRMED",
        user_banned: "AUTH_ACCOUNT_BLOCKED",
        captcha_failed: "AUTH_CAPTCHA_FAILED",
      };
      const knownError = upstreamCode && Object.hasOwn(knownErrors, upstreamCode) ? knownErrors[upstreamCode] : undefined;
      if (knownError) {
        publicError = knownError;
        responseStatus = knownError === "INVALID_CREDENTIALS" ? 401 : 403;
      }
    }
    console.error(JSON.stringify({
      level: "error",
      message: "login_failed",
      route: "/api/auth/login",
      requestId,
      stage,
      error: publicError,
      upstreamStatus: status,
      upstreamCode,
      durationMs: Date.now() - startedAt,
    }));
    return json({ ok: false, error: publicError }, responseStatus);
  }
}
