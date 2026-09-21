import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";
import { buildTeamCompetitionSnapshot, TEAM_KEYS, type TeamMetricKey } from "@/lib/server/team-competition";

export const runtime = "nodejs";

const METRICS = new Set<TeamMetricKey>(["team_score", "captadas_total", "minutes_total", "calls_total", "pct_cliente", "pct_repite"]);

async function requireAdmin(req: Request) {
  const me = await workerFromRequest(req);
  if (!me || !["admin", "ceo", "supervisor"].includes(String(me.role || ""))) return null;
  return me;
}

export async function GET(req: Request) {
  try {
    const me = await requireAdmin(req);
    if (!me) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    const url = new URL(req.url);
    const snapshot = await buildTeamCompetitionSnapshot(url.searchParams.get("month"), String(me.id));
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_TEAM_SCOREBOARD" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const me = await requireAdmin(req);
    if (!me) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const teamKey = String(body?.team_key || "").toLowerCase();
    const weekStart = String(body?.week_start || "");
    const metricKey = String(body?.metric_key || "") as TeamMetricKey;
    const title = String(body?.title || "").trim();
    const rewardLabel = String(body?.reward_label || "").trim();
    const targetValue = Number(body?.target_value || 0);
    const active = body?.active !== false;

    if (!TEAM_KEYS.includes(teamKey as any)) return NextResponse.json({ ok: false, error: "INVALID_TEAM" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return NextResponse.json({ ok: false, error: "INVALID_WEEK" }, { status: 400 });
    if (!METRICS.has(metricKey)) return NextResponse.json({ ok: false, error: "INVALID_METRIC" }, { status: 400 });
    if (!title) return NextResponse.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });
    if (!Number.isFinite(targetValue) || targetValue < 0) return NextResponse.json({ ok: false, error: "INVALID_TARGET" }, { status: 400 });

    const admin = getAdminClient();
    const payload = {
      week_start: weekStart,
      team_key: teamKey,
      metric_key: metricKey,
      title,
      target_value: targetValue,
      reward_label: rewardLabel,
      active,
      updated_by_worker_id: me.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("team_weekly_objectives")
      .upsert(payload, { onConflict: "week_start,team_key" })
      .select("id, week_start, team_key, metric_key, title, target_value, reward_label, active, updated_at")
      .single();

    if (error) {
      if (String((error as any)?.code || "") === "42P01") {
        return NextResponse.json({ ok: false, error: "TEAM_WEEKLY_OBJECTIVES_TABLE_MISSING" }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true, objective: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_TEAM_OBJECTIVE_SAVE" }, { status: 500 });
  }
}
