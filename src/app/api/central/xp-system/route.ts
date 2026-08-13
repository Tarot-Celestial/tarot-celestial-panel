import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";
import { configuredXpProgress } from "@/lib/xp-levels";
import { loadXpLevelConfiguration } from "@/lib/server/xp-level-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v) || 0;
function startOfUtcDay(offsetDays = 0) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays));
}
function startOfUtcMonth() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function startOfWeek() { const d = startOfUtcDay(); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return d; }

const APP_TIMEZONE = "Europe/Madrid";

function zonedParts(date: Date, timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone = APP_TIMEZONE) {
  let instant = Date.UTC(year, month - 1, day);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(instant), timeZone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += Date.UTC(year, month - 1, day) - represented;
  }
  return new Date(instant);
}

function currentOperationalDay() {
  const today = zonedParts(new Date());
  const year = Number(today.year);
  const month = Number(today.month);
  const day = Number(today.day);
  const start = zonedMidnightUtc(year, month, day);
  const nextCalendarDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedMidnightUtc(nextCalendarDay.getUTCFullYear(), nextCalendarDay.getUTCMonth() + 1, nextCalendarDay.getUTCDate());
  return { date: `${today.year}-${today.month}-${today.day}`, start: start.toISOString(), end: end.toISOString() };
}

function rewardTablesMissing(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("worker_xp_reward_claims") || message.includes("worker_xp_reward_processing");
}

