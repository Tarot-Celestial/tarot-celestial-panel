import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: w, error: ew } = await admin
      .from("workers")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (ew) throw ew;
    if (!w?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    // cerrar última sesión abierta
    const { data: open, error: eo } = await admin
      .from("work_sessions")
      .select("id, logout_at")
      .eq("worker_id", w.id)
      .is("logout_at", null)
      .order("login_at", { ascending: false })
      .limit(1);

    if (eo) throw eo;

    if (open?.[0]?.id) {
      const { error: e1 } = await admin.from("work_sessions").update({ logout_at: new Date().toISOString() }).eq("id", open[0].id);
      if (e1) throw e1;
    }

    const { error: e2 } = await admin.from("workers").update({ state: "offline" }).eq("id", w.id);
    if (e2) throw e2;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
