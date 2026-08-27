import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { loadClientFidelityBatch } from "@/lib/server/client-fidelity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; };
const adminClient = () => createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function requireAdmin(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const db = adminClient();
  const { data: worker, error: workerError } = await db.from("workers").select("id,role").eq("user_id", data.user.id).maybeSingle();
  if (workerError) throw workerError;
  return worker?.role === "admin" ? worker : null;
}

function safeInt(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
function cleanSearch(value: string) { return value.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim(); }

async function selectInChunks(db: ReturnType<typeof adminClient>, table: string, columns: string, column: string, ids: unknown[]) {
  const unique = Array.from(new Set(ids.map(String).filter(Boolean))); const rows: any[] = [];
  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await db.from(table).select(columns).in(column, unique.slice(index, index + 100));
    if (error) throw error; rows.push(...(data || []));
  }
  return rows;
}

async function countAssignments(db: ReturnType<typeof adminClient>, business: string, type: "corporate" | "assigned" | "xp") {
  let query = db.from("crm_client_capture_assignments").select("client_id", { count: "exact", head: true }).eq("business", business);
  if (type === "corporate") query = query.is("responsible_worker_id", null);
  if (type === "assigned") query = query.not("responsible_worker_id", "is", null);
  if (type === "xp") query = query.not("xp_event_id", "is", null);
  const { count, error } = await query;
  if (error) throw error;
  return Number(count || 0);
}

async function loadFidelityDetail(db: ReturnType<typeof adminClient>, clientId: string) {
  const [{ data: client, error: clientError }, { data: assignment, error: assignmentError }] = await Promise.all([
    db.from("crm_clientes").select("id,nombre,apellido,telefono,email,origen,created_at,captured_at,rango_actual,estado").eq("id", clientId).maybeSingle(),
    db.from("crm_client_capture_assignments").select("client_id,business,captured_at,responsible_worker_id,captured_by_worker_id,status").eq("client_id", clientId).maybeSingle(),
  ]);
  if (clientError) throw clientError;
  if (assignmentError) throw assignmentError;
  if (!client) return null;
  const capturedAt = new Map([[clientId, assignment?.captured_at || client.captured_at || client.created_at || null]]);
  const fidelity = (await loadClientFidelityBatch(db, [client], { capturedAtByClient: capturedAt })).get(clientId) || null;
  return { fidelity, state: client.estado || "Sin clasificar", business: assignment?.business || client.origen || "celestial" };
}

