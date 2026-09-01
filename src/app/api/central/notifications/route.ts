import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { normalizeBrand, originMatchesBrand, type BrandKey } from "@/lib/server/brand-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MADRID_TIME_ZONE = "Europe/Madrid";

type NotificationState = "pending" | "read" | "resolved";
type NotificationPriority = "urgent" | "attention" | "info" | "success" | "reward";
type Worker = { id: string; role: string | null; user_id: string | null; display_name: string | null };
type ClientRef = { id?: string | null; nombre?: string | null; apellido?: string | null; telefono?: string | null; origen?: string | null };
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
  workers?: { display_name?: string | null } | Array<{ display_name?: string | null }> | null;
  crm_clientes?: ClientRef | ClientRef[] | null;
};
type StoredNotification = {
  id: string;
  business: string;
  recipient_worker_id?: string | null;
  client_id?: string | null;
  type: string;
  priority: NotificationPriority;
  title: string;
  description?: string | null;
  action_label?: string | null;
  action_path?: string | null;
  state: NotificationState;
  scheduled_at?: string | null;
  read_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  deduplication_key?: string | null;
  crm_clientes?: ClientRef | ClientRef[] | null;
};
type NotificationItem = Omit<StoredNotification, "deduplication_key"> & {
  metadata?: Record<string, unknown> | null;
};

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

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function resolvedFollowUp(row: FollowUpRow) {
  return ["completado", "completed", "resuelto", "resolved", "cancelado", "cancelled"].includes(normalized(row.status));
}

