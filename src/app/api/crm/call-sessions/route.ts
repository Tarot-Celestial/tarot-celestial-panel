import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hangupActiveTransferChannels } from "@/lib/server/asterisk-ami";

export const runtime = "nodejs";

type MinuteSessionRow = {
  id: string;
  cliente_id: string;
  tarotista_worker_id?: string | null;
  source_worker_id?: string | null;
  source_extension?: string | null;
  target_extension?: string | null;
  assigned_free_minutes?: number | null;
  assigned_normal_minutes?: number | null;
  status?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  metadata?: Record<string, any> | null;
};

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

function nowIso() {
  return new Date().toISOString();
}

function sanitizePhone(value: any) {
  return String(value || "").replace(/[^0-9+]/g, "").trim();
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
      updated_at: nowIso(),
    })
    .eq("id", clienteId);
  if (error) throw error;
}

async function readTargetPhone(db: any, extension?: string | null) {
  const ext = clean(extension);
  if (!ext) return null;
  const { data, error } = await db.from("pbx_routing").select("target,type").eq("extension", ext).maybeSingle();
  if (error) return null;
  if (String(data?.type || "").toLowerCase() !== "external") return null;
  return sanitizePhone(data?.target || "") || null;
}

function computeElapsedSeconds(session: MinuteSessionRow, endedAtIso: string) {
  const startedMs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
  const endedMs = new Date(endedAtIso).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return 0;
  return Math.max(0, Math.round((endedMs - startedMs) / 1000));
}

async function completeActiveSession(db: any, session: MinuteSessionRow, opts: { forceHangup?: boolean; reason?: string }) {
  if (String(session.status || "") === "completed") return { session, alreadyCompleted: true, hangup: null };
  if (String(session.status || "") !== "active") return { session, ignored: true, reason: "NOT_ACTIVE", hangup: null };

  const endedAt = nowIso();
  const assignedFree = Math.max(0, n(session.assigned_free_minutes));
  const assignedNormal = Math.max(0, n(session.assigned_normal_minutes));
  const assignedTotal = assignedFree + assignedNormal;
  const elapsedSeconds = computeElapsedSeconds(session, endedAt);
  const consumedMinutes = Math.min(assignedTotal, Math.ceil(elapsedSeconds / 60));

  // La reserva se descuenta completa al activar. Al cerrar devolvemos solo lo no consumido.
  // Siempre se consumen primero los minutos free y después los normales, como en la asignación inicial.
  const consumedFree = Math.min(assignedFree, consumedMinutes);
  const consumedNormal = Math.min(assignedNormal, Math.max(0, consumedMinutes - consumedFree));
  const refundFree = Math.max(0, assignedFree - consumedFree);
  const refundNormal = Math.max(0, assignedNormal - consumedNormal);

  const updatePayload = {
    status: "completed",
    ended_at: endedAt,
    consumed_seconds: elapsedSeconds,
    consumed_free_minutes: consumedFree,
    consumed_normal_minutes: consumedNormal,
    refunded_free_minutes: refundFree,
    refunded_normal_minutes: refundNormal,
    metadata: { ...(session.metadata || {}), closed_by: opts.reason || "call_sessions_api" },
    updated_at: endedAt,
  };

  // Cierre idempotente: solo una petición puede pasar de active → completed y devolver sobrantes.
  const { data, error } = await db
    .from("call_minute_sessions")
    .update(updatePayload)
    .eq("id", session.id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    const { data: current, error: currentErr } = await db.from("call_minute_sessions").select("*").eq("id", session.id).maybeSingle();
    if (currentErr) throw currentErr;
    return { session: current || session, alreadyCompleted: String(current?.status || "") === "completed", ignored: true, reason: "NOT_ACTIVE", hangup: null };
  }

  if (refundFree > 0 || refundNormal > 0) {
    await addClientMinutes(db, session.cliente_id, refundFree, refundNormal);
  }

  let hangup: any = null;
  if (opts.forceHangup) {
  const targetPhone = await readTargetPhone(db, session.target_extension);

  console.log("FORCE END → intentando colgar llamada", {
    extension: session.target_extension,
    targetPhone,
    clientPhone: session.metadata?.telefono,
  });

  try {
    hangup = await hangupActiveTransferChannels({
      targetExtension: session.target_extension || null,
      targetPhone,
      clientPhone: sanitizePhone(session.metadata?.telefono || session.metadata?.phone || "") || null,
    });

    if (!hangup?.ok) {
      console.error("⚠️ AMI no colgó la llamada correctamente", hangup);
    }
  } catch (err) {
    console.error("💥 ERROR colgando llamada", err);
  }
}

  return {
    session: data,
    assigned_minutes: assignedTotal,
    consumed_seconds: elapsedSeconds,
    consumed_minutes: consumedMinutes,
    consumed_free_minutes: consumedFree,
    consumed_normal_minutes: consumedNormal,
    refunded_free_minutes: refundFree,
    refunded_normal_minutes: refundNormal,
    hangup,
  };
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
      const startedAt = nowIso();
      const { data, error } = await db
        .from("call_minute_sessions")
        .update({ status: "active", started_at: startedAt, updated_at: startedAt })
        .eq("id", session.id)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, session: data });
    }

    if (action === "force_end" || action === "finish" || action === "complete") {
      const result = await completeActiveSession(db, session as MinuteSessionRow, {
        forceHangup: action === "force_end",
        reason: action === "force_end" ? "assigned_minutes_timeout" : "manual_finish",
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "cancel") {
      if (session.status === "active") {
        await addClientMinutes(db, session.cliente_id, n(session.assigned_free_minutes), n(session.assigned_normal_minutes));
      }
      const { data, error } = await db
        .from("call_minute_sessions")
        .update({ status: "cancelled", ended_at: nowIso(), updated_at: nowIso() })
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
