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

function buildOperationalDay(requestedDate?: string | null) {
  const today = zonedParts(new Date());
  const todayKey = `${today.year}-${today.month}-${today.day}`;
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || "")) ? String(requestedDate) : todayKey;
  if (safeDate > todayKey) throw new Error("FUTURE_DATE_NOT_ALLOWED");
  const [year, month, day] = safeDate.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error("INVALID_DATE");
  const start = zonedMidnightUtc(year, month, day);
  const nextCalendarDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedMidnightUtc(nextCalendarDay.getUTCFullYear(), nextCalendarDay.getUTCMonth() + 1, nextCalendarDay.getUTCDate());
  return { date: safeDate, start: start.toISOString(), end: end.toISOString(), is_today: safeDate === todayKey };
}

function rewardTablesMissing(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("worker_xp_reward_claims") || message.includes("worker_xp_reward_processing");
}

function coinTablesMissing(error: { code?: string; message?: string } | null | undefined) {
  const value = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return value.includes("42p01") || value.includes("pgrst205") || value.includes("worker_xp_coin_") || value.includes("worker_coin_");
}

async function coinExchangeSummary(admin: ReturnType<typeof getAdminClient>, workerId: string, historicalXp: number) {
  const [configR, walletR, conversionsR] = await Promise.all([
    admin.from("worker_xp_coin_config").select("xp_units,coin_units,min_xp,enabled,updated_at").eq("id", true).maybeSingle(),
    admin.from("worker_coin_wallets").select("balance,updated_at").eq("worker_id", workerId).maybeSingle(),
    admin.from("worker_xp_coin_conversions").select("id,xp_spent,coins_granted,ratio_xp,ratio_coins,status,created_at").eq("worker_id", workerId).eq("status", "completed").order("created_at", { ascending: false }),
  ]);
  const error = configR.error || walletR.error || conversionsR.error;
  if (error) {
    if (coinTablesMissing(error)) return { available: false, enabled: false, historical_xp: historicalXp, spent_xp: 0, available_xp: historicalXp, coin_balance: 0, ratio: null, history: [] };
    throw error;
  }
  const history = conversionsR.data || [];
  const spent = history.reduce((sum: number, row: any) => sum + num(row.xp_spent), 0);
  const config = configR.data;
  return {
    available: true,
    enabled: config?.enabled === true,
    historical_xp: historicalXp,
    spent_xp: spent,
    available_xp: Math.max(0, historicalXp - spent),
    coin_balance: num(walletR.data?.balance),
    ratio: config ? { xp_units: num(config.xp_units), coin_units: num(config.coin_units), min_xp: num(config.min_xp), updated_at: config.updated_at } : null,
    history: history.slice(0, 50),
  };
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
    const requestedDate = new URL(req.url).searchParams.get("date");
    const operationalDay = buildOperationalDay(requestedDate);
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

    const [paymentsR, followupsR, capturesR, rewardClaimsR, rewardProcessingR] = await Promise.all([
      admin.from("crm_cliente_pagos").select("id,cliente_id,importe,moneda,created_at").eq("created_by_user_id", me.id).eq("estado", "completed").gte("created_at", operationalDay.start).lt("created_at", operationalDay.end),
      admin.from("crm_client_followups").select("id,client_id,reason,completed_at").eq("worker_id", me.id).not("completed_at", "is", null).gte("completed_at", operationalDay.start).lt("completed_at", operationalDay.end),
      admin.from("captacion_leads").select("id,cliente_id,closed_at").eq("assigned_worker_id", me.id).eq("estado", "captado").gte("closed_at", operationalDay.start).lt("closed_at", operationalDay.end),
      admin.from("worker_xp_reward_claims").select("id,reward_kind,reward_key,level,reward_type,reward_amount,reward_label,status,created_at").eq("worker_id", me.id).eq("status", "granted"),
      admin.from("worker_xp_reward_processing").select("claim_id,coins_granted,processed_at").eq("worker_id", me.id).gte("processed_at", operationalDay.start).lt("processed_at", operationalDay.end),
    ]);
    for (const result of [paymentsR, followupsR, capturesR]) if (result.error) throw result.error;
    if (rewardClaimsR.error && !rewardTablesMissing(rewardClaimsR.error)) throw rewardClaimsR.error;
    if (rewardProcessingR.error && !rewardTablesMissing(rewardProcessingR.error)) throw rewardProcessingR.error;

    const todayEvents = events.filter((event: any) => event.created_at >= operationalDay.start && event.created_at < operationalDay.end);
    const clientIds = Array.from(new Set([
      ...(paymentsR.data || []).map((row: any) => String(row.cliente_id || "")),
      ...(followupsR.data || []).map((row: any) => String(row.client_id || "")),
      ...(capturesR.data || []).map((row: any) => String(row.cliente_id || "")),
      ...todayEvents.filter((event: any) => event.action_key === "client_capture").map((event: any) => {
        const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
        return String(metadata.client_id || metadata.cliente_id || event.reference_id || "").replace(/^cliente:/, "");
      }),
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
    const representedEventIds = new Set<string>();
    const xpForActivity = (kind: ActivityKind, sourceId: string) => todayEvents
      .filter((event: any) => eventBelongsToActivity(event, kind, sourceId))
      .reduce((sum: number, event: any) => {
        representedEventIds.add(String(event.id));
        return sum + num(event.xp_amount);
      }, 0);

    const sourceClientId = (event: any) => {
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
      return String(metadata.client_id || metadata.cliente_id || event.reference_id || "").replace(/^cliente:/, "");
    };

    const baseActivities = [
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
    ];

    const eventActivities = todayEvents
      .filter((event: any) => !representedEventIds.has(String(event.id)))
      .map((event: any) => {
        const clientId = sourceClientId(event);
        return {
          id: `xp:${event.id}`,
          kind: event.action_key === "client_capture" ? "capture" as const : "xp" as const,
          source_id: String(event.id),
          client_name: clientNames.get(clientId) || String(event.reference_label || "Acción XP"),
          detail: event.action_key === "client_capture" ? "Nueva clienta captada" : String(event.reference_label || event.action_key || "Acción XP"),
          origin: String(event.origin || "Sistema XP"),
          occurred_at: String(event.created_at),
          xp: num(event.xp_amount),
        };
      });

    const processedByClaim = new Map((rewardProcessingR.data || []).map((row: any) => [String(row.claim_id), row]));
    const rewardActivities = (rewardClaimsR.data || [])
      .filter((claim: any) => processedByClaim.has(String(claim.id)))
      .map((claim: any) => {
        const processing: any = processedByClaim.get(String(claim.id));
        return {
          id: `reward:${claim.id}`,
          kind: "level_reward" as const,
          source_id: String(claim.id),
          client_name: claim.level ? `Nivel ${claim.level} desbloqueado` : "Recompensa desbloqueada",
          detail: String(claim.reward_label || "Recompensa de nivel obtenida"),
          occurred_at: String(processing?.processed_at || claim.created_at),
          xp: 0,
          coins: num(processing?.coins_granted || claim.reward_amount),
        };
      });

    const activities = [...baseActivities, ...eventActivities, ...rewardActivities]
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

    const dailyItems = [
      { key: "payments" as const, count: paymentsR.data?.length || 0, xp: activities.filter((item) => item.kind === "payment").reduce((sum, item) => sum + item.xp, 0), amount: (paymentsR.data || []).reduce((sum: number, row: any) => sum + num(row.importe), 0) },
      { key: "followups" as const, count: followupsR.data?.length || 0, xp: activities.filter((item) => item.kind === "followup").reduce((sum, item) => sum + item.xp, 0) },
      { key: "captures" as const, count: capturesR.data?.length || 0, xp: activities.filter((item) => item.kind === "capture").reduce((sum, item) => sum + item.xp, 0) },
    ];

    // Read-only: loading Central or recalculating a level must never grant rewards.
    const [rewards, coinExchange] = await Promise.all([
      rewardSummary(admin, String(me.id)),
      coinExchangeSummary(admin, String(me.id), total),
    ]);

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
    const [missionsR,levelMissionR,tierMissionR,missionClaimsR]=await Promise.all([
      admin.from("worker_xp_missions").select("id,mission_key,name,description,source_action_key,target_count,xp_reward,period,active,display_order").eq("active",true).order("display_order"),
      admin.from("worker_xp_level_missions").select("level,mission_id,availability,display_order,active").eq("active",true),
      admin.from("worker_xp_tier_missions").select("tier_key,mission_id,availability,display_order,active").eq("active",true),
      admin.from("worker_xp_mission_claims").select("id,mission_id,period_key,xp_event_id,claimed_at").eq("worker_id",me.id),
    ]);
    const missionSystemAvailable=![missionsR,levelMissionR,tierMissionR,missionClaimsR].some((r:any)=>r.error);
    const unlockedIds=new Set<string>();
    if(missionSystemAvailable){for(const link of levelMissionR.data||[])if(Number(link.level)<=level.level)unlockedIds.add(String(link.mission_id));for(const link of tierMissionR.data||[]){const tierLevels=levelConfig.levels.filter(item=>item.active&&item.tier_key===link.tier_key);const lastTierLevel=Math.max(0,...tierLevels.map(item=>item.level));if(lastTierLevel>0&&level.level>lastTierLevel)unlockedIds.add(String(link.mission_id));}}
    const periodInfo=(period:string)=>{const now=new Date();if(period==="daily")return{key:operationalDay.date,start:operationalDay.start};if(period==="weekly")return{key:week.toISOString().slice(0,10),start:week.toISOString()};if(period==="monthly")return{key:now.toISOString().slice(0,7),start:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString()};return{key:"lifetime",start:"1970-01-01T00:00:00.000Z"};};
    const activeMissions=missionSystemAvailable?(missionsR.data||[]).filter((m:any)=>unlockedIds.has(String(m.id))).map((m:any)=>{const p=periodInfo(String(m.period));const progress=events.filter((e:any)=>e.action_key===m.source_action_key&&e.created_at>=p.start).length;const claim=(missionClaimsR.data||[]).find((c:any)=>String(c.mission_id)===String(m.id)&&c.period_key===p.key);return{...m,progress:Math.min(progress,num(m.target_count)),completed:progress>=num(m.target_count),claimed:Boolean(claim),period_key:p.key};}):[];
    return NextResponse.json({
      ok: true,
      worker: { id: me.id, name: me.display_name },
      progress: { total_xp: total, level: level.level, level_xp: level.current, level_span: level.span, next_level: level.nextLevel, remaining_xp: level.remaining, max_level: level.maxed, tier: level.tier, total_required_for_max: level.totalRequiredForMax, xp_today: todayEvents.reduce((sum: number, event: any) => sum + num(event.xp_amount), 0), xp_week: xpWeek, xp_month: sumSince(monthStart), previous_week_xp: xpPreviousWeek },
      daily_activity: {
        date: operationalDay.date,
        timezone: APP_TIMEZONE,
        is_today: operationalDay.is_today,
        total_actions: activities.length,
        total_xp: todayEvents.reduce((sum: number, event: any) => sum + num(event.xp_amount), 0),
        items: dailyItems,
        activities,
      },
      level_config: levelConfig.levels,
      tier_config: levelConfig.tiers,
      missions: { available: missionSystemAvailable, active: activeMissions, catalog: missionSystemAvailable?missionsR.data||[]:[], level_links: missionSystemAvailable?levelMissionR.data||[]:[], tier_links: missionSystemAvailable?tierMissionR.data||[]:[] },
      level_config_persisted: levelConfig.persisted,
      reward_system_available: rewards.available,
      reward_claims: rewards.claims,
      pending_reward: rewards.pending,
      coin_exchange: coinExchange,
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
    if(op==="claim_mission"){
      const missionId=String(body.mission_id||""); const periodKey=String(body.period_key||""); if(!missionId||!periodKey)return NextResponse.json({ok:false,error:"MISSION_REQUIRED"},{status:400});
      const admin=getAdminClient(); const config=await loadXpLevelConfiguration(admin); const xpR=await admin.from("worker_xp_events").select("id,action_key,xp_amount,created_at").eq("worker_id",me.id).eq("status","applied"); if(xpR.error)throw xpR.error;
      const total=(xpR.data||[]).reduce((s:number,e:any)=>s+num(e.xp_amount),0); const progress=configuredXpProgress(total,config.levels,config.tiers);
      const missionR=await admin.from("worker_xp_missions").select("*").eq("id",missionId).eq("active",true).single(); if(missionR.error)throw missionR.error; const mission:any=missionR.data;
      const [levelLinks,tierLinks]=await Promise.all([admin.from("worker_xp_level_missions").select("level").eq("mission_id",missionId).eq("active",true),admin.from("worker_xp_tier_missions").select("tier_key").eq("mission_id",missionId).eq("active",true)]);
      const unlocked=(levelLinks.data||[]).some((x:any)=>num(x.level)<=progress.level)||(tierLinks.data||[]).some((x:any)=>{const tierLevels=config.levels.filter(item=>item.active&&item.tier_key===x.tier_key);return tierLevels.length>0&&progress.level>Math.max(...tierLevels.map(item=>item.level))}); if(!unlocked)return NextResponse.json({ok:false,error:"MISSION_LOCKED"},{status:409});
      const start=mission.period==="daily"?new Date(`${periodKey}T00:00:00.000Z`).toISOString():mission.period==="weekly"?new Date(`${periodKey}T00:00:00.000Z`).toISOString():mission.period==="monthly"?new Date(`${periodKey}-01T00:00:00.000Z`).toISOString():"1970-01-01T00:00:00.000Z";
      const count=(xpR.data||[]).filter((e:any)=>e.action_key===mission.source_action_key&&e.created_at>=start).length; if(count<num(mission.target_count))return NextResponse.json({ok:false,error:"MISSION_NOT_COMPLETED"},{status:409});
      const claim=await admin.rpc("claim_worker_xp_mission",{p_worker_id:me.id,p_mission_id:missionId,p_period_key:periodKey}); if(claim.error)return NextResponse.json({ok:false,error:String(claim.error.message).includes("MISSION_ALREADY_CLAIMED")?"MISSION_ALREADY_CLAIMED":"MISSION_CLAIM_FAILED"},{status:409});
      return NextResponse.json({ok:true,claim:claim.data});
    }
    if (op === "exchange_xp") {
      const xp = Number(body?.xp_amount);
      const operationId = String(body?.operation_id || "");
      if (!Number.isInteger(xp) || xp <= 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        return NextResponse.json({ ok: false, error: "INVALID_EXCHANGE" }, { status: 400 });
      }
      const admin = getAdminClient();
      const result = await admin.rpc("exchange_worker_xp_for_coins", { p_worker_id: String(me.id), p_xp: xp, p_operation_id: operationId });
      if (result.error) {
        const message = String(result.error.message || "EXCHANGE_FAILED");
        const known = ["INVALID_EXCHANGE_AMOUNT", "INSUFFICIENT_AVAILABLE_XP", "EXCHANGE_DISABLED", "OPERATION_ID_CONFLICT"].find((code) => message.includes(code));
        return NextResponse.json({ ok: false, error: known || (coinTablesMissing(result.error) ? "COIN_EXCHANGE_NOT_INSTALLED" : "EXCHANGE_FAILED") }, { status: 409 });
      }
      return NextResponse.json({ ok: true, exchange: result.data });
    }
    if (op === "claim_level_reward") {
      const level = Number(body?.level);
      const operationId = String(body?.operation_id || "");
      if (!Number.isInteger(level) || level < 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        return NextResponse.json({ ok: false, error: "INVALID_LEVEL_CLAIM" }, { status: 400 });
      }
      const admin = getAdminClient();
      const result = await admin.rpc("claim_worker_xp_level_reward", { p_worker_id: String(me.id), p_level: level, p_operation_id: operationId });
      if (result.error) {
        const message = String(result.error.message || "LEVEL_CLAIM_FAILED");
        const known = ["LEVEL_NOT_REACHED", "LEVEL_REWARD_NOT_CONFIGURED", "LEVEL_REWARD_ALREADY_PROCESSED"].find((code) => message.includes(code));
        return NextResponse.json({ ok: false, error: known || (rewardTablesMissing(result.error) ? "REWARD_SYSTEM_NOT_INSTALLED" : "LEVEL_CLAIM_FAILED") }, { status: 409 });
      }
      return NextResponse.json({ ok: true, claim: result.data });
    }
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
