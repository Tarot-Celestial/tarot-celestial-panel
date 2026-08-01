import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { normalizeClientRank, rankProgress, rankThresholds } from "@/lib/server/client-rank-effective";
import { loadEffectiveRanksBatch, loadRecentRankClients, loadRecentRankTotals } from "@/lib/server/client-rank-admin-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
function adminClient() { return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); }
async function currentWorker(req: Request) {
  const { data, error } = await getAuthUserFromRequest(req);
  if (error || !data.user) return null;
  const admin = adminClient();
  const { data: worker, error: workerError } = await admin.from("workers").select("id,user_id,role,display_name").eq("user_id", data.user.id).maybeSingle();
  if (workerError) throw workerError;
  return worker;
}
function allowed(role: unknown) { return ["admin", "ceo", "supervisor"].includes(String(role || "").toLowerCase()); }
function businessValue(row: any) { return String(row?.origen || row?.negocio || row?.business || "celestial").trim().toLowerCase(); }

export async function GET(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!allowed(worker.role)) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get("page_size") || 15)));
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const business = String(url.searchParams.get("business") || "all").trim().toLowerCase();
    const rankFilter = normalizeClientRank(url.searchParams.get("rank"));
    const assignment = String(url.searchParams.get("assignment") || "all");
    const order = String(url.searchParams.get("order") || "spent_desc");

    const admin = adminClient();
    const now = new Date();
    const activitySince = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const rankSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // The 60-day restriction is centralized in the data service. No historical client
    // outside this window is loaded or traversed by this module.
    const recentClients = await loadRecentRankClients(admin, activitySince.toISOString(), now.toISOString());
    const filteredClients = recentClients.filter((client: any) => {
      if (business !== "all" && businessValue(client) !== business) return false;
      if (!q) return true;
      return [client.nombre, client.apellido, client.telefono, client.email].some((value) => String(value || "").toLowerCase().includes(q));
    });

    const totals = await loadRecentRankTotals(admin, filteredClients, rankSince.toISOString(), now.toISOString());
    const effectiveRanks = await loadEffectiveRanksBatch(admin, filteredClients, totals);
    const rows = [] as any[];
    for (const client of filteredClients) {
      const info = totals.get(String(client.id)) || { total: 0, compras: 0 };
      const rank = effectiveRanks.get(String(client.id)) || { automatic: null, effective: null, override: null };
      if (rankFilter && rank.effective !== rankFilter) continue;
      if (assignment === "automatic" && rank.override) continue;
      if (assignment === "manual" && !rank.override) continue;
      const thresholds = rankThresholds(rank.automatic);
      rows.push({
        id: client.id,
        name: [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Sin nombre",
        phone: client.telefono || null,
        email: client.email || null,
        business: businessValue(client),
        automatic_rank: rank.automatic,
        effective_rank: rank.effective,
        spent_30d: Number(Number(info.total || 0).toFixed(2)),
        purchases_30d: Number(info.compras || 0),
        next_rank: thresholds.next,
        next_rank_amount: thresholds.nextMin,
        progress: Number(rankProgress(Number(info.total || 0), rank.automatic).toFixed(1)),
        override: rank.override,
      });
    }

    rows.sort((a, b) => order === "name" ? a.name.localeCompare(b.name) : order === "spent_asc" ? a.spent_30d - b.spent_30d : b.spent_30d - a.spent_30d);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    return NextResponse.json({ ok: true, rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize), pagination: { page: safePage, page_size: pageSize, total, total_pages: totalPages }, window: { from: activitySince.toISOString(), to: now.toISOString(), rank_from: rankSince.toISOString() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_RANKS" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const worker = await currentWorker(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!allowed(worker.role)) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    const body = await req.json();
    const clientId = String(body.client_id || "").trim();
    const action = String(body.action || "");
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_REQUIRED" }, { status: 400 });
    const admin = adminClient();

    if (action === "restore") {
      const { error } = await admin.rpc("restore_client_rank_automatic", { p_client_id: clientId, p_restored_by: worker.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const rank = normalizeClientRank(body.rank);
    const type = String(body.intervention_type || "temporary");
    if (!rank || !["temporary", "permanent", "penalty"].includes(type)) return NextResponse.json({ ok: false, error: "INVALID_INTERVENTION" }, { status: 400 });
    const { error } = await admin.rpc("set_client_rank_override", {
      p_client_id: clientId,
      p_assigned_rank: rank,
      p_intervention_type: type,
      p_starts_at: body.starts_at || new Date().toISOString(),
      p_ends_at: type === "permanent" ? null : body.ends_at || null,
      p_reason: String(body.reason || "").trim(),
      p_notes: String(body.notes || "").trim() || null,
      p_created_by: worker.id,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_RANK_ACTION" }, { status: 500 });
  }
}
