import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store" },
});
const denied = () => json({ error_code: "bad_jwt", message: "Invalid session" }, 401);
const unavailable = () => json({ error_code: "auth_service_unavailable", message: "Access service unavailable" }, 503);

// A fixed user-verification endpoint, not an arbitrary upstream proxy. The
// caller's bearer is verified by Auth; no role or identity is accepted locally.
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
  if (!token) return denied();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return unavailable();

  try {
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      if ([401, 403].includes(error.status || 0) || ["bad_jwt", "session_not_found", "user_not_found"].includes(String(error.code))) return denied();
      return unavailable();
    }
    if (!data.user?.id) return denied();
    // Supabase Auth's SDK accepts its normal { user } response shape.
    return json({ user: data.user });
  } catch {
    return unavailable();
  }
}
