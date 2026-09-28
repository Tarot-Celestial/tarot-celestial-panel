import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  BRAIN_ACTION_APPROVAL_TTL_MINUTES,
  brainControlledActionCatalogue,
  getBrainControlledActionSpec,
  type BrainControlledActionKey,
} from "@/features/brain/brain-controlled-actions";
import {
  BRAIN_PROFESSIONAL_MODE,
  BRAIN_PROFESSIONAL_SAFETY,
} from "@/features/brain/brain-professional-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION_SELECT = "id,request_id,action_key,status,risk_level,title,target_node_id,incident_id,diagnostic_id,input,result,error,requested_by_worker_id,approved_by_worker_id,executed_by_worker_id,approved_at,approval_expires_at,execution_started_at,executed_at,cancelled_at,created_at,updated_at" as const;

const BRAIN_NODE_IDS = new Set(["core", "clients", "team", "realtime", "xp", "billing", "infra"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function noStore(status = 200) {
  return { status, headers: { "Cache-Control": "no-store, max-age=0" } };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "CEREBRO_ACTION_ERROR");
  return message.slice(0, 240);
}

function cleanText(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function isUuid(value: unknown): value is string {
  return UUID_RE.test(String(value || ""));
}

function storageMissing(error: any) {
  return String(error?.code || "") === "42P01" || /brain_controlled_actions/i.test(String(error?.message || ""));
}

async function appendHistory(
  admin: any,
  actionId: string,
  eventType: string,
  statusAfter: string,
  actorWorkerId: string,
  details: Record<string, unknown> = {}
) {
  const { error } = await admin.from("brain_controlled_action_history").insert({
    action_id: actionId,
    event_type: eventType,
    status_after: statusAfter,
    actor_worker_id: actorWorkerId,
    details,
  });

  if (error) console.error("[cerebro:actions:history]", error);
}

async function loadAction(admin: any, actionId: string) {
  const { data, error } = await admin
    .from("brain_controlled_actions")
    .select(ACTION_SELECT)
    .eq("id", actionId)
    .maybeSingle();

  if (error) throw error;
  return data as any;
}

async function executeApprovedAction(admin: any, action: any, actorWorkerId: string) {
  const actionKey = String(action.action_key || "") as BrainControlledActionKey;

  if (actionKey === "probe_core_services") {
    const postgrestStarted = Date.now();
    const postgrest = await admin.from("workers").select("id", { head: true, count: "estimated" });
    const postgrestLatency = Date.now() - postgrestStarted;
    if (postgrest.error) throw postgrest.error;

    const authStarted = Date.now();
    const auth = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    const authLatency = Date.now() - authStarted;
    if (auth.error) throw auth.error;

    return {
      scope: "read_only",
      probes: [
        { name: "Supabase PostgREST", ok: true, latency_ms: postgrestLatency, estimated_workers: postgrest.count ?? null },
        { name: "Supabase Auth", ok: true, latency_ms: authLatency },
      ],
      checked_at: new Date().toISOString(),
    };
  }

  if (actionKey === "refresh_incident_lifecycle") {
    const { data, error } = await admin.rpc("brain_refresh_incident_lifecycle", {
      p_recovering_after_minutes: 5,
      p_resolve_after_minutes: 20,
    });
    if (error) throw error;

    return {
      scope: "observability_only",
      lifecycle: data,
      checked_at: new Date().toISOString(),
    };
  }

  if (actionKey === "resolve_recovered_incident") {
    const incidentId = String(action.incident_id || "");
    if (!isUuid(incidentId)) throw new Error("INCIDENT_REQUIRED");

    const { data: incident, error: incidentError } = await admin
      .from("brain_observability_events")
      .select("id,fingerprint,source,severity,subsystem,route,code,title,message,affected_node_ids,metadata,occurrences,cycle_started_at,status,last_seen_at")
      .eq("id", incidentId)
      .maybeSingle();

    if (incidentError) throw incidentError;
    if (!incident) throw new Error("INCIDENT_NOT_FOUND");
    if (incident.status !== "recovering") throw new Error("INCIDENT_NOT_RECOVERING");

    const reason = cleanText(action.input?.reason, 500);
    if (!reason) throw new Error("RESOLUTION_REASON_REQUIRED");

    const now = new Date().toISOString();
    const { data: resolved, error: resolveError } = await admin
      .from("brain_observability_events")
      .update({
        status: "resolved",
        resolved_at: now,
        resolved_reason: reason,
        resolved_by: `brain_action:${actorWorkerId}`,
        updated_at: now,
      })
      .eq("id", incidentId)
      .eq("status", "recovering")
      .select("id,status,resolved_at")
      .maybeSingle();

    if (resolveError) throw resolveError;
    if (!resolved) throw new Error("INCIDENT_STATE_CHANGED");

    const metadata = incident.metadata && typeof incident.metadata === "object" ? incident.metadata : {};
    const history = await admin.from("brain_observability_history").insert({
      event_id: incident.id,
      fingerprint: incident.fingerprint,
      event_type: "resolved",
      status_after: "resolved",
      source: incident.source,
      severity: incident.severity,
      subsystem: incident.subsystem,
      route: incident.route,
      code: incident.code,
      title: incident.title,
      message: incident.message,
      affected_node_ids: incident.affected_node_ids || [],
      occurrences_snapshot: incident.occurrences || 1,
      cycle_started_at: incident.cycle_started_at,
      deployment_commit: (metadata as any)?.deployment_commit || process.env.VERCEL_GIT_COMMIT_SHA || null,
      deployment_url: (metadata as any)?.deployment_url || process.env.VERCEL_URL || null,
      deployment_env: (metadata as any)?.deployment_env || process.env.VERCEL_ENV || null,
      metadata: {
        ...metadata,
        manual_resolution: true,
        controlled_action_id: action.id,
        resolution_reason: reason,
      },
      occurred_at: now,
    });

    if (history.error) console.error("[cerebro:actions:incident-history]", history.error);

    return {
      scope: "observability_only",
      incident_id: incident.id,
      previous_status: "recovering",
      status: "resolved",
      reason,
      resolved_at: now,
    };
  }

  throw new Error("ACTION_NOT_ALLOWED");
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, noStore(gate.error === "FORBIDDEN" ? 403 : 401));
    }

    const admin = gate.admin;
    const [actionsResult, historyResult, recoveringResult, snapshotResult] = await Promise.all([
      admin.from("brain_controlled_actions").select(ACTION_SELECT).order("created_at", { ascending: false }).limit(30),
      admin
        .from("brain_controlled_action_history")
        .select("id,action_id,event_type,status_after,actor_worker_id,details,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("brain_observability_events")
        .select("id,title,severity,subsystem,route,code,occurrences,last_seen_at,status,affected_node_ids")
        .eq("status", "recovering")
        .order("last_seen_at", { ascending: false })
        .limit(8),
      admin
        .from("brain_health_snapshots")
        .select("generated_at,duration_ms,healthy_nodes,attention_nodes,error_nodes,total_nodes,details")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (actionsResult.error) {
      if (storageMissing(actionsResult.error)) {
        return NextResponse.json({ ok: false, error: "CEREBRO_ACTIONS_STORAGE_MISSING" }, noStore(503));
      }
      throw actionsResult.error;
    }
    if (historyResult.error && !storageMissing(historyResult.error)) throw historyResult.error;
    if (recoveringResult.error) throw recoveringResult.error;
    if (snapshotResult.error) throw snapshotResult.error;

    return NextResponse.json(
      {
        ok: true,
        catalogue: brainControlledActionCatalogue,
        approval_ttl_minutes: BRAIN_ACTION_APPROVAL_TTL_MINUTES,
        actions: actionsResult.data || [],
        history: historyResult.data || [],
        recovering_incidents: recoveringResult.data || [],
        latest_snapshot: snapshotResult.data || null,
        safety: {
          business_mutations_enabled: BRAIN_PROFESSIONAL_SAFETY.businessMutationsEnabled,
          external_deployments_enabled: BRAIN_PROFESSIONAL_SAFETY.externalDeploymentsEnabled,
          destructive_actions_enabled: BRAIN_PROFESSIONAL_SAFETY.destructiveActionsEnabled,
          schema_changes_enabled: BRAIN_PROFESSIONAL_SAFETY.schemaChangesEnabled,
          mode: "professional_active",
          professional_mode_enabled: BRAIN_PROFESSIONAL_MODE.enabled,
          auto_execute_low_risk: true,
          human_approval_medium_risk: true,
          tick_interval_ms: BRAIN_PROFESSIONAL_MODE.tickIntervalMs,
        },
      },
      noStore()
    );
  } catch (error) {
    console.error("[cerebro:actions:get]", error);
    return NextResponse.json({ ok: false, error: safeError(error) }, noStore(500));
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, noStore(gate.error === "FORBIDDEN" ? 403 : 401));
    }

    const admin = gate.admin;
    const actorWorkerId = String(gate.me.id);
    const body = await req.json().catch(() => ({}));
    const operation = cleanText(body?.operation, 32);

    if (operation === "propose") {
      const spec = getBrainControlledActionSpec(cleanText(body?.action_key, 80));
      if (!spec) return NextResponse.json({ ok: false, error: "ACTION_NOT_ALLOWED" }, noStore(400));

      const targetNodeId = cleanText(body?.target_node_id, 40) || null;
      if (targetNodeId && !BRAIN_NODE_IDS.has(targetNodeId)) {
        return NextResponse.json({ ok: false, error: "INVALID_TARGET_NODE" }, noStore(400));
      }

      const incidentId = cleanText(body?.incident_id, 64) || null;
      const diagnosticId = cleanText(body?.diagnostic_id, 120) || null;
      const reason = cleanText(body?.reason, 500);
      const requestId = isUuid(body?.request_id) ? String(body.request_id) : randomUUID();

      if (spec.requiresIncident && !isUuid(incidentId)) {
        return NextResponse.json({ ok: false, error: "INCIDENT_REQUIRED" }, noStore(400));
      }
      if (spec.requiresReason && !reason) {
        return NextResponse.json({ ok: false, error: "REASON_REQUIRED" }, noStore(400));
      }

      if (spec.key === "resolve_recovered_incident") {
        const { data: incident, error } = await admin
          .from("brain_observability_events")
          .select("id,status")
          .eq("id", incidentId)
          .maybeSingle();
        if (error) throw error;
        if (!incident) return NextResponse.json({ ok: false, error: "INCIDENT_NOT_FOUND" }, noStore(404));
        if (incident.status !== "recovering") {
          return NextResponse.json({ ok: false, error: "INCIDENT_NOT_RECOVERING" }, noStore(409));
        }
      }

      const trigger = cleanText(body?.trigger, 32) === "professional" ? "professional" : "manual";
      const input = {
        reason: reason || null,
        requested_from: trigger === "professional" ? "admin_cerebro_professional" : "admin_cerebro",
        trigger,
        requested_at: new Date().toISOString(),
      };

      const { data, error } = await admin
        .from("brain_controlled_actions")
        .insert({
          request_id: requestId,
          action_key: spec.key,
          status: "proposed",
          risk_level: spec.risk,
          title: spec.title,
          target_node_id: targetNodeId,
          incident_id: incidentId,
          diagnostic_id: diagnosticId,
          input,
          requested_by_worker_id: actorWorkerId,
          updated_at: new Date().toISOString(),
        })
        .select(ACTION_SELECT)
        .single();

      if (error) {
        if (storageMissing(error)) {
          return NextResponse.json({ ok: false, error: "CEREBRO_ACTIONS_STORAGE_MISSING" }, noStore(503));
        }
        if (String(error.code || "") === "23505") {
          const existing = await admin
            .from("brain_controlled_actions")
            .select(ACTION_SELECT)
            .eq("request_id", requestId)
            .maybeSingle();
          if (existing.error) throw existing.error;
          return NextResponse.json({ ok: true, action: existing.data, idempotent: true }, noStore());
        }
        throw error;
      }

      await appendHistory(admin, data.id, "proposed", "proposed", actorWorkerId, { action_key: spec.key });
      return NextResponse.json({ ok: true, action: data }, noStore(201));
    }

    const actionId = cleanText(body?.action_id, 64);
    if (!isUuid(actionId)) return NextResponse.json({ ok: false, error: "ACTION_ID_REQUIRED" }, noStore(400));

    if (operation === "approve") {
      const current = await loadAction(admin, actionId);
      if (!current) return NextResponse.json({ ok: false, error: "ACTION_NOT_FOUND" }, noStore(404));
      if (current.status !== "proposed") {
        return NextResponse.json({ ok: false, error: "ACTION_NOT_PROPOSED" }, noStore(409));
      }

      const approvedAt = new Date();
      const expiresAt = new Date(approvedAt.getTime() + BRAIN_ACTION_APPROVAL_TTL_MINUTES * 60_000);
      const { data, error } = await admin
        .from("brain_controlled_actions")
        .update({
          status: "approved",
          approved_by_worker_id: actorWorkerId,
          approved_at: approvedAt.toISOString(),
          approval_expires_at: expiresAt.toISOString(),
          updated_at: approvedAt.toISOString(),
        })
        .eq("id", actionId)
        .eq("status", "proposed")
        .select(ACTION_SELECT)
        .maybeSingle();

      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "ACTION_STATE_CHANGED" }, noStore(409));
      await appendHistory(admin, actionId, "approved", "approved", actorWorkerId, { expires_at: expiresAt.toISOString() });
      return NextResponse.json({ ok: true, action: data }, noStore());
    }

    if (operation === "cancel") {
      const current = await loadAction(admin, actionId);
      if (!current) return NextResponse.json({ ok: false, error: "ACTION_NOT_FOUND" }, noStore(404));
      if (!new Set(["proposed", "approved"]).has(String(current.status))) {
        return NextResponse.json({ ok: false, error: "ACTION_CANNOT_BE_CANCELLED" }, noStore(409));
      }

      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("brain_controlled_actions")
        .update({ status: "cancelled", cancelled_at: now, updated_at: now })
        .eq("id", actionId)
        .in("status", ["proposed", "approved"])
        .select(ACTION_SELECT)
        .maybeSingle();

      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "ACTION_STATE_CHANGED" }, noStore(409));
      await appendHistory(admin, actionId, "cancelled", "cancelled", actorWorkerId);
      return NextResponse.json({ ok: true, action: data }, noStore());
    }

    if (operation === "execute") {
      const current = await loadAction(admin, actionId);
      if (!current) return NextResponse.json({ ok: false, error: "ACTION_NOT_FOUND" }, noStore(404));
      if (current.status !== "approved") {
        return NextResponse.json({ ok: false, error: "ACTION_NOT_APPROVED" }, noStore(409));
      }

      const expiresAt = new Date(String(current.approval_expires_at || "")).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
        const now = new Date().toISOString();
        await admin
          .from("brain_controlled_actions")
          .update({ status: "cancelled", cancelled_at: now, error: "APPROVAL_EXPIRED", updated_at: now })
          .eq("id", actionId)
          .eq("status", "approved");
        await appendHistory(admin, actionId, "approval_expired", "cancelled", actorWorkerId);
        return NextResponse.json({ ok: false, error: "APPROVAL_EXPIRED" }, noStore(409));
      }

      const startedAt = new Date().toISOString();
      const transition = await admin
        .from("brain_controlled_actions")
        .update({
          status: "executing",
          execution_started_at: startedAt,
          executed_by_worker_id: actorWorkerId,
          updated_at: startedAt,
        })
        .eq("id", actionId)
        .eq("status", "approved")
        .select(ACTION_SELECT)
        .maybeSingle();

      if (transition.error) throw transition.error;
      if (!transition.data) return NextResponse.json({ ok: false, error: "ACTION_STATE_CHANGED" }, noStore(409));
      await appendHistory(admin, actionId, "execution_started", "executing", actorWorkerId);

      try {
        const result = await executeApprovedAction(admin, transition.data, actorWorkerId);
        const finishedAt = new Date().toISOString();
        const complete = await admin
          .from("brain_controlled_actions")
          .update({
            status: "succeeded",
            result,
            error: null,
            executed_at: finishedAt,
            updated_at: finishedAt,
          })
          .eq("id", actionId)
          .eq("status", "executing")
          .select(ACTION_SELECT)
          .maybeSingle();

        if (complete.error) throw complete.error;
        await appendHistory(admin, actionId, "execution_succeeded", "succeeded", actorWorkerId, { result });
        return NextResponse.json({ ok: true, action: complete.data, result }, noStore());
      } catch (executionError) {
        const finishedAt = new Date().toISOString();
        const message = safeError(executionError);
        await admin
          .from("brain_controlled_actions")
          .update({ status: "failed", error: message, executed_at: finishedAt, updated_at: finishedAt })
          .eq("id", actionId)
          .eq("status", "executing");
        await appendHistory(admin, actionId, "execution_failed", "failed", actorWorkerId, { error: message });
        return NextResponse.json({ ok: false, error: message }, noStore(409));
      }
    }

    return NextResponse.json({ ok: false, error: "INVALID_OPERATION" }, noStore(400));
  } catch (error) {
    console.error("[cerebro:actions:post]", error);
    return NextResponse.json({ ok: false, error: safeError(error) }, noStore(500));
  }
}