async function loadAllAppliedXpEvents(
  admin: ReturnType<typeof getAdminClient>,
  workerId?: string,
) {
  const pageSize = 1000;
  const rows: any[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from("worker_xp_events")
      .select("id,worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_at")
      .eq("status", "applied")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (workerId) query = query.eq("worker_id", workerId);
    const result = await query;
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function rewardSummary(admin: ReturnType<typeof getAdminClient>, workerId: string) {
  const claimsR = await admin
    .from("worker_xp_reward_claims")
    .select("id,reward_kind,reward_key,level,tier_key,reward_type,reward_amount,reward_label,source_event_id,status,seen_at,created_at")
    .eq("worker_id", workerId)
    .eq("status", "granted")
    .order("created_at", { ascending: false });

  if (claimsR.error) {
    if (rewardTablesMissing(claimsR.error)) return { available: false, claims: [], pending: null, coins: null, count: null };
    throw claimsR.error;
  }

  const claims = claimsR.data || [];
  const coins = claims
    .filter((claim: any) => claim.reward_type === "coins")
    .reduce((sum: number, claim: any) => sum + num(claim.reward_amount), 0);
  const pending = claims.find((claim: any) => !claim.seen_at) || null;
  return { available: true, claims, pending, coins, count: claims.length };
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (me.role !== "central" && me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const admin = getAdminClient();
    const levelConfig = await loadXpLevelConfiguration(admin);
    const operationalDay = currentOperationalDay();
    const week = startOfWeek();
    const previousWeek = new Date(week); previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
    const [rulesR, events, workersR, rankingEvents] = await Promise.all([
      admin.from("worker_xp_rules").select("id,action_key,name,description,xp_reward,frequency,enabled,integration_status,created_at,updated_at").order("created_at", { ascending: true }),
      loadAllAppliedXpEvents(admin, String(me.id)),
      admin.from("workers").select("id,display_name").eq("role", "central").or("is_active.is.null,is_active.eq.true"),
      loadAllAppliedXpEvents(admin),
    ]);
    for (const r of [rulesR, workersR]) if (r.error) throw r.error;

    const total = events.reduce((s, e: any) => s + num(e.xp_amount), 0);
    const level = configuredXpProgress(total, levelConfig.levels, levelConfig.tiers);

    const [paymentsR, followupsR, capturesR] = await Promise.all([
      admin.from("crm_cliente_pagos").select("id,cliente_id,importe,moneda,created_at").eq("created_by_user_id", me.id).eq("estado", "completed").gte("created_at", operationalDay.start).lt("created_at", operationalDay.end),
      admin.from("crm_client_followups").select("id,client_id,reason,completed_at").eq("worker_id", me.id).not("completed_at", "is", null).gte("completed_at", operationalDay.start).lt("completed_at", operationalDay.end),
      admin.from("captacion_leads").select("id,cliente_id,closed_at").eq("assigned_worker_id", me.id).eq("estado", "captado").gte("closed_at", operationalDay.start).lt("closed_at", operationalDay.end),
    ]);
    for (const result of [paymentsR, followupsR, capturesR]) if (result.error) throw result.error;

    const todayEvents = events.filter((event: any) => event.created_at >= operationalDay.start && event.created_at < operationalDay.end);
    const clientIds = Array.from(new Set([
      ...(paymentsR.data || []).map((row: any) => String(row.cliente_id || "")),
      ...(followupsR.data || []).map((row: any) => String(row.client_id || "")),
      ...(capturesR.data || []).map((row: any) => String(row.cliente_id || "")),
    ].filter(Boolean)));
    const clientsR = clientIds.length
      ? await admin.from("crm_clientes").select("id,nombre,apellido").in("id", clientIds)
      : { data: [], error: null };
    if (clientsR.error) throw clientsR.error;
    const clientNames = new Map((clientsR.data || []).map((client: any) => [
      String(client.id),
      [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Clienta",
    ]));

    type ActivityKind = "payment" | "followup" | "capture";
    const eventBelongsToActivity = (event: any, kind: ActivityKind, sourceId: string) => {
      const reference = String(event.reference_id || "");
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
      if (reference === sourceId) return true;
      if (kind === "capture" && reference === `captacion:${sourceId}`) return true;
      if (kind === "payment" && String(metadata.payment_id || metadata.pago_id || "") === sourceId) return true;
      if (kind === "followup" && String(metadata.followup_id || "") === sourceId) return true;
      if (kind === "capture" && String(metadata.lead_id || "") === sourceId) return true;
      return false;
    };
    const xpForActivity = (kind: ActivityKind, sourceId: string) => todayEvents
      .filter((event: any) => eventBelongsToActivity(event, kind, sourceId))
      .reduce((sum: number, event: any) => sum + num(event.xp_amount), 0);

    const activities = [
      ...(paymentsR.data || []).map((row: any) => ({
        id: `payment:${row.id}`,
        kind: "payment" as const,
        source_id: String(row.id),
        client_name: clientNames.get(String(row.cliente_id)) || "Clienta",
        amount: num(row.importe),
        currency: String(row.moneda || "EUR"),
        occurred_at: String(row.created_at),
        xp: xpForActivity("payment", String(row.id)),
      })),
      ...(followupsR.data || []).map((row: any) => ({
        id: `followup:${row.id}`,
        kind: "followup" as const,
        source_id: String(row.id),
        client_name: clientNames.get(String(row.client_id)) || "Clienta",
        detail: String(row.reason || "Seguimiento realizado"),
        occurred_at: String(row.completed_at),
        xp: xpForActivity("followup", String(row.id)),
      })),
      ...(capturesR.data || []).map((row: any) => ({
        id: `capture:${row.id}`,
        kind: "capture" as const,
        source_id: String(row.id),
        client_name: clientNames.get(String(row.cliente_id)) || "Clienta",
        occurred_at: String(row.closed_at),
        xp: xpForActivity("capture", String(row.id)),
      })),
    ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

    const dailyItems = [
      { key: "payments" as const, count: paymentsR.data?.length || 0, xp: activities.filter((item) => item.kind === "payment").reduce((sum, item) => sum + item.xp, 0), amount: (paymentsR.data || []).reduce((sum: number, row: any) => sum + num(row.importe), 0) },
      { key: "followups" as const, count: followupsR.data?.length || 0, xp: activities.filter((item) => item.kind === "followup").reduce((sum, item) => sum + item.xp, 0) },
      { key: "captures" as const, count: capturesR.data?.length || 0, xp: activities.filter((item) => item.kind === "capture").reduce((sum, item) => sum + item.xp, 0) },
    ];

    // Read-only: loading Central or recalculating a level must never grant rewards.
    const rewards = await rewardSummary(admin, String(me.id));

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
    for (const e of rankingEvents) totals.set(String((e as any).worker_id), (totals.get(String((e as any).worker_id)) || 0) + num((e as any).xp_amount));
    const ranking = (workersR.data || []).map((w: any) => { const xp = totals.get(String(w.id)) || 0; return { worker_id: w.id, name: w.display_name, xp, level: configuredXpProgress(xp, levelConfig.levels, levelConfig.tiers).level, is_me: w.id === me.id }; }).sort((a, b) => b.xp - a.xp).map((r, i) => ({ ...r, position: i + 1 }));

    const counts = (key: string) => events.filter((e: any) => e.action_key === key).length;
    return NextResponse.json({
      ok: true,
      worker: { id: me.id, name: me.display_name },
      progress: { total_xp: total, level: level.level, level_xp: level.current, level_span: level.span, next_level: level.nextLevel, remaining_xp: level.remaining, max_level: level.maxed, tier: level.tier, total_required_for_max: level.totalRequiredForMax, xp_today: todayEvents.reduce((sum: number, event: any) => sum + num(event.xp_amount), 0), xp_week: xpWeek, xp_month: sumSince(monthStart), previous_week_xp: xpPreviousWeek },
      daily_activity: {
        date: operationalDay.date,
        timezone: APP_TIMEZONE,
        total_actions: dailyItems.reduce((sum, item) => sum + item.count, 0),
        total_xp: todayEvents.reduce((sum: number, event: any) => sum + num(event.xp_amount), 0),
        items: dailyItems,
        activities,
      },
      level_config: levelConfig.levels,
      tier_config: levelConfig.tiers,
      level_config_persisted: levelConfig.persisted,
      reward_system_available: rewards.available,
      reward_claims: rewards.claims,
      pending_reward: rewards.pending,
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
      stats: { clients_captured: counts("client_capture"), repurchases: counts("repurchase"), followups: counts("followup"), consultations: counts("consultation"), positive_reviews: counts("positive_review"), missions: counts("daily_mission"), streak: null, coins: rewards.coins, rewards_claimed: rewards.count, rewards_value: rewards.coins },
      ranking,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (me.role !== "central" && me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const body = await req.json();
    const op = String(body?.op || "");
    if (op !== "ack_reward_claim") return NextResponse.json({ ok: false, error: "INVALID_OPERATION" }, { status: 400 });

    const claimId = String(body?.claim_id || "");
    if (!claimId) return NextResponse.json({ ok: false, error: "CLAIM_REQUIRED" }, { status: 400 });

    const admin = getAdminClient();
    const updated = await admin
      .from("worker_xp_reward_claims")
      .update({ seen_at: new Date().toISOString() })
      .eq("id", claimId)
      .eq("worker_id", String(me.id))
      .is("seen_at", null)
      .select("id")
      .maybeSingle();

    if (updated.error) {
      if (rewardTablesMissing(updated.error)) return NextResponse.json({ ok: false, error: "REWARD_SYSTEM_NOT_INSTALLED" }, { status: 409 });
      throw updated.error;
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
