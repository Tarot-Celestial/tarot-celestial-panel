import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { clientRankBenefits } from "@/lib/server/rank-benefits";
import { computeRitual } from "@/lib/rituals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" } });

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return reply({ ok: false, error: "NO_AUTH" }, 401);
    if (!gate.cliente) return reply({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, 404);
    const benefits = await clientRankBenefits(gate.admin, String(gate.cliente.id));
    if (!benefits.ritual_access) return reply({ ok: true, ritual_access: false, rank: benefits.rank_key, ritual: null, history: [] });
    const [active, history] = await Promise.all([
      gate.admin.from("client_rituals").select("*,ritual_types(*)").eq("cliente_id", gate.cliente.id).in("estado", ["pendiente", "activo", "pausado"]).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
      gate.admin.from("client_rituals").select("id,nombre_personalizado,estado,modo,fecha_inicio,fecha_fin_prevista,fecha_fin_real,created_at,progreso_manual,fase_manual,override_automatico,mensaje_actual,consejo_actual,ritual_types(nombre,slug,icono,descripcion,fases)").eq("cliente_id", gate.cliente.id).in("estado", ["completado", "cancelado"]).order("created_at", { ascending: false }).limit(12),
    ]);
    if (active.error) throw active.error;
    if (history.error) throw history.error;
    return reply({ ok: true, ritual_access: true, rank: benefits.rank_key, ritual: active.data ? computeRitual(active.data) : null, history: (history.data || []).map((row: any) => computeRitual(row)) });
  } catch (error) {
    console.error("[cliente/ritual]", error instanceof Error ? error.message : "Ritual query failed");
    return reply({ ok: false, error: "ERR_RITUAL" }, 500);
  }
}
