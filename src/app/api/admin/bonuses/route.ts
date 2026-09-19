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
      const ruleId = body?.rule?.id ? String(body.rule.id) : null;

      // IMPORTANTE: una edición debe modificar la MISMA fila que consumen
      // /api/bonuses y el panel Tarotista. El RPC histórico podía conservar
      // una versión anterior y dejar el target visible en Administración pero
      // no en el reporte del tarotista.
      if (ruleId) {
        const current = await gate.db
          .from("tarotista_bonus_rules")
          .select("id,version")
          .eq("id", ruleId)
          .maybeSingle();
        if (current.error) throw current.error;
        if (!current.data) throw new Error("La regla que intentas editar ya no existe.");

        const nextVersion = Math.max(1, Number(current.data.version || body?.rule?.version || 1) + 1);
        const updated = await gate.db
          .from("tarotista_bonus_rules")
          .update({ ...rule, version: nextVersion })
          .eq("id", ruleId)
          .select("*")
          .single();
        if (updated.error) throw updated.error;

        // Verificación fuerte: no damos por guardado un objetivo distinto.
        if (Number(updated.data?.target) !== Number(rule.target)) {
          throw new Error("El objetivo no se guardó correctamente en la base de datos.");
        }
        return Response.json(
          { ok: true, rule: updated.data },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const inserted = await gate.db
        .from("tarotista_bonus_rules")
        .insert({ ...rule, version: 1 })
        .select("*")
        .single();
      if (inserted.error) throw inserted.error;
      return Response.json(
        { ok: true, rule: inserted.data },
        { headers: { "Cache-Control": "no-store" } },
      );
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
