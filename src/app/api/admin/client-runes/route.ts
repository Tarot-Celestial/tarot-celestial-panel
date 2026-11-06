import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { isRuneUuid, parseRuneUpdate, RuneInputError, runeFailureCode } from "@/lib/client-runes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fields = "id,cliente_id,enabled,title,benefit,updated_at";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    const url = new URL(req.url), clientId = url.searchParams.get("cliente_id");
    if (clientId && !isRuneUuid(clientId)) throw new RuneInputError("Ficha no válida.");
    const q = (url.searchParams.get("q") || "").replace(/[^\p{L}\p{N}@+ .-]/gu, "").trim().slice(0, 80);
    let query = gate.admin.from("crm_clientes").select("id,nombre,apellido,email,telefono").order("updated_at", { ascending: false }).limit(80);
    if (clientId) query = query.eq("id", clientId);
    else if (q) query = query.or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,email.ilike.%${q}%,telefono.ilike.%${q}%`);
    const clients = await query;
    if (clients.error) throw clients.error;
    const ids = (clients.data || []).map(c => c.id);
    const runes = ids.length ? await gate.admin.from("client_runes").select(fields).in("cliente_id", ids) : { data: [], error: null };
    if (runes.error) throw runes.error;
    const byClient = new Map((runes.data || []).map(r => [r.cliente_id, r]));
    const history = clientId ? await gate.admin.from("client_rune_events").select("id,created_at,before_state,after_state").eq("cliente_id", clientId).order("created_at", { ascending: false }).limit(20) : { data: [], error: null };
    if (history.error) throw history.error;
    return reply({ ok: true, clients: (clients.data || []).map(c => ({ ...c, rune: byClient.get(c.id) || null })), history: history.data || [] });
  } catch (error) {
    if (error instanceof RuneInputError) return reply({ ok: false, error: error.message }, 400);
    console.error("[admin/client-runes:get]", (error as { code?: string })?.code || "QUERY_FAILED");
    return reply({ ok: false, error: "No se pudieron consultar las runas. Vuelve a intentarlo." }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    const body = parseRuneUpdate(await req.json().catch(() => null));
    const result = await gate.admin.rpc("tc_admin_set_client_rune", {
      p_cliente_id: body.cliente_id, p_enabled: body.enabled, p_title: body.title, p_benefit: body.benefit,
      p_expected_updated_at: body.expected_updated_at, p_operation_id: body.operation_id,
      p_actor_worker_id: gate.me.id, p_actor_user_id: gate.authUserId,
    });
    if (result.error) throw result.error;
    return reply({ ok: true, rune: result.data });
  } catch (error) {
    if (error instanceof RuneInputError) return reply({ ok: false, error: error.message }, 400);
    const failure = runeFailureCode(error);
    console.error("[admin/client-runes:post]", (error as { code?: string })?.code || "UPDATE_FAILED");
    return reply({ ok: false, error: failure.error }, failure.status);
  }
}
