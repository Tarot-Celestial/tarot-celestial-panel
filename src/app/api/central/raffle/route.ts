import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_SELECT = "id,nombre,apellido,telefono,telefono_normalizado,email,auth_user_id";
const RAFFLE_SELECT = "id,title,status,max_number,created_at,updated_at";
const HISTORY_PAGE_SIZE = 20;
const noStore = { "Cache-Control": "no-store" };
class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function failed(error: unknown) {
  const e = error as { code?: string; message?: string };
  const status = error instanceof RequestError ? error.status
    : e.code === "42501" ? 403 : ["P0001", "23505"].includes(e.code || "") ? 409 : 503;
  const message = error instanceof RequestError ? error.message
    : e.code === "P0001" ? e.message
    : e.code === "23505" ? "El número ya está utilizado o el sorteo ha cambiado. Actualiza antes de continuar."
    : e.code === "42501" ? "No tienes permiso para esta acción."
    : "No se pudo completar la operación. Actualiza antes de reintentar.";
  return NextResponse.json({ ok: false, error: message }, { status, headers: noStore });
}

function digitsOnly(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function requireCentral(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new RequestError("Vuelve a iniciar sesión.", 401);
  const admin = getServiceClient();
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new RequestError("Tu sesión ha caducado.", 401);
  const result = await admin
    .from("workers")
    .select("id,role,display_name,email,is_active")
    .eq("user_id", auth.data.user.id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.is_active === false || !["central", "admin"].includes(result.data.role)) {
    throw new RequestError("No tienes permiso para gestionar sorteos.", 403);
  }
  return { admin, worker: result.data };
}

async function getOrCreateActiveRaffle(admin: ReturnType<typeof getServiceClient>, workerId: string) {
  const current = await admin
    .from("raffles")
    .select("id,title,status,max_number,created_at,updated_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (current.error) throw current.error;
  if (current.data) return current.data;

  const created = await admin
    .from("raffles")
    .insert({ title: "Sorteo actual", status: "active", max_number: 40, created_by_worker_id: workerId })
    .select("id,title,status,max_number,created_at,updated_at")
    .single();
  if (!created.error) return created.data;
  if (created.error.code !== "23505") throw created.error;

  const concurrent = await admin
    .from("raffles")
    .select("id,title,status,max_number,created_at,updated_at")
    .eq("status", "active")
    .limit(1)
    .single();
  if (concurrent.error) throw concurrent.error;
  return concurrent.data;
}

async function loadEntries(admin: ReturnType<typeof getServiceClient>, raffleId: string) {
  const entries: any[] = [];
  let expected: number | null = null;
  // Do not silently truncate the wheel at the Data API's page limit.
  while (entries.length < 10000) {
    const result = await admin
      .from("raffle_entries")
      .select("id,raffle_id,raffle_number,client_id,assigned_at,client:crm_clientes!raffle_entries_client_id_fkey(id,nombre,apellido,telefono,telefono_normalizado,email)", { count: "exact" })
      .eq("raffle_id", raffleId)
      .order("raffle_number", { ascending: true })
      .range(entries.length, entries.length + 999);
    if (result.error) throw result.error;
    if (result.count === null || (expected !== null && result.count !== expected)) {
      throw new Error("Las participaciones han cambiado. Actualiza el sorteo antes de girar.");
    }
    expected = result.count;
    const page = result.data || [];
    entries.push(...page);
    if (entries.length === expected) return entries;
    if (!page.length || entries.length > expected) break;
  }
  throw new Error("No se pudo cargar la lista completa de participaciones. Actualiza antes de girar.");
}

export async function GET(req: Request) {
  try {
    const gate = await requireCentral(req);

    const url = new URL(req.url);
    if (url.searchParams.get("history") === "1") {
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new RequestError("Página de historial inválida.");
      const result = await gate.admin.from("raffles").select(RAFFLE_SELECT).eq("status", "closed")
        .order("updated_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + HISTORY_PAGE_SIZE);
      if (result.error) throw result.error;
      const rows = result.data || [];
      return NextResponse.json({ ok: true,
        history: rows.slice(0, HISTORY_PAGE_SIZE).map(r => ({ ...r, closed_at: r.updated_at })),
        hasMore: rows.length > HISTORY_PAGE_SIZE,
      }, { headers: noStore });
    }
    const historyId = url.searchParams.get("raffle_id");
    if (historyId !== null) {
      if (!isUuid(historyId)) throw new RequestError("Sorteo inválido.");
      const old = await gate.admin.from("raffles").select(RAFFLE_SELECT).eq("id", historyId).eq("status", "closed").maybeSingle();
      if (old.error) throw old.error;
      if (!old.data) throw new RequestError("No encontramos este sorteo en el historial.", 404);
      const [entries, prizes] = await Promise.all([
        loadEntries(gate.admin, historyId),
        gate.admin.from("raffle_prizes")
          .select("id,position,name,candidate_number,confirmed_at,selected_at,selection_method,is_test,simulation_only")
          .eq("raffle_id", historyId).order("position", { ascending: true }),
      ]);
      if (prizes.error) throw prizes.error;
      return NextResponse.json({ ok: true, raffle: { ...old.data, closed_at: old.data.updated_at }, entries,
        prizes: prizes.data || [], readOnly: true }, { headers: noStore });
    }
    const search = digitsOnly(url.searchParams.get("search"));
    if (search) {
      if (search.length < 4) return NextResponse.json({ ok: true, clients: [] }, { headers: noStore });
      const tail = search.slice(-9);
      const result = await gate.admin
        .from("crm_clientes")
        .select(CLIENT_SELECT)
        .or(`telefono.ilike.%${tail}%,telefono_normalizado.ilike.%${tail}%`)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (result.error) throw result.error;
      return NextResponse.json({
        ok: true,
        clients: (result.data || []).map((client: any) => ({
          id: client.id,
          name: [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Cliente sin nombre",
          phone: client.telefono || client.telefono_normalizado || "",
          email: client.email || null,
          auth_user_id: client.auth_user_id || null,
        })),
      }, { headers: noStore });
    }

    const raffle = await getOrCreateActiveRaffle(gate.admin, gate.worker.id);
    const entries = await loadEntries(gate.admin, raffle.id);
    return NextResponse.json({ ok: true, raffle, entries }, { headers: noStore });
  } catch (error) { return failed(error); }
}

export async function POST(req: Request) {
  try {
    const gate = await requireCentral(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || !isUuid(body.raffle_id)) {
      throw new RequestError("Actualiza el panel antes de gestionar el sorteo.");
    }
    const action = body.action;
    if (!["assign", "extend", "reset"].includes(action)) throw new RequestError("Acción inválida.");
    const data: Record<string, unknown> = {};
    if (action === "assign") {
      if (!Number.isSafeInteger(body.raffle_number) || body.raffle_number < 1 || body.raffle_number > 10000 || !isUuid(body.client_id)) {
        throw new RequestError("Número o cliente inválido.");
      }
      Object.assign(data, { raffle_number: body.raffle_number, client_id: body.client_id });
    } else if (action === "reset") {
      if (body.confirmed !== true || !isUuid(body.request_id)) {
        throw new RequestError("Confirma el reinicio del sorteo antes de continuar.");
      }
      Object.assign(data, { confirmed: true, request_id: body.request_id });
    }
    const result = await gate.admin.rpc("tc_raffle_manage", {
      p_raffle: body.raffle_id, p_worker: gate.worker.id, p_action: action, p_data: data,
    });
    if (result.error) throw result.error;
    if (action === "reset") {
      // A retry must not wipe entries added since the first response, nor reopen a later closed raffle.
      const current = await gate.admin.from("raffles").select(RAFFLE_SELECT).eq("status", "active").single();
      if (current.error) throw current.error;
      return NextResponse.json({ ok: true, raffle: current.data, entries: await loadEntries(gate.admin, current.data.id),
        already_reset: result.data.already_reset === true, restarted_raffle_id: result.data.raffle.id,
      }, { headers: noStore });
    }
    return NextResponse.json({ ok: true, ...result.data }, { headers: noStore });
  } catch (error) { return failed(error); }
}
