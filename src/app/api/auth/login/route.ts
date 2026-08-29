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
      global: { fetch: fetchWithTimeout },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) {
      const authMessage = String(error.message || "");
      const authStatus = Number(error.status || 0);
      if (
        authStatus === 0 ||
        authStatus >= 500 ||
        /fetch|network|timeout|abort|connection|context canceled|deadline exceeded|starting up|shutting down/i.test(authMessage)
      ) {
        throw error;
      }
      return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
    }
    if (!data.user || !data.session) {
      return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
    }

    const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
      global: { fetch: fetchWithTimeout },
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
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof Error && (
      error.name === "AbortError" ||
      error.name === "SupabaseTimeoutError" ||
      /fetch|network|timeout|abort|connection/i.test(error.message)
    );
    console.error(JSON.stringify({
      level: "error",
      message: timedOut ? "supabase_timeout" : "login_failed",
      route: "/api/auth/login",
      requestId,
      error: message,
      durationMs: Date.now() - startedAt,
    }));
    return json({
      ok: false,
      error: timedOut ? "SUPABASE_TIMEOUT" : "AUTH_SERVICE_UNAVAILABLE",
    }, 503);
  }
}
