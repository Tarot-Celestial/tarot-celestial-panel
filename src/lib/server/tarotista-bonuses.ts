import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./auth-worker";
import {
  aggregateRendimientoByTarotista,
  listRendimientoRowsByIso,
  listTarotistaWorkers,
} from "./rendimiento-metrics";
import {
  fullMonthComparison,
  madridMidnightUtc,
  madridTodayKey,
} from "./madrid-reporting-period";
import {
  applicable,
  applyStacking,
  evaluateRule,
  rankingPositions,
  validateMonth,
  type BonusRule,
} from "@/lib/bonuses/engine";

export async function bonusAccess(req: Request, adminOnly = false) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token)
    return {
      response: Response.json(
        { error: "Inicia sesión de nuevo." },
        { status: 401 },
      ),
    };
  const db = getAdminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    return {
      response: Response.json({ error: "Sesión no válida." }, { status: 401 }),
    };
  const w = await db
    .from("workers")
    .select("id,role,display_name,is_active,tarotista_level")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (w.error) throw w.error;
  if (
    !w.data ||
    w.data.is_active === false ||
    !(adminOnly ? ["admin"] : ["admin", "central", "tarotista"]).includes(
      w.data.role,
    )
  )
    return {
      response: Response.json({ error: "No tienes permiso." }, { status: 403 }),
    };
  return { db, worker: w.data };
}
export async function loadBonusRules(db: SupabaseClient) {
  const { data, error } = await db
    .from("tarotista_bonus_rules")
    .select("*")
    .order("sort_order")
    .order("id");
  if (error) throw error;
  return (data || []) as BonusRule[];
}
export async function loadBonusReport(db: SupabaseClient, month: string) {
  validateMonth(month);
  const period = fullMonthComparison(month);
  const [rules, workers, events] = await Promise.all([
    loadBonusRules(db),
    listTarotistaWorkers(),
    listRendimientoRowsByIso(
      period.currentStartIso,
      period.currentEndExclusiveIso,
    ),
  ]);
  const rows = aggregateRendimientoByTarotista(events, workers),
    today = madridTodayKey();
  const applicableRules = rules.filter((r) => applicable(r, month));
  const grouped = new Map<string, any[]>();
  const progress = new Map<string, ReturnType<typeof evaluateRule>[]>();
  for (const worker of workers) {
    progress.set(worker.id, []);
  }
  for (const rule of applicableRules) {
    const start =
      rule.start_date > `${month}-01` ? rule.start_date : `${month}-01`;
    const end =
      rule.end_date && rule.end_date < period.currentEndKey
        ? rule.end_date
        : period.currentEndKey;
    const key = `${start}:${end}`;
    if (!grouped.has(key)) {
      const begin = madridMidnightUtc(start).getTime();
      const endDate = new Date(`${end}T12:00:00Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const until = madridMidnightUtc(
        endDate.toISOString().slice(0, 10),
      ).getTime();
      grouped.set(
        key,
        aggregateRendimientoByTarotista(
          events.filter((e) => {
            const at = Date.parse(e.fecha_hora || "");
            return at >= begin && at < until;
          }),
          workers,
        ),
      );
    }
    const metricRows = grouped.get(key)!;
    for (const row of metricRows) {
      const item = evaluateRule(
        rule,
        row,
        rankingPositions(metricRows, row.worker_id),
        month,
      );
      progress.get(row.worker_id)!.push(item);
    }
  }
  const awardRows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await db
      .from("tarotista_bonus_awards")
      .select("*")
      .eq("invoice_month", month)
      .order("created_at")
      .order("id")
      .range(offset, offset + 999);
    if (result.error) throw result.error;
    awardRows.push(...(result.data || []));
    if ((result.data || []).length < 1000) break;
  }
  const invoices = await db
    .from("invoices")
    .select("id,worker_id,status,bonus_closed_at,total")
    .eq("month_key", month);
  if (invoices.error) throw invoices.error;
  return {
    month,
    rules,
    activation_month: rules.reduce(
      (earliest, r) => {
        const created = String((r as any).created_at || today).slice(0, 7);
        return created < earliest ? created : earliest;
      },
      today.slice(0, 7),
    ),
    versions: [...rules]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id, version: r.version })),
    closed: month < today.slice(0, 7),
    workers: rows.map((row) => {
      const items = applyStacking(progress.get(row.worker_id) || []);
      return {
        ...row,
        positions: rankingPositions(rows, row.worker_id),
        progress: items,
        awards: awardRows.filter((a) => a.worker_id === row.worker_id),
        invoice:
          invoices.data?.find((i) => i.worker_id === row.worker_id) || null,
      };
    }),
  };
}
export function bonusCandidates(
  report: Awaited<ReturnType<typeof loadBonusReport>>,
  workerId: string,
) {
  return (
    report.workers
      .find((w) => w.worker_id === workerId)
      ?.progress.filter((p: ReturnType<typeof evaluateRule>) => p.amount > 0) ||
    []
  );
}
