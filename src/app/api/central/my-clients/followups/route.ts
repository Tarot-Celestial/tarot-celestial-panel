import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function currentWorker(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, user_id, role, display_name")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker || !["admin", "central"].includes(String(worker.role || ""))) return null;
  return worker;
}

async function clientAccess(admin: ReturnType<typeof adminClient>, clientId: string, worker: any) {
  const { data: client, error } = await admin.from("crm_clientes").select("*").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return { client: null, allowed: false };
  const ownerId = String(client.captured_by_worker_id || client.responsable_worker_id || client.assigned_worker_id || "");
  const allowed = worker.role === "admin" || !ownerId || ownerId === String(worker.id);
  return { client, allowed };
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
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_FOLLOWUPS" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id || "").trim();
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const access = await clientAccess(admin, clientId, worker);
    if (!access.client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const payload = {
      client_id: clientId,
      worker_id: worker.id,
      created_by: worker.user_id,
      business: String(body.business || access.client.origen || "celestial").trim().toLowerCase(),
      contact_type: String(body.contact_type || "seguimiento_general").trim(),
      reason: String(body.reason || "").trim(),
      description: String(body.description || "").trim() || null,
      observations: String(body.observations || "").trim() || null,
      result: String(body.result || "pendiente").trim(),
      status: String(body.status || "pendiente").trim(),
      priority: String(body.priority || "media").trim(),
      scheduled_at: body.scheduled_at || null,
      reminder_at: body.reminder_at || null,
      completed_at: String(body.status || "") === "completado" ? new Date().toISOString() : null,
    };
    if (!payload.reason) return NextResponse.json({ ok: false, error: "REASON_REQUIRED" }, { status: 400 });

    const { data, error } = await admin
      .from("crm_client_followups")
      .insert(payload)
      .select("id, client_id, worker_id, business, contact_type, reason, description, observations, result, status, priority, scheduled_at, reminder_at, completed_at, created_at, updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CREATE_FOLLOWUP" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const admin = adminClient();
    const { data: current, error: currentError } = await admin.from("crm_client_followups").select("*").eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: false, error: "FOLLOWUP_NOT_FOUND" }, { status: 404 });
    const access = await clientAccess(admin, String(current.client_id), worker);
    if (!access.allowed) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of ["contact_type", "reason", "description", "observations", "result", "status", "priority", "scheduled_at", "reminder_at"]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key] || null;
    }
    if (body.status === "completado" && !current.completed_at) updates.completed_at = new Date().toISOString();
    if (body.status && body.status !== "completado") updates.completed_at = null;

    const { data, error } = await admin.from("crm_client_followups").update(updates).eq("id", id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_UPDATE_FOLLOWUP" }, { status: 500 });
  }
}