export async function GET(req: Request) {
  try {
    if (!await requireAdmin(req)) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    const db = adminClient();
    const url = new URL(req.url);
    const detailClientId = String(url.searchParams.get("client_id") || "").trim();
    if (detailClientId) {
      const detail = await loadFidelityDetail(db, detailClientId);
      return detail ? NextResponse.json({ ok: true, ...detail }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });
    }

    const business = url.searchParams.get("business") === "orion" ? "orion" : "celestial";
    const portfolio = String(url.searchParams.get("portfolio") || "all").trim();
    const search = cleanSearch(String(url.searchParams.get("q") || ""));
    const pageSize = safeInt(url.searchParams.get("page_size"), 25, 10, 100);
    const requestedPage = safeInt(url.searchParams.get("page"), 1, 1, 1_000_000);
    const [{ data: workers, error: workerError }, corporateCount, assignedCount, xpCount] = await Promise.all([
      db.from("workers").select("id,user_id,display_name,team,role,is_active").eq("role", "central").order("display_name"),
      countAssignments(db, business, "corporate"),
      countAssignments(db, business, "assigned"),
      countAssignments(db, business, "xp"),
    ]);
    if (workerError) throw workerError;
    const activeWorkers = (workers || []).filter((worker: any) => worker.is_active !== false && Boolean(worker.user_id));
    const activeWorkerIds = new Set(activeWorkers.map((worker: any) => String(worker.id)));
    const safePortfolio = portfolio === "all" || portfolio === "corporate" || activeWorkerIds.has(portfolio) ? portfolio : "all";

    let matchingClientIds: string[] | null = null;
    if (search) {
      const phone = search.replace(/\D/g, "");
      const filters = [
        `nombre.ilike.%${search}%`, `apellido.ilike.%${search}%`, `email.ilike.%${search}%`,
        `telefono.ilike.%${phone || search}%`, `telefono_normalizado.ilike.%${phone || search}%`,
      ].join(",");
      const { data, error } = await db.from("crm_clientes").select("id").or(filters).limit(1000);
      if (error) throw error;
      matchingClientIds = (data || []).map((row: any) => String(row.id));
    }

    let assignmentQuery = db.from("crm_client_capture_assignments").select(
      "client_id,business,created_by_worker_id,candidate_worker_id,captured_by_worker_id,responsible_worker_id,first_contact_at,captured_at,xp_event_id,status,created_at,updated_at,client:crm_clientes!crm_client_capture_assignments_client_id_fkey(id,nombre,apellido,telefono,telefono_normalizado,email,origen,created_at,updated_at,captured_at,rango_actual,estado)",
      { count: "exact" }
    ).eq("business", business).order("updated_at", { ascending: false, nullsFirst: false });
    if (safePortfolio === "corporate") assignmentQuery = assignmentQuery.is("responsible_worker_id", null);
    else if (safePortfolio !== "all") assignmentQuery = assignmentQuery.eq("responsible_worker_id", safePortfolio);
    if (matchingClientIds) {
      if (!matchingClientIds.length) return NextResponse.json({ ok: true, workers: activeWorkers, items: [], total: 0, page: 1, page_size: pageSize, total_pages: 1, business, stats: { corporate: corporateCount, assigned: assignedCount, xp: xpCount } });
      assignmentQuery = assignmentQuery.in("client_id", matchingClientIds);
    }
    const countResult = await assignmentQuery.range(0, 0);
    if (countResult.error) throw countResult.error;
    const total = Number(countResult.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const from = (page - 1) * pageSize;
    const { data: assignments, error: assignmentError } = await assignmentQuery.range(from, from + pageSize - 1);
    if (assignmentError) throw assignmentError;

    const clientIds = (assignments || []).map((row: any) => String(row.client_id));
    const eventIds = (assignments || []).map((row: any) => row.xp_event_id).filter(Boolean);
    const workerIds = (assignments || []).flatMap((row: any) => [row.captured_by_worker_id, row.responsible_worker_id]).filter(Boolean);
    const [events, audit, referencedWorkers] = await Promise.all([
      selectInChunks(db, "worker_xp_events", "id,xp_amount,status,created_at", "id", eventIds),
      selectInChunks(db, "crm_client_capture_audit", "*", "client_id", clientIds),
      selectInChunks(db, "workers", "id,display_name,team,role", "id", workerIds),
    ]);
    const workerMap = new Map([...(workers || []), ...referencedWorkers].map((worker: any) => [String(worker.id), worker]));
    const eventMap = new Map(events.map((event: any) => [String(event.id), event]));
    const auditByClient = new Map<string, any[]>();
    [...audit].sort((left: any, right: any) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()).forEach((entry: any) => {
      const key = String(entry.client_id); const current = auditByClient.get(key) || [];
      if (current.length < 20) current.push({ ...entry,
        previous_name: entry.previous_responsible_worker_id ? workerMap.get(String(entry.previous_responsible_worker_id))?.display_name || "Histórico" : "Celestial",
        new_name: entry.new_responsible_worker_id ? workerMap.get(String(entry.new_responsible_worker_id))?.display_name || "Histórico" : "Celestial",
        actor_name: entry.actor_worker_id ? workerMap.get(String(entry.actor_worker_id))?.display_name || "Admin" : "Sistema",
      });
      auditByClient.set(key, current);
    });
    const corporateOwner = { id: null, display_name: "Celestial", team: "Cartera general", role: "corporate" };
    const items = (assignments || []).map((assignment: any) => ({
      ...assignment,
      client: assignment.client,
      captured_by: workerMap.get(String(assignment.captured_by_worker_id)) || null,
      responsible: assignment.responsible_worker_id ? workerMap.get(String(assignment.responsible_worker_id)) || null : corporateOwner,
      xp_event: eventMap.get(String(assignment.xp_event_id)) || null,
      audit: auditByClient.get(String(assignment.client_id)) || [],
    }));
    return NextResponse.json({ ok: true, corporate_owner: corporateOwner, workers: activeWorkers, items, total, page, page_size: pageSize, total_pages: totalPages, business, stats: { corporate: corporateCount, assigned: assignedCount, xp: xpCount } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[admin/client-captures] load failed", { message: error?.message, code: error?.code, details: error?.details });
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_CAPTURES", code: error?.code || null }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireAdmin(req);
    if (!me) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id || "");
    const workerId = body.responsible_worker_id ? String(body.responsible_worker_id) : null;
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_REQUIRED" }, { status: 400 });
    const db = adminClient();
    if (workerId) {
      const target = await db.from("workers").select("id,user_id,role,is_active").eq("id", workerId).maybeSingle();
      if (target.error) throw target.error;
      if (!target.data || target.data.role !== "central" || target.data.is_active === false || !target.data.user_id) return NextResponse.json({ ok: false, error: "La responsable seleccionada no está conectada a una cuenta central activa." }, { status: 400 });
    }
    const { error } = await db.rpc("reassign_client_capture_responsible", { p_client_id: clientId, p_new_worker_id: workerId, p_actor_worker_id: me.id, p_reason: String(body.reason || "") });
    if (error) throw error;
    const persisted = await db.from("crm_client_capture_assignments").select("client_id,responsible_worker_id,captured_by_worker_id,business,updated_at,status").eq("client_id", clientId).maybeSingle();
    if (persisted.error) throw persisted.error;
    const actual = persisted.data?.responsible_worker_id ? String(persisted.data.responsible_worker_id) : null;
    if (actual !== workerId) throw new Error("La asignación no quedó persistida");
    return NextResponse.json({ ok: true, assignment: persisted.data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_REASSIGN_CAPTURE" }, { status: 500 });
  }
}
