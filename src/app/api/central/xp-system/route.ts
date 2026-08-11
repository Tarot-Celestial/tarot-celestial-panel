import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v) || 0;
function levelFor(xp: number) {
  const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1);
  const floor = (level - 1) * (level - 1) * 100;
  const next = level * level * 100;
  return { level, floor, next, current: Math.max(0, xp - floor), span: next - floor };
}
function startOfUtcDay(offsetDays = 0) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays));
}
function startOfUtcMonth() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function startOfWeek() { const d = startOfUtcDay(); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return d; }

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (me.role !== "central" && me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const admin = getAdminClient();
    const week = startOfWeek();
    const previousWeek = new Date(week); previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
    const [rulesR, ownR, workersR, rankingEventsR] = await Promise.all([
      admin.from("worker_xp_rules").select("id,action_key,name,description,xp_reward,frequency,enabled,integration_status,created_at,updated_at").order("created_at", { ascending: true }),
      admin.from("worker_xp_events").select("id,action_key,xp_amount,reference_label,origin,status,created_at").eq("worker_id", me.id).eq("status", "applied").order("created_at", { ascending: false }).limit(1000),
      admin.from("workers").select("id,display_name").eq("role", "central").or("is_active.is.null,is_active.eq.true"),
      admin.from("worker_xp_events").select("worker_id,xp_amount,status").eq("status", "applied"),
    ]);
    for (const r of [rulesR, ownR, workersR, rankingEventsR]) if (r.error) throw r.error;

    const events = ownR.data || [];
    const total = events.reduce((s, e: any) => s + num(e.xp_amount), 0);
    const level = levelFor(total);
    const dayStart = startOfUtcDay().getTime();
    const monthStart = startOfUtcMonth().getTime();
    const weekStart = week.getTime();
    const prevStart = previousWeek.getTime();
    const sumSince = (ms: number) => events.filter((e: any) => new Date(e.created_at).getTime() >= ms).reduce((s, e: any) => s + num(e.xp_amount), 0);
    const xpWeek = sumSince(weekStart);
    const xpPreviousWeek = events.filter((e: any) => { const t = new Date(e.created_at).getTime(); return t >= prevStart && t < weekStart; }).reduce((s, e: any) => s + num(e.xp_amount), 0);
    const weekly = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(week); start.setUTCDate(start.getUTCDate() + i);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      return { date: start.toISOString().slice(0, 10), xp: events.filter((e: any) => { const t = new Date(e.created_at).getTime(); return t >= start.getTime() && t < end.getTime(); }).reduce((s, e: any) => s + num(e.xp_amount), 0) };
    });

    const totals = new Map<string, number>();
    for (const e of rankingEventsR.data || []) totals.set(String((e as any).worker_id), (totals.get(String((e as any).worker_id)) || 0) + num((e as any).xp_amount));
    const ranking = (workersR.data || []).map((w: any) => { const xp = totals.get(String(w.id)) || 0; return { worker_id: w.id, name: w.display_name, xp, level: levelFor(xp).level, is_me: w.id === me.id }; }).sort((a, b) => b.xp - a.xp).map((r, i) => ({ ...r, position: i + 1 }));

    const counts = (key: string) => events.filter((e: any) => e.action_key === key).length;
    return NextResponse.json({
      ok: true,
      worker: { id: me.id, name: me.display_name },
      progress: { total_xp: total, level: level.level, level_xp: level.current, level_span: level.span, next_level: level.level + 1, remaining_xp: Math.max(0, level.span - level.current), xp_today: sumSince(dayStart), xp_week: xpWeek, xp_month: sumSince(monthStart), previous_week_xp: xpPreviousWeek },
      weekly,
      rules: (rulesR.data || []).filter((r: any) => r.enabled === true).map((r: any) => ({
        id: r.id,
        action_key: String(r.action_key || ""),
        name: String(r.name || r.action_key || "Acción XP"),
        description: String(r.description || ""),
        xp_reward: num(r.xp_reward),
        frequency: String(r.frequency || ""),
        enabled: true,
        integration_status: r.integration_status === "connected" ? "connected" : "pending",
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      recent: events.slice(0, 20),
      stats: { clients_captured: counts("client_capture"), repurchases: counts("repurchase"), followups: counts("followup"), consultations: counts("consultation"), positive_reviews: counts("positive_review"), missions: counts("daily_mission"), streak: null, coins: null, rewards_claimed: null, rewards_value: null },
      ranking,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
