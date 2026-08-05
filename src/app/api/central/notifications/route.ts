import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

type NotificationState = "pending" | "read" | "resolved";
type NotificationPriority = "urgent" | "attention" | "info" | "success" | "reward";
type NotificationSummaryRow = { id: string; priority: NotificationPriority; state: NotificationState; type: string };

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
  return { admin, worker, authUserId: data.user.id };
}

function normalizeState(value: string | null): NotificationState | "all" {
  return value === "pending" || value === "read" || value === "resolved" ? value : "all";
}

function normalizePriority(value: string | null): NotificationPriority | "all" {
  return ["urgent", "attention", "info", "success", "reward"].includes(String(value))
    ? (value as NotificationPriority)
    : "all";
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
      updates.resolved_at = null;
      updates.resolved_by = null;
    } else {
      return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("central_notifications")
      .update(updates)
      .eq("id", id)
      .or(`recipient_worker_id.eq.${worker.id},recipient_worker_id.is.null`)
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
