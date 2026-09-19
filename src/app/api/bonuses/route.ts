import { bonusAccess, loadBonusReport } from "@/lib/server/tarotista-bonuses";
import { validateRule } from "@/lib/bonuses/engine";
import { madridTodayKey } from "@/lib/server/madrid-reporting-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(req: Request) {
  try {
    const gate = await bonusAccess(req);
    if (gate.response) return gate.response;

    const month =
      new URL(req.url).searchParams.get("month") ||
      madridTodayKey().slice(0, 7);
    const report = await loadBonusReport(gate.db, month);

    if (gate.worker.role === "admin") {
      return Response.json(
        { ok: true, ...report, source: "tarotista_bonus_rules" },
        { headers: noStoreHeaders },
      );
    }

    if (gate.worker.role !== "tarotista") {
      return Response.json(
        { error: "Vista exclusiva de administración o tarotista." },
        { status: 403, headers: noStoreHeaders },
      );
    }

    const mine = report.workers.find((w) => w.worker_id === gate.worker.id);
    const hide = Number(gate.worker.tarotista_level || 1) === 2;
    const currentRules = report.applicable_rules || [];

    return Response.json(
      {
        ok: true,
        month,
        closed: report.closed,
        money_hidden: hide,
        source: "tarotista_bonus_rules",
        rules: currentRules.map((r) => ({ ...r, reward: hide ? null : r.reward })),
        active_rule_ids: currentRules.map((r) => r.id),
        stats: mine
          ? { captadas_total: mine.captadas_total, positions: mine.positions }
          : null,
        progress: (mine?.progress || []).map((p: any) => ({
          ...p,
          amount: hide ? null : p.amount,
          reward: hide ? null : p.reward,
        })),
        invoice: mine?.invoice
          ? {
              status: mine.invoice.status,
              bonus_closed_at: mine.invoice.bonus_closed_at,
            }
          : null,
        awards: (mine?.awards || []).map((a: any) => ({
          id: a.id,
          name: a.reason,
          kind: a.rule_snapshot?.kind,
          amount: hide ? null : a.amount,
          status: a.status,
          created_at: a.created_at,
          invoice_month: a.invoice_month,
          void_reason: a.void_reason,
        })),
      },
      { headers: noStoreHeaders },
    );
  } catch (e) {
    console.error("[bonuses:get]", e);
    return Response.json(
      { error: "No se pudieron cargar los bonos. Vuelve a intentarlo." },
      { status: 500, headers: noStoreHeaders },
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
        const current = await gate.db
          .from("tarotista_bonus_rules")
          .select("id,version")
          .eq("id", requestedId)
          .maybeSingle();
        if (current.error) throw current.error;
        if (!current.data) throw new Error("La regla que intentas editar ya no existe.");

        const update = await gate.db
          .from("tarotista_bonus_rules")
          .update({ ...rule, version: Number(current.data.version || 1) + 1 })
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

      const verify = await gate.db
        .from("tarotista_bonus_rules")
        .select("*")
        .eq("id", saved.id)
        .single();
      if (verify.error) throw verify.error;

      return Response.json(
        { ok: true, rule: verify.data, source: "tarotista_bonus_rules" },
        { headers: noStoreHeaders },
      );
    }

    if (body.action === "toggle_active") {
      const id = String(body?.id || "").trim();
      if (!id)
        return Response.json(
          { error: "Falta el identificador de la regla." },
          { status: 400, headers: noStoreHeaders },
        );
      if (typeof body?.active !== "boolean")
        return Response.json(
          { error: "Estado de regla no válido." },
          { status: 400, headers: noStoreHeaders },
        );

      const result = await gate.db
        .from("tarotista_bonus_rules")
        .update({ active: body.active })
        .eq("id", id)
        .select("*")
        .single();
      if (result.error) throw result.error;

      return Response.json(
        { ok: true, rule: result.data, source: "tarotista_bonus_rules" },
        { headers: noStoreHeaders },
      );
    }

    if (body.action === "void") {
      const reason = String(body.reason || "").trim();
      if (reason.length < 3 || reason.length > 2000)
        return Response.json(
          { error: "Indica el motivo de anulación (3–2000 caracteres)." },
          { status: 400, headers: noStoreHeaders },
        );
      const result = await gate.db.rpc("tarotista_bonus_void", {
        p_award: body.award_id,
        p_actor: gate.worker.id,
        p_reason: reason,
      });
      if (result.error) throw result.error;
      return Response.json({ ok: true }, { headers: noStoreHeaders });
    }

    return Response.json(
      { error: "Acción no válida." },
      { status: 400, headers: noStoreHeaders },
    );
  } catch (e: any) {
    console.error("[bonuses:post]", e);
    return Response.json(
      { error: e?.message || "No se pudo guardar." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
