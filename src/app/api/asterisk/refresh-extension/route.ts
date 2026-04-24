import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshPjsipRealtimeObject } from "@/lib/server/asterisk-ami";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function sanitizeExtension(value: any) {
  return String(value || "").replace(/\D/g, "").trim();
}

async function getAuthContext(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, error: "NO_TOKEN" };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const uid = userData?.user?.id || null;
  const email = userData?.user?.email || null;
  if (!uid) return { ok: false as const, error: "BAD_TOKEN" };

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const byUser = await admin.from("workers").select("role,email").eq("user_id", uid).maybeSingle();
  let role = String(byUser.data?.role || "").toLowerCase();
  if (!role && email) {
    const byEmail = await admin.from("workers").select("role").eq("email", email).maybeSingle();
    role = String(byEmail.data?.role || "").toLowerCase();
  }

  if (!["admin", "central"].includes(role)) return { ok: false as const, error: "FORBIDDEN" };
  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const gate = await getAuthContext(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });

    const body = await req.json().catch(() => ({}));
    const extension = sanitizeExtension(body?.extension);
    if (!extension) return NextResponse.json({ ok: false, error: "EXTENSION_REQUIRED" }, { status: 400 });

    const refresh = await refreshPjsipRealtimeObject(extension);
    return NextResponse.json({ ok: refresh.ok, refresh });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
