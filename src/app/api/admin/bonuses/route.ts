import { bonusAccess, loadBonusReport } from "@/lib/server/tarotista-bonuses";
import { validateRule } from "@/lib/bonuses/engine";
import { madridTodayKey } from "@/lib/server/madrid-reporting-period";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const gate = await bonusAccess(req, true);
    if (gate.response) return gate.response;
    const report = await loadBonusReport(
      gate.db,
      new URL(req.url).searchParams.get("month") ||
        madridTodayKey().slice(0, 7),
    );
    return Response.json(
      { ok: true, ...report },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[bonuses:admin]", e);
    return Response.json(
      { error: "No se pudo cargar la configuración de bonos." },
      { status: 500 },
    );
  }
}
export async function POST(req: Request) {
  try {
    const gate = await bonusAccess(req, true);
    if (gate.response) return gate.response;
    const body = await req.json();
    if (body.action === "save") {
      const rule = validateRule(body.rule);
      const result = await gate.db.rpc("tarotista_bonus_save_rule", {
        p_rule: {
          ...rule,
          id: body.rule.id || null,
          version: body.rule.version || 1,
        },
        p_actor: gate.worker.id,
      });
      if (result.error) throw result.error;
      return Response.json({ ok: true, rule: result.data });
    }
    if (body.action === "void") {
      const reason = String(body.reason || "").trim();
      if (reason.length < 3 || reason.length > 2000)
        return Response.json(
          { error: "Indica el motivo de anulación (3–2000 caracteres)." },
          { status: 400 },
        );
      const result = await gate.db.rpc("tarotista_bonus_void", {
        p_award: body.award_id,
        p_actor: gate.worker.id,
        p_reason: reason,
      });
      if (result.error) throw result.error;
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Acción no válida." }, { status: 400 });
  } catch (e: any) {
    console.error("[bonuses:save]", e);
    return Response.json(
      { error: e?.message || "No se pudo guardar." },
      { status: 400 },
    );
  }
}
