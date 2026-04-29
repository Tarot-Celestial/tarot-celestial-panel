import { createClient } from "@supabase/supabase-js";

export type SupabaseAdmin = ReturnType<typeof createClient>;

function n(value: any) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function clean(value: any) {
  return String(value ?? "").trim();
}

function isMissingRelationError(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("relation") || msg.includes("schema cache") || msg.includes("column");
}

function completedSessionPayload(session: any) {
  return {
    handled: true,
    session_id: session.id,
    already_completed: true,
    assigned_minutes: Math.max(0, n(session.assigned_free_minutes)) + Math.max(0, n(session.assigned_normal_minutes)),
    consumed_seconds: Math.max(0, n(session.consumed_seconds)),
    consumed_minutes: Math.max(0, n(session.consumed_free_minutes) + n(session.consumed_normal_minutes)),
    free_used: Math.max(0, n(session.consumed_free_minutes)),
    normal_used: Math.max(0, n(session.consumed_normal_minutes)),
    refund_free: Math.max(0, n(session.refunded_free_minutes)),
    refund_normal: Math.max(0, n(session.refunded_normal_minutes)),
  };
}

export async function finalizeBestMinuteSessionFromAsterisk(
  admin: any,
  args: {
    clienteId?: string | null;
    tarotistaWorkerId?: string | null;
    endedAt?: string | null;
    fallbackSeconds?: number | null;
    metadata?: Record<string, any>;
  }
) {
  const clienteId = clean(args.clienteId);
  const tarotistaWorkerId = clean(args.tarotistaWorkerId);
  if (!clienteId || !tarotistaWorkerId) return { handled: false, reason: "missing_match_keys" };

  const activeRes = await admin
    .from("call_minute_sessions")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("tarotista_worker_id", tarotistaWorkerId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRes.error) {
    if (isMissingRelationError(activeRes.error)) return { handled: false, reason: "missing_table" };
    throw activeRes.error;
  }

  let session = activeRes.data;

  // Si el frontend ya cortó por tiempo y marcó la sesión como completed, el webhook
  // de Asterisk llegará después. En ese caso solo consideramos una sesión completed
  // muy reciente para no bloquear consumos normales de otras llamadas futuras.
  if (!session?.id) {
    const endedAtIso = args.endedAt || new Date().toISOString();
    const endedAtMs = new Date(endedAtIso).getTime();
    const since = new Date((Number.isFinite(endedAtMs) ? endedAtMs : Date.now()) - 15 * 60 * 1000).toISOString();

    const completedRes = await admin
      .from("call_minute_sessions")
      .select("*")
      .eq("cliente_id", clienteId)
      .eq("tarotista_worker_id", tarotistaWorkerId)
      .eq("status", "completed")
      .gte("ended_at", since)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (completedRes.error) {
      if (isMissingRelationError(completedRes.error)) return { handled: false, reason: "missing_table" };
      throw completedRes.error;
    }

    if (completedRes.data?.id) return completedSessionPayload(completedRes.data);
    return { handled: false, reason: "no_active_session" };
  }

  const startedAtMs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
  const endedAtIso = args.endedAt || new Date().toISOString();
  const endedAtMs = new Date(endedAtIso).getTime();
  const elapsedSeconds = Math.max(0, Math.round(((Number.isFinite(endedAtMs) ? endedAtMs : Date.now()) - (Number.isFinite(startedAtMs) ? startedAtMs : Date.now())) / 1000));
  const consumedSeconds = elapsedSeconds > 0 ? elapsedSeconds : Math.max(0, Math.round(n(args.fallbackSeconds)));

  const assignedFree = Math.max(0, n(session.assigned_free_minutes));
  const assignedNormal = Math.max(0, n(session.assigned_normal_minutes));
  const assignedTotal = assignedFree + assignedNormal;
  const consumedMinutes = Math.min(assignedTotal, Math.ceil(consumedSeconds / 60));

  const consumedFree = Math.min(assignedFree, consumedMinutes);
  const consumedNormal = Math.min(assignedNormal, Math.max(0, consumedMinutes - consumedFree));
  const refundFree = Math.max(0, assignedFree - consumedFree);
  const refundNormal = Math.max(0, assignedNormal - consumedNormal);

  if (refundFree > 0 || refundNormal > 0) {
    const { data: cliente, error: clienteErr } = await admin
      .from("crm_clientes")
      .select("id,minutos_free_pendientes,minutos_normales_pendientes")
      .eq("id", clienteId)
      .maybeSingle();
    if (clienteErr) throw clienteErr;
    if (cliente?.id) {
      const { error: updErr } = await admin
        .from("crm_clientes")
        .update({
          minutos_free_pendientes: Math.max(0, n(cliente.minutos_free_pendientes) + refundFree),
          minutos_normales_pendientes: Math.max(0, n(cliente.minutos_normales_pendientes) + refundNormal),
          updated_at: new Date().toISOString(),
        })
        .eq("id", clienteId);
      if (updErr) throw updErr;
    }
  }

  const { error: updSessionErr } = await admin
    .from("call_minute_sessions")
    .update({
      status: "completed",
      ended_at: endedAtIso,
      consumed_seconds: consumedSeconds,
      consumed_free_minutes: consumedFree,
      consumed_normal_minutes: consumedNormal,
      refunded_free_minutes: refundFree,
      refunded_normal_minutes: refundNormal,
      metadata: { ...(session.metadata || {}), ...(args.metadata || {}), finalized_by: "asterisk_webhook" },
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (updSessionErr) throw updSessionErr;

  return {
    handled: true,
    session_id: session.id,
    assigned_minutes: assignedTotal,
    consumed_seconds: consumedSeconds,
    consumed_minutes: consumedMinutes,
    free_used: consumedFree,
    normal_used: consumedNormal,
    refund_free: refundFree,
    refund_normal: refundNormal,
  };
}
