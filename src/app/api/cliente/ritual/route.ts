import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { loadEffectiveClientRank } from "@/lib/server/client-rank-effective";
import { loadRolling30ClientTotals } from "@/lib/server/client-ranks";
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
    const now = new Date(), since = new Date(now.getTime() - 30 * 86400000);
    const totals = await loadRolling30ClientTotals(gate.admin, [gate.cliente], since.toISOString(), now.toISOString());
    const total = totals.get(String(gate.cliente.id))?.total || 0;
    const rank = await loadEffectiveClientRank(gate.admin, String(gate.cliente.id), total);
    if (rank.effective !== "diamante") return reply({ ok: true, diamond: false, rank: rank.effective || "sin_rango", ritual: null, history: [] });
    const [active, history] = await Promise.all([
      gate.admin.from("client_rituals").select("*,ritual_types(*)").eq("cliente_id", gate.cliente.id).in("estado", ["pendiente", "activo", "pausado"]).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
      gate.admin.from("client_rituals").select("id,nombre_personalizado,estado,modo,fecha_inicio,fecha_fin_prevista,fecha_fin_real,created_at,progreso_manual,fase_manual,override_automatico,mensaje_actual,consejo_actual,ritual_types(nombre,slug,icono,descripcion,fases)").eq("cliente_id", gate.cliente.id).in("estado", ["completado", "cancelado"]).order("created_at", { ascending: false }).limit(12),
    ]);
    if (active.error) throw active.error;
    if (history.error) throw history.error;
    return reply({ ok: true, diamond: true, rank: "diamante", ritual: active.data ? computeRitual(active.data) : null, history: (history.data || []).map((row: any) => computeRitual(row)) });
  } catch (error) {
    console.error("[cliente/ritual]", error instanceof Error ? error.message : "Ritual query failed");
    return reply({ ok: false, error: "ERR_RITUAL" }, 500);
  }
}
