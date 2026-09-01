import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { loadClientFidelityBatch } from "@/lib/server/client-fidelity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
function adminClient() { return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); }

async function authenticatedWorker(req: Request) {
  if (!(req.headers.get("authorization") || "").startsWith("Bearer ")) return null;
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const result = await admin.from("workers").select("id,role,is_active").eq("user_id", data.user.id);
  if (result.error) throw result.error;
  const identities = (result.data || []).filter((row: any) => row?.is_active !== false);
  const worker = identities.find((row: any) => String(row?.role || "") === "central") || identities[0] || null;
  return worker ? { ...worker, identityIds: identities.map((row: any) => String(row.id)).filter(Boolean) } : null;
}

function safeInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function phoneDigits(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0034")) return digits.slice(4);
  if (digits.startsWith("34") && digits.length > 9) return digits.slice(2);
  return digits;
}
function searchableText(value: unknown) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES"); }
function existingStatus(client: Record<string, unknown>) {
  for (const key of ["estado_actual", "estado", "status", "clasificacion"]) { const value = String(client[key] || "").trim(); if (value) return value; }
  return null;
}
function clientIsActive(client: Record<string, unknown>) {
  if (typeof client.is_active === "boolean") return client.is_active;
  if (typeof client.activo === "boolean") return client.activo;
  return !["inactivo", "inactive", "archivado", "archived", "baja", "deleted", "eliminado"].includes(String(existingStatus(client) || "").toLowerCase());
}
function belongsToBrand(client: Record<string, unknown>, assignment: Record<string, unknown> | undefined, brand: "celestial" | "orion") {
  // La asignación es la fuente de verdad de la cartera. `origen` queda como
  // compatibilidad para registros históricos que todavía no tengan business.
  const source = String(assignment?.business || client.origen || "celestial").toLowerCase();
  const isOrion = source.includes("orion");
  return brand === "orion" ? isOrion : !isOrion;
}

async function selectInChunks(admin: ReturnType<typeof adminClient>, table: string, columns: string, column: string, ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean))); const rows: any[] = [];
  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await admin.from(table).select(columns).in(column, unique.slice(index, index + 100));
    if (error) throw error; rows.push(...(data || []));
  }
  return rows;
}
async function loadOwnedAssignments(admin: ReturnType<typeof adminClient>, workerIds: string[]) {
  const rows: any[] = [];
  const identities = Array.from(new Set(workerIds.filter(Boolean)));
  if (!identities.length) return rows;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("crm_client_capture_assignments")
      .select("client_id,status,business,captured_by_worker_id,responsible_worker_id,captured_at,first_contact_at,updated_at")
      .in("responsible_worker_id", identities).order("updated_at", { ascending: false, nullsFirst: false }).range(from, from + 999);
    if (error) throw error; rows.push(...(data || [])); if ((data || []).length < 1000) break;
  }
  return rows;
}

