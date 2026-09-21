import { getAdminClient, normalizeMonthKey } from "@/lib/server/auth-worker";
import {
  aggregateRendimientoByTarotista,
  listRendimientoRowsByIso,
  listTarotistaWorkers,
} from "@/lib/server/rendimiento-metrics";
import { fullMonthComparison, madridMidnightUtc, madridTodayKey } from "@/lib/server/madrid-reporting-period";

export const TEAM_KEYS = ["fuego", "agua"] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];
export type TeamMetricKey = "team_score" | "captadas_total" | "minutes_total" | "calls_total" | "pct_cliente" | "pct_repite";

export const TEAM_FORMULA = {
  clientWeight: 1,
  repeatWeight: 1,
  capturePoints: 4,
} as const;

export type TeamWeeklyObjective = {
  id: string | null;
  week_start: string;
  team_key: TeamKey;
  metric_key: TeamMetricKey;
  title: string;
  target_value: number;
  reward_label: string;
  active: boolean;
  updated_at?: string | null;
};

type AggregateRow = ReturnType<typeof aggregateRendimientoByTarotista>[number];

function round2(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function shiftDateKey(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("INVALID_DATE_KEY");
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

export function madridWeekRange(now = new Date()) {
  const today = madridTodayKey(now);
  const middayUtc = new Date(`${today}T12:00:00.000Z`);
  const day = middayUtc.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = shiftDateKey(today, mondayOffset);
  const nextWeekStart = shiftDateKey(weekStart, 7);
  const previousWeekStart = shiftDateKey(weekStart, -7);
  return {
    weekStart,
    nextWeekStart,
    previousWeekStart,
    currentStartIso: madridMidnightUtc(weekStart).toISOString(),
    currentEndExclusiveIso: madridMidnightUtc(nextWeekStart).toISOString(),
    previousStartIso: madridMidnightUtc(previousWeekStart).toISOString(),
    previousEndExclusiveIso: madridMidnightUtc(weekStart).toISOString(),
  };
}

export function memberCompetitionPoints(row: any) {
  return round2(
    Number(row?.pct_cliente || 0) * TEAM_FORMULA.clientWeight +
      Number(row?.pct_repite || 0) * TEAM_FORMULA.repeatWeight +
      Number(row?.captadas_total || 0) * TEAM_FORMULA.capturePoints
  );
}

function teamFromRows(rows: AggregateRow[], key: TeamKey) {
  const members = rows
    .filter((row: any) => String(row.team || "").toLowerCase() === key)
    .map((row: any) => ({
      ...row,
      competition_points: memberCompetitionPoints(row),
    }))
    .sort((a: any, b: any) => Number(b.competition_points || 0) - Number(a.competition_points || 0) || String(a.display_name || "").localeCompare(String(b.display_name || ""), "es"));

  const minutesTotal = members.reduce((sum: number, row: any) => sum + Number(row.minutes_total || 0), 0);
  const minutesCliente = members.reduce((sum: number, row: any) => sum + Number(row.minutes_cliente || 0), 0);
  const minutesRepite = members.reduce((sum: number, row: any) => sum + Number(row.minutes_repite || 0), 0);
  const pctCliente = minutesTotal > 0 ? (minutesCliente / minutesTotal) * 100 : 0;
  const pctRepite = minutesTotal > 0 ? (minutesRepite / minutesTotal) * 100 : 0;
  const captadasTotal = members.reduce((sum: number, row: any) => sum + Number(row.captadas_total || 0), 0);
  const callsTotal = members.reduce((sum: number, row: any) => sum + Number(row.calls_total || 0), 0);
  const score = members.length
    ? members.reduce((sum: number, row: any) => sum + Number(row.competition_points || 0), 0) / members.length
    : 0;

  return {
    key,
    members_count: members.length,
    score: round2(score),
    pct_cliente: round2(pctCliente),
    pct_repite: round2(pctRepite),
    captadas_total: captadasTotal,
    minutes_total: round2(minutesTotal),
    calls_total: callsTotal,
    members,
  };
}

export function summarizeCompetitionTeams(rows: AggregateRow[]) {
  const teams = Object.fromEntries(TEAM_KEYS.map((key) => [key, teamFromRows(rows, key)])) as Record<TeamKey, ReturnType<typeof teamFromRows>>;
  const fuego = Number(teams.fuego.score || 0);
  const agua = Number(teams.agua.score || 0);
  const leader: TeamKey | "empate" = fuego === agua ? "empate" : fuego > agua ? "fuego" : "agua";
  return {
    teams,
    leader,
    difference: round2(Math.abs(fuego - agua)),
  };
}

export function objectiveMetricValue(team: ReturnType<typeof teamFromRows>, metricKey: TeamMetricKey) {
  if (metricKey === "team_score") return Number(team.score || 0);
  return Number((team as any)[metricKey] || 0);
}

function defaultObjective(teamKey: TeamKey, weekStart: string): TeamWeeklyObjective {
  return {
    id: null,
    week_start: weekStart,
    team_key: teamKey,
    metric_key: "captadas_total",
    title: "Objetivo semanal pendiente de configurar",
    target_value: 0,
    reward_label: "Configurable desde Admin → Equipos marcador",
    active: false,
  };
}

async function loadWeeklyObjectives(weekStart: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("team_weekly_objectives")
    .select("id, week_start, team_key, metric_key, title, target_value, reward_label, active, updated_at")
    .eq("week_start", weekStart)
    .in("team_key", [...TEAM_KEYS]);

  if (error) {
    const missingTable = String((error as any)?.code || "") === "42P01" || /team_weekly_objectives/i.test(String((error as any)?.message || ""));
    if (missingTable) return { objectives: TEAM_KEYS.map((key) => defaultObjective(key, weekStart)), table_ready: false };
    throw error;
  }

  const byTeam = new Map<string, any>((data || []).map((row: any) => [String(row.team_key), row]));
  return {
    objectives: TEAM_KEYS.map((key) => {
      const row = byTeam.get(key);
      if (!row) return defaultObjective(key, weekStart);
      return {
        id: row.id ? String(row.id) : null,
        week_start: String(row.week_start),
        team_key: key,
        metric_key: String(row.metric_key || "captadas_total") as TeamMetricKey,
        title: String(row.title || "Objetivo semanal"),
        target_value: Number(row.target_value || 0),
        reward_label: String(row.reward_label || ""),
        active: row.active !== false,
        updated_at: row.updated_at ? String(row.updated_at) : null,
      } satisfies TeamWeeklyObjective;
    }),
    table_ready: true,
  };
}

export async function buildTeamCompetitionSnapshot(monthInput?: string | null, workerId?: string | null) {
  const month = normalizeMonthKey(monthInput || madridTodayKey().slice(0, 7));
  const monthRange = fullMonthComparison(month);
  const weekRange = madridWeekRange();

  const [workers, monthlyRows, weeklyRows, previousWeeklyRows, objectiveResult] = await Promise.all([
    listTarotistaWorkers(),
    listRendimientoRowsByIso(monthRange.currentStartIso, monthRange.currentEndExclusiveIso),
    listRendimientoRowsByIso(weekRange.currentStartIso, weekRange.currentEndExclusiveIso),
    listRendimientoRowsByIso(weekRange.previousStartIso, weekRange.previousEndExclusiveIso),
    loadWeeklyObjectives(weekRange.weekStart),
  ]);

  const monthlyAggregates = aggregateRendimientoByTarotista(monthlyRows, workers);
  const weeklyAggregates = aggregateRendimientoByTarotista(weeklyRows, workers);
  const previousWeeklyAggregates = aggregateRendimientoByTarotista(previousWeeklyRows, workers);

  const monthlySummary = summarizeCompetitionTeams(monthlyAggregates);
  const weeklySummary = summarizeCompetitionTeams(weeklyAggregates);
  const previousWeeklySummary = summarizeCompetitionTeams(previousWeeklyAggregates);

  const objectives = objectiveResult.objectives.map((objective) => {
    const weeklyTeam = weeklySummary.teams[objective.team_key];
    const currentValue = objectiveMetricValue(weeklyTeam, objective.metric_key);
    const target = Math.max(0, Number(objective.target_value || 0));
    const progress = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
    return {
      ...objective,
      current_value: round2(currentValue),
      progress_pct: round2(progress),
      completed: Boolean(objective.active && target > 0 && currentValue >= target),
    };
  });

  const teams = Object.fromEntries(TEAM_KEYS.map((key) => {
    const monthlyTeam = monthlySummary.teams[key];
    const weeklyTeam = weeklySummary.teams[key];
    const previousWeekTeam = previousWeeklySummary.teams[key];
    const objective = objectives.find((item) => item.team_key === key) || null;
    return [key, {
      ...monthlyTeam,
      weekly: {
        score: weeklyTeam.score,
        pct_cliente: weeklyTeam.pct_cliente,
        pct_repite: weeklyTeam.pct_repite,
        captadas_total: weeklyTeam.captadas_total,
        minutes_total: weeklyTeam.minutes_total,
        calls_total: weeklyTeam.calls_total,
        previous_score: previousWeekTeam.score,
        delta_score: round2(Number(weeklyTeam.score || 0) - Number(previousWeekTeam.score || 0)),
      },
      objective,
    }];
  })) as Record<TeamKey, any>;

  const me = workerId ? monthlyAggregates.find((row: any) => String(row.worker_id) === String(workerId)) || null : null;
  const myTeamKey = me && TEAM_KEYS.includes(String(me.team || "").toLowerCase() as TeamKey) ? String(me.team).toLowerCase() as TeamKey : null;
  const myTeam = myTeamKey ? teams[myTeamKey] : null;
  const myMemberIndex = myTeam ? myTeam.members.findIndex((row: any) => String(row.worker_id) === String(workerId)) : -1;
  const mePayload = me ? {
    worker_id: String(me.worker_id),
    display_name: String(me.display_name || "—"),
    team: myTeamKey,
    competition_points: memberCompetitionPoints(me),
    team_position: myMemberIndex >= 0 ? myMemberIndex + 1 : null,
    captadas_total: Number(me.captadas_total || 0),
    pct_cliente: Number(me.pct_cliente || 0),
    pct_repite: Number(me.pct_repite || 0),
    minutes_total: Number(me.minutes_total || 0),
    calls_total: Number(me.calls_total || 0),
  } : null;

  return {
    month,
    week_start: weekRange.weekStart,
    week_end: shiftDateKey(weekRange.nextWeekStart, -1),
    formula: {
      label: "%Cliente + %Repite + 4 puntos por captada",
      client_weight: TEAM_FORMULA.clientWeight,
      repeat_weight: TEAM_FORMULA.repeatWeight,
      capture_points: TEAM_FORMULA.capturePoints,
    },
    teams,
    leader: monthlySummary.leader,
    difference: monthlySummary.difference,
    objectives_table_ready: objectiveResult.table_ready,
    me: mePayload,
    refreshed_at: new Date().toISOString(),
  };
}
