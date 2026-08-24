import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function adminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function authenticatedWorker(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (workerError) throw workerError;
  return worker;
}

function safeInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0034")) return digits.slice(4);
  if (digits.startsWith("34") && digits.length > 9) return digits.slice(2);
  return digits;
}

function existingStatus(client: Record<string, unknown>) {
  for (const key of ["estado_actual", "estado", "status", "clasificacion"]) {
    const value = String(client[key] || "").trim();
    if (value) return value;
  }
  return null;
}
function clientIsActive(client: Record<string, unknown>) {
  if (typeof client.is_active === "boolean") return client.is_active;
  if (typeof client.activo === "boolean") return client.activo;
  const status = String(existingStatus(client) || "").toLowerCase();
  return !["inactivo", "inactive", "archivado", "archived", "baja", "deleted", "eliminado"].includes(status);
}

export async function GET(req: Request) {
  try {
    const worker = await authenticatedWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const url = new URL(req.url);
    const page = safeInt(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = safeInt(url.searchParams.get("page_size"), 10, 1, 100);
    const q = String(url.searchParams.get("q") || "").trim();
    const sort = String(url.searchParams.get("sort") || "recent");
    const view = ["active", "followup"].includes(String(url.searchParams.get("view") || "")) ? String(url.searchParams.get("view")) : "all";
    const status = String(url.searchParams.get("status") || "all").trim();
    const brand = String(url.searchParams.get("marca") || "celestial").toLowerCase() === "orion" ? "orion" : "celestial";
    const admin = adminClient();

    // Mis clientas comparte la misma cartera real que el CRM. La asignación no
    // limita la visibilidad: únicamente informa quién es la responsable actual.
    let portfolioQuery = admin.from("crm_clientes").select("*");
    if (brand === "orion") portfolioQuery = portfolioQuery.ilike("origen", "%orion%");
    else portfolioQuery = portfolioQuery.or("origen.is.null,origen.not.ilike.%orion%");
    const portfolioR = await portfolioQuery;
    if (portfolioR.error) throw portfolioR.error;
    const portfolio = portfolioR.data || [];
    const portfolioIds = portfolio.map((client: any) => String(client.id)).filter(Boolean);
    const followupsR = portfolioIds.length
      ? await admin.from("crm_client_followups").select("client_id").eq("worker_id", worker.id).is("completed_at", null).in("client_id", portfolioIds)
      : { data: [], error: null };
    if (followupsR.error) throw followupsR.error;
    const followupIds = new Set((followupsR.data || []).map((row: any) => String(row.client_id)));
    const activeIds = new Set(portfolio.filter((client: any) => clientIsActive(client)).map((client: any) => String(client.id)));

    let query = admin.from("crm_clientes").select("*", { count: "exact" });

    if (brand === "orion") {
      query = query.ilike("origen", "%orion%");
    } else {
      query = query.or("origen.is.null,origen.not.ilike.%orion%");
    }

    if (q) {
      const cleaned = q.replace(/[%(),]/g, " ").trim();
      const digits = normalizePhone(cleaned);
      if (digits) {
        const base = digits.replace(/^34/, "");
        const candidates = Array.from(new Set([digits, base, `34${base}`, `0034${base}`].filter(Boolean)));
        const phoneParts = candidates.flatMap((candidate) => [
          `telefono_normalizado.eq.${candidate}`,
          `telefono.eq.${candidate}`,
        ]);
        query = query.or(phoneParts.join(","));
      } else if (cleaned) {
        const parts = cleaned.split(/\s+/).filter(Boolean);
        const filters = [
          `nombre.ilike.%${cleaned}%`,
          `apellido.ilike.%${cleaned}%`,
          `email.ilike.%${cleaned}%`,
        ];
        if (parts.length >= 2) {
          const first = parts[0];
          const rest = parts.slice(1).join(" ");
          filters.push(`and(nombre.ilike.%${first}%,apellido.ilike.%${rest}%)`);
          filters.push(`and(nombre.ilike.%${rest}%,apellido.ilike.%${first}%)`);
        }
        query = query.or(filters.join(","));
      }
    }
    if (view === "active") query = activeIds.size ? query.in("id", Array.from(activeIds)) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    if (view === "followup") query = followupIds.size ? query.in("id", Array.from(followupIds)) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    if (status !== "all") {
      const matchingStatusIds = portfolio
        .filter((client: any) => status === "unclassified" ? !existingStatus(client) : existingStatus(client) === status)
        .map((client: any) => String(client.id));
      query = matchingStatusIds.length ? query.in("id", matchingStatusIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }

    if (sort === "oldest") query = query.order("created_at", { ascending: true, nullsFirst: false });
    else if (sort === "name") query = query.order("nombre", { ascending: true, nullsFirst: false });
    else query = query.order("updated_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: clients, error, count } = await query.range(from, to);
    if (error) throw error;

    const ids = (clients || []).map((client: any) => String(client.id)).filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ ok: true, clientes: [], total: count || 0, page, page_size: pageSize, stats: { active: activeIds.size, followup: followupIds.size } });
    }

    const [{ data: relations, error: relationsError }, { data: tags, error: tagsError }, { data: interactions, error: interactionsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      admin.from("crm_cliente_etiquetas").select("cliente_id, etiqueta_id").in("cliente_id", ids),
      admin.from("crm_etiquetas").select("id, nombre, color"),
      admin.from("crm_interacciones").select("cliente_id, created_at, cerrado_at, origen, estado").in("cliente_id", ids).order("created_at", { ascending: false }),
      admin.from("crm_client_capture_assignments").select("client_id,status,captured_by_worker_id,responsible_worker_id,captured_at,first_contact_at").in("client_id", ids),
    ]);
    if (relationsError) throw relationsError;
    if (tagsError) throw tagsError;
    if (interactionsError) throw interactionsError;
    if (assignmentsError) throw assignmentsError;

    const tagById = new Map((tags || []).map((tag: any) => [String(tag.id), { id: String(tag.id), nombre: tag.nombre, color: tag.color || null }]));
    const tagsByClient = new Map<string, Array<{ id: string; nombre: string; color: string | null }>>();
    for (const relation of relations || []) {
      const clientId = String(relation.cliente_id || "");
      const tag = tagById.get(String(relation.etiqueta_id || ""));
      if (!clientId || !tag) continue;
      const current = tagsByClient.get(clientId) || [];
      if (!current.some((item) => item.id === tag.id)) current.push(tag);
      tagsByClient.set(clientId, current);
    }

    const lastInteractionByClient = new Map<string, any>();
    for (const interaction of interactions || []) {
      const clientId = String(interaction.cliente_id || "");
      if (clientId && !lastInteractionByClient.has(clientId)) lastInteractionByClient.set(clientId, interaction);
    }

    const assignmentByClient = new Map((assignments || []).map((row: any) => [String(row.client_id), row]));
    const responsibleIds = Array.from(new Set((assignments || []).flatMap((row: any) => [row.responsible_worker_id,row.captured_by_worker_id]).filter(Boolean).map(String)));
    const workerNames = new Map<string, string>();
    if (responsibleIds.length) {
      const { data: workers, error: workersError } = await admin.from("workers").select("id, display_name").in("id", responsibleIds);
      if (workersError) throw workersError;
      for (const row of workers || []) workerNames.set(String(row.id), String(row.display_name || "").trim());
    }

    const enriched = (clients || []).map((client: any) => {
      const assignment: any = assignmentByClient.get(String(client.id)) || null;
      const responsibleId = String(assignment?.responsible_worker_id || "");
      const capturedId = String(assignment?.captured_by_worker_id || "");
      return {
        ...client,
        etiquetas: tagsByClient.get(String(client.id)) || [],
        estado_actual: existingStatus(client),
        telefonista_responsable: workerNames.get(responsibleId) || "Celestial",
        captada_por: workerNames.get(capturedId) || null,
        capture_status: assignment?.status || "pending",
        captured_at: assignment?.captured_at || null,
        ultima_conversacion: lastInteractionByClient.get(String(client.id)) || null,
      };
    });

    return NextResponse.json({
      ok: true,
      clientes: enriched,
      total: count || 0,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)),
      negocio: brand,
      stats: { active: activeIds.size, followup: followupIds.size },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_MY_CLIENTS" }, { status: 500 });
  }
}