export async function GET(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const url = new URL(req.url);
    const requestedPage = safeInt(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = safeInt(url.searchParams.get("page_size"), 10, 1, 100);
    const queryText = String(url.searchParams.get("q") || "").trim();
    const sort = String(url.searchParams.get("sort") || "recent");
    const view = ["active", "followup"].includes(String(url.searchParams.get("view") || "")) ? String(url.searchParams.get("view")) : "all";
    const status = String(url.searchParams.get("status") || "all").trim();
    const brand: "celestial" = "celestial";
    const admin = adminClient();

    // La cartera se decide exclusivamente por el ID del responsable actual.
    const identityIds = Array.from(new Set([String(worker.id), ...((worker.identityIds || []) as string[])].filter(Boolean)));
    const assignments = await loadOwnedAssignments(admin, identityIds);
    const assignmentByClient = new Map(assignments.map((row: any) => [String(row.client_id), row]));
    const ownedIds = Array.from(assignmentByClient.keys());
    if (!ownedIds.length) return NextResponse.json({ ok: true, clientes: [], total: 0, page: 1, page_size: pageSize, total_pages: 1, negocio: brand, stats: { active: 0, followup: 0 } });

    const clients = await selectInChunks(admin, "crm_clientes", "*", "id", ownedIds);
    const portfolio = clients.filter((client: any) => belongsToBrand(client, assignmentByClient.get(String(client.id)), brand));
    const portfolioIds = portfolio.map((client: any) => String(client.id)).filter(Boolean);
    const followups = await selectInChunks(admin, "crm_client_followups", "client_id,worker_id,completed_at", "client_id", portfolioIds);
    const identitySet = new Set(identityIds);
    const followupIds = new Set(followups.filter((row: any) => identitySet.has(String(row.worker_id)) && !row.completed_at).map((row: any) => String(row.client_id)));
    const activeIds = new Set(portfolio.filter((client: any) => clientIsActive(client)).map((client: any) => String(client.id)));

    const normalizedQuery = searchableText(queryText.replace(/[%(),]/g, " ").trim());
    const searchedDigits = phoneDigits(queryText);
    let filtered = portfolio.filter((client: any) => {
      const clientId = String(client.id); const currentStatus = existingStatus(client);
      if (view === "active" && !activeIds.has(clientId)) return false;
      if (view === "followup" && !followupIds.has(clientId)) return false;
      if (status !== "all" && (status === "unclassified" ? Boolean(currentStatus) : currentStatus !== status)) return false;
      if (!normalizedQuery) return true;
      if (searchedDigits) {
        const phones = [phoneDigits(client.telefono), phoneDigits(client.telefono_normalizado)].filter(Boolean);
        return phones.some((phone) => phone.includes(searchedDigits) || searchedDigits.includes(phone));
      }
      return searchableText([client.nombre, client.apellido, client.email].filter(Boolean).join(" ")).includes(normalizedQuery);
    });

    filtered.sort((left: any, right: any) => {
      if (sort === "name") return searchableText(`${left.nombre || ""} ${left.apellido || ""}`).localeCompare(searchableText(`${right.nombre || ""} ${right.apellido || ""}`), "es");
      if (sort === "oldest") return new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
      const leftAssignment: any = assignmentByClient.get(String(left.id)); const rightAssignment: any = assignmentByClient.get(String(right.id));
      return new Date(rightAssignment?.updated_at || right.updated_at || right.created_at || 0).getTime() - new Date(leftAssignment?.updated_at || left.updated_at || left.created_at || 0).getTime();
    });

    const total = filtered.length; const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(requestedPage, totalPages);
    const pagedClients = filtered.slice((page - 1) * pageSize, page * pageSize); const pageIds = pagedClients.map((client: any) => String(client.id));
    const capturedAtByClient = new Map(pageIds.map((clientId) => [clientId, (assignmentByClient.get(clientId) as any)?.captured_at || null]));
    const [relations, tags, interactions, fidelityByClient] = await Promise.all([
      selectInChunks(admin, "crm_cliente_etiquetas", "cliente_id,etiqueta_id", "cliente_id", pageIds),
      pageIds.length ? admin.from("crm_etiquetas").select("id,nombre,color").then(({ data, error }) => { if (error) throw error; return data || []; }) : Promise.resolve([]),
      selectInChunks(admin, "crm_interacciones", "cliente_id,created_at,cerrado_at,origen,estado", "cliente_id", pageIds),
      loadClientFidelityBatch(admin, pagedClients, { capturedAtByClient }),
    ]);

    const tagById = new Map((tags || []).map((tag: any) => [String(tag.id), { id: String(tag.id), nombre: tag.nombre, color: tag.color || null }]));
    const tagsByClient = new Map<string, any[]>();
    for (const relation of relations || []) {
      const clientId = String(relation.cliente_id || ""); const tag: any = tagById.get(String(relation.etiqueta_id || ""));
      if (!clientId || !tag) continue; const current = tagsByClient.get(clientId) || []; if (!current.some((item) => item.id === tag.id)) current.push(tag); tagsByClient.set(clientId, current);
    }
    const lastInteractionByClient = new Map<string, any>();
    [...(interactions || [])].sort((a: any, b: any) => new Date(b.created_at || b.cerrado_at || 0).getTime() - new Date(a.created_at || a.cerrado_at || 0).getTime()).forEach((interaction: any) => {
      const clientId = String(interaction.cliente_id || ""); if (clientId && !lastInteractionByClient.has(clientId)) lastInteractionByClient.set(clientId, interaction);
    });

    const capturedIds = assignments.map((row: any) => String(row.captured_by_worker_id || "")).filter(Boolean);
    const responsibleIds = assignments.map((row: any) => String(row.responsible_worker_id || "")).filter(Boolean);
    const workerRows = await selectInChunks(admin, "workers", "id,display_name", "id", [...identityIds, ...responsibleIds, ...capturedIds]);
    const workerNames = new Map(workerRows.map((row: any) => [String(row.id), String(row.display_name || "").trim()]));
    const enriched = pagedClients.map((client: any) => {
      const assignment: any = assignmentByClient.get(String(client.id));
      return { ...client, etiquetas: tagsByClient.get(String(client.id)) || [], estado_actual: existingStatus(client), telefonista_responsable: workerNames.get(String(assignment?.responsible_worker_id || "")) || "Responsable", captada_por: workerNames.get(String(assignment?.captured_by_worker_id || "")) || null, capture_status: assignment?.status || "pending", captured_at: assignment?.captured_at || null, assigned_at: assignment?.updated_at || null, ultima_conversacion: lastInteractionByClient.get(String(client.id)) || null, fidelity: fidelityByClient.get(String(client.id)) || null };
    });

    return NextResponse.json({ ok: true, clientes: enriched, total, page, page_size: pageSize, total_pages: totalPages, negocio: brand, stats: { active: activeIds.size, followup: followupIds.size } });
  } catch (error: any) {
    console.error("[central/my-clients] cartera no disponible", { message: error?.message, code: error?.code, details: error?.details });
    return NextResponse.json({ ok: false, error: "No se pudieron cargar tus clientas.", code: "ERR_MY_CLIENTS" }, { status: 500 });
  }
}
