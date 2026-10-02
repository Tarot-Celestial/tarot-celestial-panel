import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function failure(error: any) {
  const message = String(error?.message || "No se pudo completar la operación.");
  const messages: Record<string, string> = {
    CONFIG_CONFLICT: "Otra sesión ha guardado cambios. Actualiza antes de editar de nuevo.",
    TRAMOS_SOLAPADOS: "Este tramo se solapa con otro tramo activo de la misma moneda.",
    BONUS_INVALID: "Introduce un beneficio positivo y cantidades enteras.",
    INVALID_DATES: "La fecha final debe ser posterior a la inicial.",
    ADMIN_REQUIRED: "Acceso reservado a administración.",
  };
  const code = Object.keys(messages).find(k => message.includes(k));
  return NextResponse.json({ ok: false, error: code ? messages[code] : message }, { status: code === "ADMIN_REQUIRED" ? 403 : code ? 409 : 500, headers });
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403, headers });
    const url = new URL(req.url);
    const page = Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0));
    const clientId = url.searchParams.get("client_id");
    let eventQuery = gate.admin.from("tc_client_benefit_events").select("*").neq("benefit_type", "processed").order("created_at", { ascending: false }).order("id").range(page * 50, page * 50 + 50);
    if (clientId) eventQuery = eventQuery.eq("cliente_id", clientId);
    const results = await Promise.all([
      gate.admin.from("tc_client_rank_benefits").select("*").order("sort_order"),
      gate.admin.from("tc_client_purchase_bands").select("*").order("currency").order("min_amount"),
      gate.admin.from("tc_client_promotions").select("*").eq("promotion_kind", "rank_bonus").order("created_at", { ascending: false }),
      eventQuery,
      gate.admin.from("tc_client_benefit_audit").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const events = results[3].data || [];
    const ids = [...new Set(events.map(e => e.cliente_id))];
    const clients = ids.length ? await gate.admin.from("crm_clientes").select("id,nombre,apellido").in("id", ids) : { data: [], error: null };
    if (clients.error) throw clients.error;
    const names = new Map((clients.data || []).map(c => [c.id, [c.nombre,c.apellido].filter(Boolean).join(" ")]));
    const actors = [...new Set((results[4].data || []).map(a => a.actor_user_id).filter(Boolean))];
    const staff = actors.length ? await gate.admin.from("workers").select("user_id,display_name,email").in("user_id", actors) : { data: [], error: null };
    if (staff.error) throw staff.error;
    const actorNames = new Map((staff.data || []).map(w => [w.user_id,w.display_name || w.email]));
    return NextResponse.json({ ok: true, ranks: results[0].data, bands: results[1].data, bonuses: results[2].data,
      events: events.slice(0,50).map(e => ({ ...e, client_name: names.get(e.cliente_id) || e.cliente_id })),
      has_more: events.length > 50, page,
      audit: (results[4].data || []).map(a => ({ ...a, actor_name: actorNames.get(a.actor_user_id) || "Migración / sistema" })),
    }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403, headers });
    const body = await req.json();
    if (!["rank", "band", "bonus"].includes(body?.action) || !body?.data || typeof body.data !== "object") {
      return NextResponse.json({ ok: false, error: "Configuración no válida." }, { status: 400, headers });
    }
    if (body.action === "bonus") {
      const d = body.data;
      if (!String(d.name || "").trim() || String(d.name).length > 160 || String(d.description || "").length > 2000) throw new Error("Título o descripción no válidos.");
      if (d.image_url && !/^https:\/\/[^\s]+$|^\/(?!\/)[^\s]*$/i.test(d.image_url)) throw new Error("La imagen debe ser una URL HTTPS o una ruta del sitio.");
      if (!d.active_until_disabled && !d.ends_at) throw new Error("Indica cuándo termina el bono o activa «Hasta desactivar».");
      for (const k of ["coins","minutes","oracle_credits"]) {
        const value = Number(d.benefit?.[k] || 0);
        if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new Error("BONUS_INVALID");
      }
    }
    const { data, error } = await gate.admin.rpc("tc_save_rank_benefit_config", {
      p_actor: gate.me.user_id, p_action: body.action, p_data: body.data,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, saved: data }, { headers });
  } catch (error) { return failure(error); }
}
