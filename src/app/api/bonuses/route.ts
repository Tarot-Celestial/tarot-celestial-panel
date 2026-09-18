import { bonusAccess, loadBonusReport } from "@/lib/server/tarotista-bonuses";
import { madridTodayKey } from "@/lib/server/madrid-reporting-period";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const gate = await bonusAccess(req);
    if (gate.response) return gate.response;
    if (gate.worker.role !== "tarotista")
      return Response.json(
        { error: "Vista exclusiva de tarotista." },
        { status: 403 },
      );
    const month =
      new URL(req.url).searchParams.get("month") ||
      madridTodayKey().slice(0, 7);
    const report = await loadBonusReport(gate.db, month);
    const mine = report.workers.find((w) => w.worker_id === gate.worker.id);
    const hide = Number(gate.worker.tarotista_level || 1) === 2;
    const safeRules = report.rules
      .filter((r) => r.active)
      .map((r) => ({ ...r, reward: hide ? null : r.reward }));
    // Do not expose other workers, privileged snapshots or hidden level-2 monetary data.
    return Response.json(
      {
        ok: true,
        month,
        closed: report.closed,
        money_hidden: hide,
        rules: safeRules,
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
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[bonuses:my]", e);
    return Response.json(
      { error: "No se pudieron cargar tus bonos. Vuelve a intentarlo." },
      { status: 500 },
    );
  }
}
