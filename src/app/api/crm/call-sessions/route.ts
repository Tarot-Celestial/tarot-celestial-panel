import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function adminDb() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

function n(value: any) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function clean(value: any) {
  return String(value ?? "").trim();
}

async function getWorker(req: Request, db: any) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const userClient = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  const uid = data.user?.id || null;
  if (!uid) return null;

  const { data: me, error } = await db.from("workers").select("id, role, display_name").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return me;
}

async function getCliente(db: any, clienteId: string) {
  const { data, error } = await db
    .from("crm_clientes")
    .select("id,minutos_free_pendientes,minutos_normales_pendientes")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function addClientMinutes(db: any, clienteId: string, freeDelta: number, normalDelta: number) {
  const cliente = await getCliente(db, clienteId);
  if (!cliente?.id) throw new Error("CLIENTE_NOT_FOUND");
  const { error } = await db
    .from("crm_clientes")
    .update({
      minutos_free_pendientes: Math.max(0, n(cliente.minutos_free_pendientes) + freeDelta),
      minutos_normales_pendientes: Math.max(0, n(cliente.minutos_normales_pendientes) + normalDelta),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clienteId);
  if (error) throw error;
}

export async function POST(req: Request) {
  try {
    const db = adminDb();
    const me = await getWorker(req, db);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "reserve");

    if (action === "reserve") {
      const clienteId = clean(body.cliente_id);
      const tarotistaWorkerId = clean(body.tarotista_worker_id);
      const targetExtension = clean(body.target_extension);
      const sourceExtension = clean(body.source_extension);
      const free = Math.max(0, n(body.assigned_free_minutes));
      const normal = Math.max(0, n(body.assigned_normal_minutes));
      const total = free + normal;

      if (!clienteId) return NextResponse.json({ ok: false, error: "CLIENTE_REQUIRED" }, { status: 400 });
      if (!tarotistaWorkerId) return NextResponse.json({ ok: false, error: "TAROTISTA_REQUIRED" }, { status: 400 });
      if (total <= 0) return NextResponse.json({ ok: false, error: "MINUTES_REQUIRED" }, { status: 400 });

      const cliente = await getCliente(db, clienteId);
      if (!cliente?.id) return NextResponse.json({ ok: false, error: "CLIENTE_NOT_FOUND" }, { status: 404 });
      if (n(cliente.minutos_free_pendientes) < free || n(cliente.minutos_normales_pendientes) < normal) {
        return NextResponse.json({ ok: false, error: "INSUFFICIENT_MINUTES" }, { status: 409 });
      }

      const { data, error } = await db
        .from("call_minute_sessions")
        .insert({
          cliente_id: clienteId,
          tarotista_worker_id: tarotistaWorkerId,
          source_worker_id: me.id,
          source_extension: sourceExtension || null,
          target_extension: targetExtension || null,
          assigned_free_minutes: free,
          assigned_normal_minutes: normal,
          status: "reserved",
          metadata: body.metadata || {},
        })
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, session: data });
    }

    const sessionId = clean(body.session_id || body.id);
    if (!sessionId) return NextResponse.json({ ok: false, error: "SESSION_REQUIRED" }, { status: 400 });

    const { data: session, error: sessionErr } = await db.from("call_minute_sessions").select("*").eq("id", sessionId).maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session?.id) return NextResponse.json({ ok: false, error: "SESSION_NOT_FOUND" }, { status: 404 });

    if (action === "activate") {
      if (session.status === "active") return NextResponse.json({ ok: true, session });
      if (session.status !== "reserved") return NextResponse.json({ ok: false, error: "INVALID_STATUS" }, { status: 409 });

      await addClientMinutes(db, session.cliente_id, -n(session.assigned_free_minutes), -n(session.assigned_normal_minutes));
      const { data, error } = await db
        .from("call_minute_sessions")
        .update({ status: "active", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, session: data });
    }

    if (action === "cancel") {
      if (session.status === "active") {
        await addClientMinutes(db, session.cliente_id, n(session.assigned_free_minutes), n(session.assigned_normal_minutes));
      }
      const { data, error } = await db
        .from("call_minute_sessions")
        .update({ status: "cancelled", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, session: data });
    }

    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
