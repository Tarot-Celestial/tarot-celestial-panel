import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getOracleCreditBalance } from "@/lib/server/oracle-premium";
import { promotionIsLive } from "@/lib/server/client-promotions";
import {
  buildLeoRecommendation,
  leoContextForPath,
  type LeoLiveFacts,
  type LeoMemoryProfile,
} from "@/lib/leo-celestial-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
const VALID_CONTEXTS = new Set([
  "dashboard", "promotions", "roulette", "oracle", "profile",
  "tarotists", "notifications", "raffle", "reviews",
]);

function cleanContext(value: unknown) {
  const context = String(value || "").trim().toLowerCase();
  return VALID_CONTEXTS.has(context) ? context : "dashboard";
}

function profileShape(row: any): LeoMemoryProfile {
  return {
    hidden: Boolean(row?.hidden),
    muted: Boolean(row?.muted),
    visit_counts: row?.visit_counts && typeof row.visit_counts === "object" ? row.visit_counts : {},
    interest_scores: row?.interest_scores && typeof row.interest_scores === "object" ? row.interest_scores : {},
    interaction_counts: row?.interaction_counts && typeof row.interaction_counts === "object" ? row.interaction_counts : {},
    last_path: row?.last_path || null,
    last_seen_at: row?.last_seen_at || null,
  };
}

async function loadFacts(gate: Awaited<ReturnType<typeof clientFromRequest>>): Promise<LeoLiveFacts> {
  const now = new Date();
  const [spinsResult, promotionsResult, oracleResult] = await Promise.all([
    gate.admin
      .from("cliente_ruleta_giros")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", gate.cliente.id)
      .eq("estado", "pending"),
    gate.admin
      .from("tc_client_promotions")
      .select("id,name,status,starts_at,ends_at,active_until_disabled")
      .in("status", ["active", "scheduled"])
      .order("created_at", { ascending: false }),
    getOracleCreditBalance(gate.admin, gate.cliente.id).catch(() => 0),
  ]);

  if (spinsResult.error) throw spinsResult.error;
  if (promotionsResult.error) throw promotionsResult.error;
  const activePromotion = (promotionsResult.data || []).find((row: any) => promotionIsLive(row, now));

  return {
    activePromotion: activePromotion
      ? { id: String(activePromotion.id), name: String(activePromotion.name || "Promoción de hoy") }
      : null,
    pendingSpins: Math.max(0, Number(spinsResult.count || 0)),
    oracleCredits: Math.max(0, Number(oracleResult || 0)),
    coins: Math.max(0, Number(gate.cliente.puntos || 0)),
    minutes: Math.max(0, Number(gate.cliente.minutos_free_pendientes || 0) + Number(gate.cliente.minutos_normales_pendientes || 0)),
  };
}

async function responseFor(gate: Awaited<ReturnType<typeof clientFromRequest>>, profileRow: any) {
  const profile = profileShape(profileRow);
  const facts = await loadFacts(gate);
  return NextResponse.json({
    ok: true,
    profile,
    facts,
    recommendation: buildLeoRecommendation(profile, facts),
  }, { headers: HEADERS });
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers: HEADERS });
    if (!gate.cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers: HEADERS });

    const { data, error } = await gate.admin
      .from("tc_client_leo_profiles")
      .select("hidden,muted,visit_counts,interest_scores,interaction_counts,last_path,last_seen_at")
      .eq("client_id", gate.cliente.id)
      .maybeSingle();
    if (error) throw error;
    return responseFor(gate, data);
  } catch (error: any) {
    console.error("[cliente:leo:get]", error?.message || error);
    return NextResponse.json({ ok: false, error: "LEO_PROFILE_UNAVAILABLE" }, { status: 503, headers: HEADERS });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers: HEADERS });
    if (!gate.cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers: HEADERS });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim().toLowerCase();
    if (!new Set(["visit", "interaction", "preference"]).has(action)) {
      return NextResponse.json({ ok: false, error: "LEO_SIGNAL_INVALID" }, { status: 400, headers: HEADERS });
    }

    const pathname = String(body?.pathname || "/cliente/dashboard").slice(0, 160);
    const context = action === "preference"
      ? cleanContext(body?.context)
      : cleanContext(body?.context || leoContextForPath(pathname));
    const hidden = action === "preference" && typeof body?.hidden === "boolean" ? body.hidden : null;
    const muted = action === "preference" && typeof body?.muted === "boolean" ? body.muted : null;

    const { data, error } = await gate.admin.rpc("tc_record_client_leo_signal", {
      p_client_id: gate.cliente.id,
      p_signal: action,
      p_context: context,
      p_path: pathname,
      p_hidden: hidden,
      p_muted: muted,
    });
    if (error) throw error;
    return responseFor(gate, data);
  } catch (error: any) {
    console.error("[cliente:leo:post]", error?.message || error);
    return NextResponse.json({ ok: false, error: "LEO_SIGNAL_UNAVAILABLE" }, { status: 503, headers: HEADERS });
  }
}
