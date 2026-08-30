import { NextResponse } from "next/server";
import { getAdminClient, monthRange, normalizeMonthKey, workerFromRequest } from "@/lib/server/auth-worker";
import {
  aggregateRendimientoByTarotista,
  listRendimientoRows,
} from "@/lib/server/rendimiento-metrics";

export const runtime = "nodejs";

const LIVE_WINDOW_MS = 3 * 60 * 1000;
const TEAM_KEYS = ["fuego", "agua", "tierra"] as const;

type TeamKey = (typeof TEAM_KEYS)[number];

type WorkerRow = {
  id: string;
  display_name: string | null;
  role: string | null;
  team: string | null;
  is_active: boolean | null;
};

function normalizeTeam(value: unknown): TeamKey | null {
  const team = String(value || "").trim().toLowerCase();
  return TEAM_KEYS.includes(team as TeamKey) ? (team as TeamKey) : null;
}

function isRecent(value: unknown) {
  const timestamp = new Date(String(value || "")).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= LIVE_WINDOW_MS;
}

function previousMonthKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
}

function summarizeTeams(rows: any[]) {
  const teams: Record<string, any> = {};

  for (const team of TEAM_KEYS) {
    const members = rows.filter((row) => normalizeTeam(row.team) === team);
    const minutesTotal = members.reduce((sum, row) => sum + Number(row.minutes_total || 0), 0);
    const minutesCliente = members.reduce((sum, row) => sum + Number(row.minutes_cliente || 0), 0);
    const minutesRepite = members.reduce((sum, row) => sum + Number(row.minutes_repite || 0), 0);
    const pctCliente = minutesTotal ? (minutesCliente / minutesTotal) * 100 : 0;
    const pctRepite = minutesTotal ? (minutesRepite / minutesTotal) * 100 : 0;

    teams[team] = {
      key: team,
      members: members.length,
      active_members: members.map((row) => ({
        worker_id: String(row.worker_id),
        display_name: String(row.display_name || "—"),
      })),
      minutes_total: Math.round(minutesTotal * 100) / 100,
      minutes_cliente: Math.round(minutesCliente * 100) / 100,
      minutes_repite: Math.round(minutesRepite * 100) / 100,
      pct_cliente: Math.round(pctCliente * 100) / 100,
      pct_repite: Math.round(pctRepite * 100) / 100,
      score: Math.round((pctCliente + pctRepite) * 100) / 100,
    };
  }

  const ranked = TEAM_KEYS
    .map((key) => teams[key])
    .filter((team) => team.members > 0 && team.minutes_total > 0)
    .sort((a, b) => b.score - a.score || b.minutes_total - a.minutes_total);

  return {
    teams,
    leader: ranked[0]?.key || null,
  };
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["central", "admin"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get("month"));
    const previousMonth = previousMonthKey(month);
    const currentRange = monthRange(month);
    const previousRange = monthRange(previousMonth);
    const admin = getAdminClient();

    const { data: workersData, error: workersError } = await admin
      .from("workers")
      .select("id, display_name, role, team, is_active")
      .eq("role", "tarotista")
      .or("is_active.is.null,is_active.eq.true")
      .order("display_name", { ascending: true });
    if (workersError) throw workersError;

    const workers = (workersData || []) as WorkerRow[];
    const workerIds = workers.map((worker) => String(worker.id));

    const [presenceResult, currentRows, previousRows] = await Promise.all([
      workerIds.length
        ? admin
            .from("attendance_state")
            .select("worker_id, is_online, status, last_event_at, updated_at")
            .in("worker_id", workerIds)
        : Promise.resolve({ data: [], error: null }),
      listRendimientoRows(currentRange.start, currentRange.endExclusive),
      listRendimientoRows(previousRange.start, previousRange.endExclusive),
    ]);
    if (presenceResult.error) throw presenceResult.error;

    const stateByWorker = new Map(
      (presenceResult.data || []).map((state: any) => [String(state.worker_id), state])
    );

    const liveMembers = workers.flatMap((worker) => {
      const state: any = stateByWorker.get(String(worker.id));
      const signalAt = state?.last_event_at || state?.updated_at || null;
      const online = state?.is_online === true && isRecent(signalAt);
      if (!online) return [];

      const rawStatus = String(state?.status || "working").toLowerCase();
      const status = rawStatus === "bathroom"
        ? "bathroom"
        : rawStatus === "break" || rawStatus === "pause"
          ? "break"
          : "connected";

      return [{
        worker_id: String(worker.id),
        display_name: String(worker.display_name || "—"),
        team: normalizeTeam(worker.team),
        status,
        source_status: rawStatus,
        last_event_at: signalAt ? String(signalAt) : null,
      }];
    });

    const workerMetricsInput = workers.map((worker) => ({
      id: String(worker.id),
      display_name: worker.display_name,
      role: worker.role,
      team: normalizeTeam(worker.team),
    }));
    const current = summarizeTeams(aggregateRendimientoByTarotista(currentRows, workerMetricsInput));
    const previous = summarizeTeams(aggregateRendimientoByTarotista(previousRows, workerMetricsInput));

    for (const key of TEAM_KEYS) {
      current.teams[key].previous_score = previous.teams[key].score;
      current.teams[key].delta_score = Math.round(
        (current.teams[key].score - previous.teams[key].score) * 100
      ) / 100;
    }

    return NextResponse.json({
      ok: true,
      month,
      formula: "porcentaje_cliente_mas_porcentaje_repite",
      active_total: workers.length,
      connected_total: liveMembers.filter((member) => member.status === "connected").length,
      break_total: liveMembers.filter((member) => member.status !== "connected").length,
      live_members: liveMembers,
      teams: current.teams,
      leader: current.leader,
      refreshed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    const message = String(error?.message || "ERR");
    const normalized = /fetch|network|timeout|connection/i.test(message) ? "SERVICE_UNAVAILABLE" : message;
    return NextResponse.json({ ok: false, error: normalized }, { status: 500 });
  }
}
