import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

type NotificationState = "pending" | "read" | "resolved";
type NotificationPriority = "urgent" | "attention" | "info" | "success" | "reward";
type NotificationSummaryRow = { id: string; priority: NotificationPriority; state: NotificationState; type: string };
type Worker = { id: string; role: string | null; user_id: string | null; display_name: string | null };
type FollowUpRow = {
  id: string;
  client_id: string;
  worker_id: string;
  created_by?: string | null;
  business?: string | null;
  contact_type?: string | null;
  reason?: string | null;
  description?: string | null;
  result?: string | null;
  status?: string | null;
  priority?: string | null;
  scheduled_at?: string | null;
  reminder_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  crm_clientes?: { nombre?: string | null; apellido?: string | null; origen?: string | null } | Array<{ nombre?: string | null; apellido?: string | null; origen?: string | null }> | null;
};
type ExistingNotification = { id: string; deduplication_key: string | null; state: NotificationState; read_at?: string | null };

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function getWorker(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) throw new Error("NO_AUTH");
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, role, user_id, display_name")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker?.id || !["central", "admin", "ceo", "supervisor"].includes(String(worker.role || ""))) {
    throw new Error("FORBIDDEN");
  }
  return { admin, worker: worker as Worker, authUserId: data.user.id };
}

function normalizeState(value: string | null): NotificationState | "all" {
  return value === "pending" || value === "read" || value === "resolved" ? value : "all";
}

function normalizePriority(value: string | null): NotificationPriority | "all" {
  return ["urgent", "attention", "info", "success", "reward"].includes(String(value))
    ? (value as NotificationPriority)
    : "all";
}

function normalizedStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function followUpResolved(row: FollowUpRow) {
  return ["completado", "completed", "resuelto", "resolved", "cancelado", "cancelled"].includes(normalizedStatus(row.status));
}

function followUpDueAt(row: FollowUpRow) {
  return row.reminder_at || row.scheduled_at || null;
}

function effectivePriority(row: FollowUpRow, now = Date.now()): NotificationPriority {
  const raw = normalizedStatus(row.priority);
  const due = followUpDueAt(row);
  const dueTime = due ? new Date(due).getTime() : Number.NaN;
  if (raw === "urgente" || raw === "urgent") return "urgent";
  if (Number.isFinite(dueTime) && dueTime <= now) return "urgent";
  if (
    raw === "alta" ||
    raw === "high" ||
    (Number.isFinite(dueTime) && dueTime - now <= 24 * 60 * 60 * 1000)
  ) {
    return "attention";
  }
  return "info";
}

function followUpClient(row: FollowUpRow) {
  const relation = row.crm_clientes;
  return Array.isArray(relation) ? relation[0] || null : relation || null;
}

