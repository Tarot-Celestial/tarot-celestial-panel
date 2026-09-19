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
      const requestedId = String(body?.rule?.id || "").trim();

      let saved: any = null;

      if (requestedId) {
        // Editar significa editar ESA fila. No crear otra versión paralela.
        const current = await gate.db
          .from("tarotista_bonus_rules")
          .select("id,version")
          .eq("id", requestedId)
          .maybeSingle();
        if (current.error) throw current.error;
        if (!current.data) throw new Error("La regla que intentas editar ya no existe.");

        const update = await gate.db
          .from("tarotista_bonus_rules")
          .update({
            ...rule,
            version: Number(current.data.version || 1) + 1,
          })
          .eq("id", requestedId)
          .select("*")
          .single();
        if (update.error) throw update.error;
        saved = update.data;
      } else {
        const insert = await gate.db
          .from("tarotista_bonus_rules")
          .insert({ ...rule, version: 1 })
          .select("*")
          .single();
        if (insert.error) throw insert.error;
        saved = insert.data;
      }

      // Verificación real: devolvemos lo que está persistido en DB, no el borrador.
      const verify = await gate.db
        .from("tarotista_bonus_rules")
        .select("*")
        .eq("id", saved.id)
        .single();
      if (verify.error) throw verify.error;
      if (Number(verify.data.target) !== Number(rule.target)) {
        throw new Error(`La base de datos no guardó el objetivo solicitado (${rule.target}). Valor persistido: ${verify.data.target}.`);
      }

      return Response.json(
        { ok: true, rule: verify.data },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (body.action === "toggle_active") {
      const id = String(body?.id || "").trim();
      if (!id) return Response.json({ error: "Falta el identificador de la regla." }, { status: 400 });
      if (typeof body?.active !== "boolean")
        return Response.json({ error: "Estado de regla no válido." }, { status: 400 });

      // Cambio reversible: nunca se hace DELETE ni se toca el histórico.
      const result = await gate.db
        .from("tarotista_bonus_rules")
        .update({ active: body.active })
        .eq("id", id)
        .select("*")
        .single();
      if (result.error) throw result.error;

      return Response.json(
        { ok: true, rule: result.data },
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
