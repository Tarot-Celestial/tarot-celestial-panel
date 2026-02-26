import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token || null;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const token = getBearer(req);
  if (!token) return { uid: null as string | null, token: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null, token };
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // quién soy
    const { data: me, error: em } = await db
      .from("workers")
      .select("id, role, display_name, team")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    // TAROTISTA => asegurar 1 thread y devolverlo
    if (me.role === "tarotista") {
      const { data: existing, error: ee } = await db
        .from("chat_threads")
        .select("id, tarotist_worker_id, status, created_at, last_message_at, last_message_preview")
        .eq("tarotist_worker_id", me.id)
        .maybeSingle();
      if (ee) throw ee;

      if (existing?.id) {
        return NextResponse.json({ ok: true, mode: "tarotista", thread: existing });
      }

      const { data: created, error: ec } = await db
        .from("chat_threads")
        .insert({ tarotist_worker_id: me.id, status: "open" })
        .select("id, tarotist_worker_id, status, created_at, last_message_at, last_message_preview")
        .single();
      if (ec) throw ec;

      return NextResponse.json({ ok: true, mode: "tarotista", thread: created });
    }

    // STAFF (central/admin) => lista todos
    if (me.role !== "central" && me.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: threads, error: et } = await db
      .from("chat_threads")
      .select(`
        id, tarotist_worker_id, status, created_at, last_message_at, last_message_preview,
        tarotist:workers!chat_threads_tarotist_worker_id_fkey (id, display_name, team, role)
      `)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (et) throw et;

    return NextResponse.json({ ok: true, mode: "staff", threads: threads ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