function dueAt(row: FollowUpRow) {
  return row.reminder_at || row.scheduled_at || null;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function madridDayKey(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function classifyFollowUp(row: FollowUpRow, now: number): NotificationPriority {
  const raw = normalized(row.priority);
  const date = dueAt(row);
  const dueTime = date ? new Date(date).getTime() : Number.NaN;
  if (raw === "urgente" || raw === "urgent") return "urgent";
  if (Number.isFinite(dueTime) && dueTime <= now) return "urgent";
  if (raw === "alta" || raw === "high") return "attention";
  if (Number.isFinite(dueTime) && dueTime - now <= 60 * 60 * 1000) return "attention";
  return "info";
}

function followUpToNotification(row: FollowUpRow, persisted: StoredNotification | undefined, now: number): NotificationItem {
  const client = relationOne(row.crm_clientes);
  const worker = relationOne(row.workers);
  const isResolved = resolvedFollowUp(row);
  const priority = classifyFollowUp(row, now);
  const date = dueAt(row);
  const state: NotificationState = isResolved ? "resolved" : persisted?.state === "read" ? "read" : "pending";
  const name = [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim() || "Clienta";
  const details = [row.description, row.observations].filter(Boolean).join(" · ");
  return {
    id: `followup:${row.id}`,
    business: normalizeBrand(row.business || client?.origen),
    recipient_worker_id: row.worker_id,
    client_id: row.client_id,
    type: "followup",
    priority,
    title: row.reason || (priority === "urgent" ? "Seguimiento vencido" : "Seguimiento programado"),
    description: details || `${name}: seguimiento pendiente`,
    action_label: "Ver clienta",
    action_path: `/panel-central?tab=mis-clientas&cliente=${encodeURIComponent(row.client_id)}`,
    state,
    scheduled_at: date,
    read_at: persisted?.read_at || null,
    resolved_at: isResolved ? row.completed_at || row.updated_at || null : null,
    created_at: row.created_at || row.updated_at || new Date(now).toISOString(),
    metadata: {
      followup_id: row.id,
      client_name: name,
      reason: row.reason || null,
      description: row.description || null,
      observations: row.observations || null,
      result: row.result || null,
      followup_status: row.status || "pendiente",
      followup_priority: row.priority || "media",
      contact_type: row.contact_type || null,
      scheduled_at: row.scheduled_at || null,
      reminder_at: row.reminder_at || null,
      worker_id: row.worker_id,
      worker_name: worker?.display_name || null,
    },
    crm_clientes: client ? { ...client, id: row.client_id } : { id: row.client_id },
  };
}

async function loadFollowUps(admin: SupabaseClient, worker: Worker, brand: BrandKey) {
  let query = admin
    .from("crm_client_followups")
    .select("id, client_id, worker_id, created_by, business, contact_type, reason, description, observations, result, status, priority, scheduled_at, reminder_at, completed_at, created_at, updated_at, workers:worker_id(display_name), crm_clientes:client_id(id,nombre,apellido,telefono,origen)")
    .or("reminder_at.not.is.null,scheduled_at.not.is.null")
    .order("reminder_at", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (!["admin", "ceo", "supervisor"].includes(String(worker.role || ""))) {
    query = query.eq("worker_id", worker.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as FollowUpRow[]).filter((row) => {
    const client = relationOne(row.crm_clientes);
    return originMatchesBrand(client?.origen || row.business, brand);
  });
}

async function loadStoredNotifications(admin: SupabaseClient, worker: Worker, brand: BrandKey) {
  let query = admin
    .from("central_notifications")
    .select("id, business, recipient_worker_id, client_id, type, priority, title, description, action_label, action_path, state, scheduled_at, read_at, resolved_at, created_at, metadata, deduplication_key, crm_clientes:client_id(id,nombre,apellido,telefono,origen)")
    .eq("business", brand)
    .or(`recipient_worker_id.eq.${worker.id},recipient_worker_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(1000);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as StoredNotification[];
}

async function persistFollowUpState(
  admin: SupabaseClient,
  item: NotificationItem,
  existing: StoredNotification | undefined,
  authUserId: string
) {
  const metadata = item.metadata || {};
  const payload = {
    business: item.business,
    recipient_worker_id: item.recipient_worker_id || null,
    client_id: item.client_id || null,
    type: "followup",
    priority: item.priority,
    title: item.title,
    description: item.description || null,
    action_label: item.action_label || null,
    action_path: item.action_path || null,
    state: item.state,
    scheduled_at: item.scheduled_at || null,
    read_at: item.read_at || null,
    resolved_at: item.resolved_at || null,
    deduplication_key: `followup:${String(metadata.followup_id || "")}`,
    metadata,
    created_by: authUserId,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    const { error } = await admin.from("central_notifications").update(payload).eq("id", existing.id);
    if (error) throw error;
  } else {
    // Two tabs can act on the same follow-up at nearly the same time. The
    // deduplication key is the authority, so a retry updates instead of
    // competing with another INSERT and raising 23505.
    const { error } = await admin
      .from("central_notifications")
      .upsert(payload, { onConflict: "deduplication_key" });
    if (error) throw error;
  }
}

export async function GET(req: Request) {
  try {
    const { admin, worker } = await getWorker(req);
    const url = new URL(req.url);
    const brand = normalizeBrand(url.searchParams.get("business"));
    const stateFilter = normalizeState(url.searchParams.get("state"));
    const priorityFilter = normalizePriority(url.searchParams.get("priority"));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get("page_size") || 20)));
    const now = Date.now();

    const [followUps, stored] = await Promise.all([
      loadFollowUps(admin, worker, brand),
      loadStoredNotifications(admin, worker, brand),
    ]);

    const storedFollowUps = new Map<string, StoredNotification>();
    for (const row of stored) {
      if (row.deduplication_key?.startsWith("followup:")) storedFollowUps.set(row.deduplication_key, row);
    }

    const followUpItems = followUps.map((row) => followUpToNotification(row, storedFollowUps.get(`followup:${row.id}`), now));

    const otherItems: NotificationItem[] = stored
      .filter((row) => row.type !== "followup" && !row.deduplication_key?.startsWith("followup:"))
      .map(({ deduplication_key: _key, ...row }) => row);

    let items = [...followUpItems, ...otherItems].sort((a, b) => {
      const aTime = new Date(a.scheduled_at || a.created_at).getTime();
      const bTime = new Date(b.scheduled_at || b.created_at).getTime();
      return bTime - aTime;
    });

    if (stateFilter !== "all") items = items.filter((item) => item.state === stateFilter);
    if (priorityFilter !== "all") items = items.filter((item) => item.priority === priorityFilter);

    const unresolved = [...followUpItems, ...otherItems].filter((item) => item.state !== "resolved");
    const todayKey = madridDayKey(now);
    const active = unresolved.filter((item) => {
      if (!item.scheduled_at) return item.state === "pending";
      const due = new Date(item.scheduled_at).getTime();
      return Number.isFinite(due) && due <= now;
    });
    const todayPending = unresolved.filter((item) => {
      if (!item.scheduled_at) return false;
      const due = new Date(item.scheduled_at).getTime();
      return Number.isFinite(due) && (madridDayKey(due) === todayKey || due < now);
    });

    const allRows = [...followUpItems, ...otherItems];
    const summary = {
      urgent: allRows.filter((item) => item.state !== "resolved" && item.priority === "urgent").length,
      risk: allRows.filter((item) => item.state !== "resolved" && item.priority === "attention").length,
      reminders: allRows.filter((item) => item.state !== "resolved" && ["followup", "reminder", "important_date"].includes(item.type)).length,
      information: allRows.filter((item) =>
        item.state !== "resolved" &&
        item.priority === "info" &&
        !["followup", "reminder", "important_date"].includes(item.type)
      ).length,
      pending: unresolved.length,
      resolved: allRows.filter((item) => item.state === "resolved").length,
      unread: allRows.filter((item) => item.state === "pending").length,
      active: active.length,
      today_pending: todayPending.length,
    };

    const from = (page - 1) * pageSize;
    const paged = items.slice(from, from + pageSize);
    return NextResponse.json(
      { ok: true, data: paged, total: items.length, page, page_size: pageSize, summary },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOTIFICATIONS_LOAD_FAILED";
    console.error("[central-notifications:get]", error);
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

    if (id.startsWith("followup:")) {
      const followUpId = id.slice("followup:".length);
      const { data: followUp, error: followUpError } = await admin
        .from("crm_client_followups")
        .select("id, client_id, worker_id, created_by, business, contact_type, reason, description, observations, result, status, priority, scheduled_at, reminder_at, completed_at, created_at, updated_at, workers:worker_id(display_name), crm_clientes:client_id(id,nombre,apellido,telefono,origen)")
        .eq("id", followUpId)
        .maybeSingle();
      if (followUpError) throw followUpError;
      if (!followUp) return NextResponse.json({ ok: false, error: "FOLLOWUP_NOT_FOUND" }, { status: 404 });
      if (!["admin", "ceo", "supervisor"].includes(String(worker.role || "")) && String(followUp.worker_id) !== worker.id) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }

      const now = new Date().toISOString();
      if (body.action === "resolve" || body.action === "reopen") {
        const updates = body.action === "resolve"
          ? { status: "completado", result: "Seguimiento completado", completed_at: now, updated_at: now }
          : { status: "pendiente", completed_at: null, updated_at: now };
        const { error } = await admin.from("crm_client_followups").update(updates).eq("id", followUpId);
        if (error) throw error;
        followUp.status = updates.status;
        followUp.completed_at = updates.completed_at;
        followUp.updated_at = now;
      }

      const key = `followup:${followUpId}`;
      const { data: existing, error: existingError } = await admin
        .from("central_notifications")
        .select("id, business, recipient_worker_id, client_id, type, priority, title, description, action_label, action_path, state, scheduled_at, read_at, resolved_at, created_at, metadata, deduplication_key")
        .eq("deduplication_key", key)
        .maybeSingle();
      if (existingError) throw existingError;

      const item = followUpToNotification(followUp as FollowUpRow, existing as StoredNotification | undefined, Date.now());
      if (body.action === "read") {
        item.state = "read";
        item.read_at = now;
      } else if (body.action === "resolve") {
        item.state = "resolved";
        item.read_at = now;
        item.resolved_at = now;
      } else if (body.action === "reopen") {
        item.state = "pending";
        item.read_at = null;
        item.resolved_at = null;
      } else {
        return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
      }
      await persistFollowUpState(admin, item, existing as StoredNotification | undefined, authUserId);
      return NextResponse.json({ ok: true, data: { id, state: item.state } });
    }

    const { data: current, error: currentError } = await admin
      .from("central_notifications")
      .select("id, recipient_worker_id, state")
      .eq("id", id)
      .or(`recipient_worker_id.eq.${worker.id},recipient_worker_id.is.null`)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: false, error: "NOTIFICATION_NOT_FOUND" }, { status: 404 });

    const now = new Date().toISOString();
    const updates: Record<string, string | null> = { updated_at: now };
    if (body.action === "read") {
      updates.state = "read";
      updates.read_at = now;
    } else if (body.action === "resolve") {
      updates.state = "resolved";
      updates.read_at = now;
      updates.resolved_at = now;
      updates.resolved_by = authUserId;
    } else if (body.action === "reopen") {
      updates.state = "pending";
      updates.read_at = null;
      updates.resolved_at = null;
      updates.resolved_by = null;
    } else {
      return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }
    const { data, error } = await admin.from("central_notifications").update(updates).eq("id", id).select("id, state").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOTIFICATION_UPDATE_FAILED";
    console.error("[central-notifications:patch]", error);
    const status = message === "NO_AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
