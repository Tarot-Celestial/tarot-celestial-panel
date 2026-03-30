// src/app/api/chat/messages/route.ts
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

async function getMe(uid: string) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, service, { auth: { persistSession: false } });

  const { data: me, error } = await db
    .from("workers")
    .select("id, role, display_name, team")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me) throw new Error("NO_WORKER");

  return { db, me };
}

function senderDisplayFromJoin(senderRel: any): string | null {
  // Supabase puede devolver objeto o array según el join / tipado
  if (!senderRel) return null;
  if (Array.isArray(senderRel)) return senderRel?.[0]?.display_name ? String(senderRel[0].display_name) : null;
  return senderRel?.display_name ? String(senderRel.display_name) : null;
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const thread_id_q = searchParams.get("thread_id");

    const { db, me } = await getMe(uid);

    let threadId = thread_id_q ? String(thread_id_q) : null;

    if (me.role === "tarotista") {
      // tarotista siempre su hilo (ignora thread_id si lo pasan)
      const { data: t, error: et } = await db.from("chat_threads").select("id").eq("tarotist_worker_id", me.id).maybeSingle();
      if (et) throw et;

      if (!t?.id) {
        const { data: created, error: ec } = await db
          .from("chat_threads")
          .insert({ tarotist_worker_id: me.id, status: "open" })
          .select("id")
          .single();
        if (ec) throw ec;
        threadId = String(created.id);
      } else {
        threadId = String(t.id);
      }
    } else {
      // staff necesita thread_id
      if (me.role !== "central" && me.role !== "admin") {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }
      if (!threadId) return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });
    }

    const { data: msgs, error: em } = await db
      .from("chat_messages")
      .select(
        `
        id, thread_id, sender_worker_id, sender_display_name, body, created_at,
        sender:workers!chat_messages_sender_worker_id_fkey (id, display_name, role, team)
      `
      )
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (em) throw em;

    const normalized = (msgs || []).map((m: any) => ({
      id: String(m.id),
      thread_id: String(m.thread_id),
      sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
      sender_display_name:
        m.sender_display_name != null
          ? String(m.sender_display_name)
          : senderDisplayFromJoin(m.sender) || null,
      text: m.body != null ? String(m.body) : "",
      created_at: m.created_at != null ? String(m.created_at) : null,
    }));

    return NextResponse.json({ ok: true, thread_id: threadId, messages: normalized });
  } catch (e: any) {
    const msg = e?.message || "ERR";
    const status = msg === "NO_WORKER" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const thread_id_body = body?.thread_id ? String(body.thread_id) : null;
    const text = String(body?.body ?? body?.text ?? "").trim();

    if (!text) return NextResponse.json({ ok: false, error: "EMPTY_BODY" }, { status: 400 });

    const { db, me } = await getMe(uid);

    let threadId = thread_id_body;

    if (me.role === "tarotista") {
      // tarotista siempre su hilo
      const { data: t, error: et } = await db.from("chat_threads").select("id").eq("tarotist_worker_id", me.id).maybeSingle();
      if (et) throw et;

      if (!t?.id) {
        const { data: created, error: ec } = await db
          .from("chat_threads")
          .insert({ tarotist_worker_id: me.id, status: "open" })
          .select("id")
          .single();
        if (ec) throw ec;
        threadId = String(created.id);
      } else {
        threadId = String(t.id);
      }
    } else {
      // staff
      if (me.role !== "central" && me.role !== "admin") {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }
      if (!threadId) return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });
    }

    const sender_display_name = me.display_name ? String(me.display_name) : me.role === "tarotista" ? "Tarotista" : "Central";

    const { data: msgRow, error: ei } = await db
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        sender_worker_id: me.id,
        sender_display_name,
        body: text,
      })
      .select(
        `
        id, thread_id, sender_worker_id, sender_display_name, body, created_at,
        sender:workers!chat_messages_sender_worker_id_fkey (id, display_name, role, team)
      `
      )
      .single();

    if (ei) throw ei;

    const senderNameFromJoin = senderDisplayFromJoin((msgRow as any)?.sender);

    return NextResponse.json({
      ok: true,
      thread_id: String(msgRow.thread_id),
      message: {
        id: String(msgRow.id),
        thread_id: String(msgRow.thread_id),
        sender_worker_id: msgRow.sender_worker_id != null ? String(msgRow.sender_worker_id) : null,
        sender_display_name:
          msgRow.sender_display_name != null
            ? String(msgRow.sender_display_name)
            : senderNameFromJoin || sender_display_name,
        text: msgRow.body != null ? String(msgRow.body) : "",
        created_at: msgRow.created_at != null ? String(msgRow.created_at) : null,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "ERR";
    const status = msg === "NO_WORKER" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
