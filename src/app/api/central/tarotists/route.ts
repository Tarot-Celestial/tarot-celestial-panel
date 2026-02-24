import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnvAny(names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

async function getMeFromBearer(req: Request) {
  const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
  const anonKey = getEnvAny(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, error: "NO_TOKEN" as const };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  const uid = data?.user?.id || null;
  if (!uid) return { ok: false, error: "BAD_TOKEN" as const };

  const url = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
  const service = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: w, error: werr } = await admin
    .from("workers")
    .select("id, role, display_name, team_key")
    .eq("user_id", uid)
    .maybeSingle();

  if (werr || !w) return { ok: false, error: "NO_WORKER" as const };
  return { ok: true, worker: w };
}

export async function GET(req: Request) {
  try {
    const me = await getMeFromBearer(req);
    if (!me.ok) return NextResponse.json(me, { status: 401 });

    // centrales y admin pueden usar esto
    if (me.worker.role !== "central" && me.worker.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const url = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const service = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data, error } = await admin
      .from("workers")
      .select("id, display_name, role, team_key, is_active")
      .eq("role", "tarotista")
      .order("display_name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, tarotists: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
