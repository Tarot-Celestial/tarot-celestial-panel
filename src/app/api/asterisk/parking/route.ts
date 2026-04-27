import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAsteriskIncomingSnapshot, getAsteriskLiveSnapshot, getAsteriskParkingSnapshot } from "@/lib/server/asterisk-ami";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

async function getAuthContext(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, error: "NO_TOKEN" as const };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: userData } = await userClient.auth.getUser();
  const uid = userData?.user?.id || null;
  const email = userData?.user?.email || null;
  if (!uid) return { ok: false as const, error: "BAD_TOKEN" as const };

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const byUser = await admin
    .from("workers")
    .select("id, user_id, role, display_name, email")
    .eq("user_id", uid)
    .maybeSingle();

  let me = byUser.data || null;
  if (!me && email) {
    const byEmail = await admin
      .from("workers")
      .select("id, user_id, role, display_name, email")
      .eq("email", email)
      .maybeSingle();
    me = byEmail.data || null;
  }

  if (!me) return { ok: false as const, error: "NO_WORKER" as const };
  return { ok: true as const, me };
}

export async function GET(req: Request) {
  try {
    const gate = await getAuthContext(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 401 });

    const role = String(gate.me.role || "").toLowerCase();
    if (!["admin", "central"].includes(role)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const [parking, incoming, live] = await Promise.all([
      getAsteriskParkingSnapshot(),
      getAsteriskIncomingSnapshot(),
      getAsteriskLiveSnapshot(),
    ]);

    return NextResponse.json({
      ok: parking.ok || incoming.ok || live.ok,
      calls: parking.calls,
      incomingCalls: incoming.calls,
      liveExtensions: live.extensions || {},
      asteriskParking: { ok: parking.ok, error: parking.error || null, raw: parking.raw || null },
      asteriskIncoming: { ok: incoming.ok, error: incoming.error || null, raw: incoming.raw || null },
      asteriskLive: { ok: live.ok, error: live.error || null },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
