import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) {
      return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
    }

    const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
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

    return json({ ok: true, role, session: data.session });
  } catch (error) {
    console.error("[api/auth/login] authentication failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "AUTH_SERVICE_UNAVAILABLE" }, 503);
  }
}