function clientName(row: FollowUpRow) {
  const client = followUpClient(row);
  return [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim() || "Clienta";
}

async function synchronizeExistingFollowUps(admin: SupabaseClient, worker: Worker, business: string) {
  let followUpQuery = admin
    .from("crm_client_followups")
    .select("id, client_id, worker_id, created_by, business, contact_type, reason, description, result, status, priority, scheduled_at, reminder_at, completed_at, updated_at, crm_clientes:client_id(nombre,apellido,origen)")
    .eq("business", business)
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (!['admin', 'ceo', 'supervisor'].includes(String(worker.role || ''))) {
    followUpQuery = followUpQuery.eq("worker_id", worker.id);
  }

  const { data: followUps, error: followUpError } = await followUpQuery;
  if (followUpError) throw followUpError;
  const rows = (followUps || []) as FollowUpRow[];
  if (!rows.length) return;

  const keys = rows.map((row) => `followup:${row.id}`);
  const { data: existingRows, error: existingError } = await admin
    .from("central_notifications")
    .select("id, deduplication_key, state, read_at")
    .in("deduplication_key", keys);
  if (existingError) throw existingError;

  const existingByKey = new Map<string, ExistingNotification>();
  for (const row of (existingRows || []) as ExistingNotification[]) {
    if (row.deduplication_key) existingByKey.set(row.deduplication_key, row);
  }

  const nowIso = new Date().toISOString();
  const payloads = rows.map((row) => {
    const key = `followup:${row.id}`;
    const existing = existingByKey.get(key);
    const resolved = followUpResolved(row);
    const priority = effectivePriority(row);
    const state: NotificationState = resolved ? "resolved" : existing?.state === "read" ? "read" : "pending";
    const client = followUpClient(row);
    return {
      id: existing?.id,
      business: String(row.business || client?.origen || business || "celestial").toLowerCase(),
      recipient_worker_id: row.worker_id,
      client_id: row.client_id,
      type: "followup",
      priority,
      title: priority === "urgent" ? "Seguimiento urgente" : priority === "attention" ? "Seguimiento próximo" : "Seguimiento programado",
      description: `${clientName(row)}: ${row.reason || row.description || "Seguimiento pendiente"}`,
      action_label: "Ver clienta",
      action_path: `/panel-central?tab=mis-clientas&cliente=${encodeURIComponent(row.client_id)}`,
      state,
      scheduled_at: followUpDueAt(row),
      read_at: state === "read" ? existing?.read_at || null : resolved ? nowIso : null,
      resolved_at: resolved ? row.completed_at || nowIso : null,
      deduplication_key: key,
      metadata: {
        followup_id: row.id,
        followup_status: row.status || "pendiente",
        followup_priority: row.priority || "media",
        contact_type: row.contact_type || null,
        reason: row.reason || null,
        result: row.result || null,
        scheduled_at: row.scheduled_at || null,
        reminder_at: row.reminder_at || null,
        worker_id: row.worker_id,
      },
      created_by: row.created_by || null,
      updated_at: nowIso,
    };
  });

  const inserts = payloads.filter((payload) => !payload.id).map(({ id: _id, ...payload }) => payload);
  if (inserts.length) {
    const { error } = await admin.from("central_notifications").insert(inserts);
    if (error) throw error;
  }

  const updates = payloads.filter((payload) => Boolean(payload.id));
  if (updates.length) {
    const results = await Promise.all(
      updates.map(({ id, ...payload }) => admin.from("central_notifications").update(payload).eq("id", id as string))
    );
    const failed = results.find((result: { error: unknown | null }) => Boolean(result.error));
    if (failed?.error) throw failed.error;
  }
}

export async function GET(req: Request) {
  try {
    const { admin, worker } = await getWorker(req);
    const url = new URL(req.url);
    const business = String(url.searchParams.get("business") || "celestial").toLowerCase();
    const state = normalizeState(url.searchParams.get("state"));
    const priority = normalizePriority(url.searchParams.get("priority"));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get("page_size") || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    await synchronizeExistingFollowUps(admin, worker, business);

    let query = admin
      .from("central_notifications")
      .select(
        "id, business, recipient_worker_id, client_id, type, priority, title, description, action_label, action_path, state, scheduled_at, read_at, resolved_at, created_at, metadata, crm_clientes:client_id(id,nombre,apellido,telefono)",
        { count: "exact" }
      )
      .eq("business", business)
      .or(`recipient_worker_id.eq.${worker.id},recipient_worker_id.is.null`)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (state !== "all") query = query.eq("state", state);
    if (priority !== "all") query = query.eq("priority", priority);

    const [{ data, error, count }, { data: summaryRows, error: summaryError }] = await Promise.all([
      query,
      admin
        .from("central_notifications")
        .select("id, priority, state, type")
        .eq("business", business)
        .or(`recipient_worker_id.eq.${worker.id},recipient_worker_id.is.null`),
    ]);

    if (error) throw error;
    if (summaryError) throw summaryError;

    const rows = (summaryRows || []) as NotificationSummaryRow[];
    const summary = {
      urgent: rows.filter((row) => row.state !== "resolved" && row.priority === "urgent").length,
      risk: rows.filter((row) => row.state !== "resolved" && row.priority === "attention").length,
      reminders: rows.filter((row) => row.state !== "resolved" && ["followup", "reminder", "important_date"].includes(String(row.type || ""))).length,
      resolved: rows.filter((row) => row.state === "resolved").length,
      unread: rows.filter((row) => row.state === "pending").length,
    };

    return NextResponse.json({ ok: true, data: data || [], total: count || 0, page, page_size: pageSize, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOTIFICATIONS_LOAD_FAILED";
    const status = message === "NO_AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const { admin, worker, authUserId } = await getWorker(req);
    const body = (await req.json()) as { id?: string; action?: "read" | "resolve" | "reopen" };
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "NOTIFICATION_ID_REQUIRED" }, { status: 400 });

    const { data: current, error: currentError } = await admin
      .from("central_notifications")
      .select("id, recipient_worker_id, type, state, metadata")
      .eq("id", id)
      .or(`recipient_worker_id.eq.${worker.id},recipient_worker_id.is.null`)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: false, error: "NOTIFICATION_NOT_FOUND" }, { status: 404 });

    const metadata = current.metadata && typeof current.metadata === "object" ? current.metadata as Record<string, unknown> : {};
    const followUpId = current.type === "followup" ? String(metadata.followup_id || "").trim() : "";
    const now = new Date().toISOString();
    const updates: Record<string, string | null> = { updated_at: now };

    if (body.action === "read") {
      updates.state = "read";
      updates.read_at = now;
    } else if (body.action === "resolve") {
      if (followUpId) {
        const { error: followUpError } = await admin
          .from("crm_client_followups")
          .update({ status: "completado", result: "Seguimiento completado", completed_at: now, updated_at: now })
          .eq("id", followUpId)
          .eq("worker_id", current.recipient_worker_id || worker.id);
        if (followUpError) throw followUpError;
      }
      updates.state = "resolved";
      updates.read_at = now;
      updates.resolved_at = now;
      updates.resolved_by = authUserId;
    } else if (body.action === "reopen") {
      if (followUpId) {
        const { error: followUpError } = await admin
          .from("crm_client_followups")
          .update({ status: "pendiente", completed_at: null, updated_at: now })
          .eq("id", followUpId)
          .eq("worker_id", current.recipient_worker_id || worker.id);
        if (followUpError) throw followUpError;
      }
      updates.state = "pending";
      updates.read_at = null;
      updates.resolved_at = null;
      updates.resolved_by = null;
    } else {
      return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("central_notifications")
      .update(updates)
      .eq("id", id)
      .select("id, state, read_at, resolved_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOTIFICATION_UPDATE_FAILED";
    const status = message === "NO_AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
