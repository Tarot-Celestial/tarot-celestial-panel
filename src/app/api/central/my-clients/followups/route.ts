import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

type Worker = {
  id: string;
  user_id: string | null;
  role: string | null;
  display_name: string | null;
};

type ClientRow = Record<string, unknown> & {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  origen?: string | null;
  captured_by_worker_id?: string | null;
  responsable_worker_id?: string | null;
  assigned_worker_id?: string | null;
};

type FollowUpRow = {
  id: string;
  client_id: string;
  worker_id: string;
  created_by?: string | null;
  business?: string | null;
  contact_type?: string | null;
  reason?: string | null;
  description?: string | null;
  observations?: string | null;
  result?: string | null;
  status?: string | null;
  priority?: string | null;
  scheduled_at?: string | null;
  reminder_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type NotificationState = "pending" | "read" | "resolved";
type NotificationPriority = "urgent" | "attention" | "info";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function currentWorker(req: Request): Promise<Worker | null> {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, user_id, role, display_name")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker || !["admin", "ceo", "supervisor", "central"].includes(String(worker.role || ""))) return null;
  return worker as Worker;
}

async function clientAccess(admin: SupabaseClient, clientId: string, worker: Worker) {
  const { data: client, error } = await admin.from("crm_clientes").select("*").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return { client: null, allowed: false };
  const typedClient = client as ClientRow;
  const ownerId = String(
    typedClient.captured_by_worker_id || typedClient.responsable_worker_id || typedClient.assigned_worker_id || ""
  );
  const allowed = ["admin", "ceo", "supervisor"].includes(String(worker.role || "")) || !ownerId || ownerId === String(worker.id);
  return { client: typedClient, allowed };
}

function normalizeBusiness(value: unknown, fallback: unknown) {
  return String(value || fallback || "celestial").trim().toLowerCase();
}

function followUpDueAt(followUp: FollowUpRow) {
  return followUp.reminder_at || followUp.scheduled_at || null;
}

function followUpResolved(followUp: FollowUpRow) {
  const status = String(followUp.status || "").trim().toLowerCase();
  return ["completado", "completed", "resuelto", "resolved", "cancelado", "cancelled"].includes(status);
}

function notificationPriority(followUp: FollowUpRow, now = Date.now()): NotificationPriority {
  const rawPriority = String(followUp.priority || "").trim().toLowerCase();
  const dueAt = followUpDueAt(followUp);
  const dueTime = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  if (rawPriority === "urgente" || rawPriority === "urgent") return "urgent";
  if (Number.isFinite(dueTime) && dueTime <= now) return "urgent";
  if (
    rawPriority === "alta" ||
    rawPriority === "high" ||
    (Number.isFinite(dueTime) && dueTime - now <= 24 * 60 * 60 * 1000)
  ) {
    return "attention";
  }
  return "info";
}

function notificationState(followUp: FollowUpRow): NotificationState {
  return followUpResolved(followUp) ? "resolved" : "pending";
}

function clientName(client: ClientRow) {
  return [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Clienta";
}

async function syncFollowUpNotification(
  admin: SupabaseClient,
  followUp: FollowUpRow,
  client: ClientRow,
  createdBy: string | null
) {
  const deduplicationKey = `followup:${followUp.id}`;
  const state = notificationState(followUp);
  const priority = notificationPriority(followUp);
  const dueAt = followUpDueAt(followUp);
  const { data: existing, error: existingError } = await admin
    .from("central_notifications")
    .select("id, state, read_at")
    .eq("deduplication_key", deduplicationKey)
    .maybeSingle();

  if (existingError) throw existingError;

  const preservedState: NotificationState = state === "resolved"
    ? "resolved"
    : existing?.state === "read"
      ? "read"
      : "pending";

  const payload = {
    business: normalizeBusiness(followUp.business, client.origen),
    recipient_worker_id: followUp.worker_id,
    client_id: followUp.client_id,
    type: "followup",
    priority,
    title: priority === "urgent" ? "Seguimiento urgente" : priority === "attention" ? "Seguimiento próximo" : "Seguimiento programado",
    description: `${clientName(client)}: ${followUp.reason || followUp.description || "Seguimiento pendiente"}`,
    action_label: "Ver clienta",
    action_path: `/panel-central?tab=mis-clientas&cliente=${encodeURIComponent(followUp.client_id)}`,
    state: preservedState,
    scheduled_at: dueAt,
    read_at: preservedState === "read" ? existing?.read_at || null : preservedState === "resolved" ? new Date().toISOString() : null,
    resolved_at: state === "resolved" ? followUp.completed_at || new Date().toISOString() : null,
    deduplication_key: deduplicationKey,
    metadata: {
      followup_id: followUp.id,
      followup_status: followUp.status || "pendiente",
      followup_priority: followUp.priority || "media",
      contact_type: followUp.contact_type || null,
      reason: followUp.reason || null,
      result: followUp.result || null,
      scheduled_at: followUp.scheduled_at || null,
      reminder_at: followUp.reminder_at || null,
      worker_id: followUp.worker_id,
    },
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await admin.from("central_notifications").update(payload).eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from("central_notifications").insert(payload);
  if (error) throw error;
}

export async function GET(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const clientId = String(new URL(req.url).searchParams.get("client_id") || "").trim();
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const access = await clientAccess(admin, clientId, worker);
    if (!access.client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const { data, error } = await admin
      .from("crm_client_followups")
      .select("id, client_id, worker_id, business, contact_type, reason, description, observations, result, status, priority, scheduled_at, reminder_at, completed_at, created_at, updated_at, workers:worker_id(display_name)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({ ok: true, data: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERR_FOLLOWUPS";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = String(body.client_id || "").trim();
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const access = await clientAccess(admin, clientId, worker);
    if (!access.client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const status = String(body.status || "pendiente").trim();
    const payload = {
      client_id: clientId,
      worker_id: worker.id,
      created_by: worker.user_id,
      business: normalizeBusiness(body.business, access.client.origen),
      contact_type: String(body.contact_type || "seguimiento_general").trim(),
      reason: String(body.reason || "").trim(),
      description: String(body.description || "").trim() || null,
      observations: String(body.observations || "").trim() || null,
      result: String(body.result || "pendiente").trim(),
      status,
      priority: String(body.priority || "media").trim(),
      scheduled_at: body.scheduled_at ? String(body.scheduled_at) : null,
      reminder_at: body.reminder_at ? String(body.reminder_at) : null,
      completed_at: status.toLowerCase() === "completado" ? new Date().toISOString() : null,
    };
    if (!payload.reason) return NextResponse.json({ ok: false, error: "REASON_REQUIRED" }, { status: 400 });

    const { data, error } = await admin
      .from("crm_client_followups")
      .insert(payload)
      .select("id, client_id, worker_id, created_by, business, contact_type, reason, description, observations, result, status, priority, scheduled_at, reminder_at, completed_at, created_at, updated_at")
      .single();
    if (error) throw error;

    await syncFollowUpNotification(admin, data as FollowUpRow, access.client, worker.user_id);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERR_CREATE_FOLLOWUP";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const { data: current, error: currentError } = await admin.from("crm_client_followups").select("*").eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: false, error: "FOLLOWUP_NOT_FOUND" }, { status: 404 });
    const access = await clientAccess(admin, String(current.client_id), worker);
    if (!access.client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const updates: Record<string, string | null> = { updated_at: new Date().toISOString() };
    for (const key of ["contact_type", "reason", "description", "observations", "result", "status", "priority", "scheduled_at", "reminder_at"] as const) {
      if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key] ? String(body[key]) : null;
    }
    if (body.status === "completado" && !current.completed_at) updates.completed_at = new Date().toISOString();
    if (body.status && body.status !== "completado") updates.completed_at = null;

    const { data, error } = await admin
      .from("crm_client_followups")
      .update(updates)
      .eq("id", id)
      .select("id, client_id, worker_id, created_by, business, contact_type, reason, description, observations, result, status, priority, scheduled_at, reminder_at, completed_at, created_at, updated_at")
      .single();
    if (error) throw error;

    await syncFollowUpNotification(admin, data as FollowUpRow, access.client, worker.user_id);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERR_UPDATE_FOLLOWUP";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
