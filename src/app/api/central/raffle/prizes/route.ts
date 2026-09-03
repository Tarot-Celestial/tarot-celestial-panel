import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { getAdminClient } from "@/lib/server/auth-worker";
import { eligibleEntries } from "@/features/central/raffle-wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const FIELDS = "id,raffle_id,position,name,candidate_entry_id,candidate_number,selected_at,confirmed_at";
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
class RequestError extends Error { constructor(message: string, public status = 400) { super(message); } }

async function gate(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) throw new RequestError("Vuelve a iniciar sesión.", 401);
  const admin = getAdminClient();
  // Verify the token with Auth; decoded JWT claims alone are not authorization.
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new RequestError("Tu sesión ha caducado.", 401);
  const worker = await admin.from("workers").select("id,role,is_active").eq("user_id", auth.data.user.id).maybeSingle();
  if (worker.error) throw worker.error;
  if (!worker.data || worker.data.is_active === false || !["central", "admin"].includes(worker.data.role)) throw new RequestError("No tienes permiso.", 403);
  return { admin, worker: worker.data };
}
async function active(admin: ReturnType<typeof getAdminClient>, id: string) {
  const result = await admin.from("raffles").select("id").eq("id", id).eq("status", "active").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new RequestError("El sorteo ya no está activo.", 409);
}
async function prizes(admin: ReturnType<typeof getAdminClient>, raffleId: string) {
  const result = await admin.from("raffle_prizes").select(FIELDS).eq("raffle_id", raffleId).order("position");
  if (result.error) throw result.error;
  return result.data || [];
}
async function pool(admin: ReturnType<typeof getAdminClient>, raffleId: string) {
  const rows: any[] = [];
  let expected: number | null = null;
  do {
    const result = await admin.from("raffle_entries")
      .select("id,raffle_number,client_id,client:crm_clientes!raffle_entries_client_id_fkey(nombre,apellido)", { count: "exact" })
      .eq("raffle_id", raffleId).order("raffle_number").range(rows.length, rows.length + 999);
    if (result.error) throw result.error;
    if (result.count === null || (expected !== null && result.count !== expected)) throw new RequestError("La lista cambió. Reintenta el giro.", 409);
    expected = result.count; rows.push(...(result.data || []));
    if (rows.length === expected) return eligibleEntries(rows);
    if (!result.data?.length) break;
  } while (rows.length < 10000);
  throw new RequestError("No se pudo cargar la lista completa.", 409);
}
function failed(error: any) {
  const status = error instanceof RequestError ? error.status : error?.code === "23505" ? 409 : 500;
  const message = error instanceof RequestError ? error.message
    : error?.code === "23505" ? "Otra central modificó este premio. Actualiza la lista."
    : ["42P01", "PGRST205", "PGRST202"].includes(error?.code) ? "Falta instalar el SQL de premios del sorteo."
    : "No se pudo completar la operación. Actualiza antes de reintentar.";
  return NextResponse.json({ ok: false, error: message }, { status });
}
export async function GET(req: Request) {
  try {
    const { admin } = await gate(req);
    const id = new URL(req.url).searchParams.get("raffle_id");
    if (!uuid(id)) throw new RequestError("Sorteo inválido.");
    await active(admin, id!);
    return NextResponse.json({ ok: true, prizes: await prizes(admin, id!) });
  } catch (error) { return failed(error); }
}
export async function POST(req: Request) {
  try {
    const { admin, worker } = await gate(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Solicitud inválida.");
    if (!uuid(body.raffle_id)) throw new RequestError("Sorteo inválido.");
    await active(admin, body.raffle_id);
    if (body.action === "save") {
      const position = Number(body.position), name = String(body.name || "").trim();
      if (!Number.isInteger(position) || position < 1 || position > 100 || !name || name.length > 200) throw new RequestError("Escribe un nombre de premio (máximo 200 caracteres).");
      const current = await admin.from("raffle_prizes").select(FIELDS).eq("raffle_id", body.raffle_id).eq("position", position).maybeSingle();
      if (current.error) throw current.error;
      if (current.data?.selected_at) throw new RequestError("No se puede cambiar un premio que ya tiene un número seleccionado.", 409);
      const result = current.data
        ? await admin.from("raffle_prizes").update({ name }).eq("id", current.data.id).is("selected_at", null).select(FIELDS).maybeSingle()
        : await admin.from("raffle_prizes").insert({ raffle_id: body.raffle_id, position, name }).select(FIELDS).single();
      if (result.error) throw result.error;
      if (!result.data) throw new RequestError("El premio cambió en otra central. Actualiza.", 409);
      return NextResponse.json({ ok: true, prizes: await prizes(admin, body.raffle_id) });
    }
    if (!uuid(body.prize_id)) throw new RequestError("Elige un premio guardado.");
    const current = await admin.from("raffle_prizes").select(FIELDS).eq("id", body.prize_id).eq("raffle_id", body.raffle_id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) throw new RequestError("Premio no encontrado.", 404);
    if (body.action === "draw") {
      const entries = await pool(admin, body.raffle_id);
      if (!entries.length) throw new RequestError("No hay números asignados.");
      const entry = entries[randomInt(entries.length)];
      const result = await admin.rpc("raffle_select_candidate", { p_prize: body.prize_id, p_entry: entry.id, p_worker: worker.id });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, entries, prizes: await prizes(admin, body.raffle_id) });
    }
    if (body.action === "confirm") {
      const result = await admin.rpc("raffle_confirm_winner", { p_prize: body.prize_id, p_worker: worker.id });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, prizes: await prizes(admin, body.raffle_id) });
    }
    throw new RequestError("Acción inválida.");
  } catch (error) { return failed(error); }
}
