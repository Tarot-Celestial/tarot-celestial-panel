import { NextResponse } from "next/server";
import { workerFromRequest } from "@/lib/server/auth-worker";
import { buildTeamCompetitionSnapshot } from "@/lib/server/team-competition";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["tarotista", "central", "admin", "ceo", "supervisor"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const url = new URL(req.url);
    const snapshot = await buildTeamCompetitionSnapshot(url.searchParams.get("month"), String(me.id));
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_TEAM_SCOREBOARD" }, { status: 500 });
  }
}
