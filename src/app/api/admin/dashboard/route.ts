export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { normalizeMonthKey } from "@/lib/month-key";
import { createClient } from "@supabase/supabase-js";
import { brandFromRequest } from "@/lib/server/brand-filter";
import { loadOfficialPayments, totalOfficialRevenue } from "@/lib/server/economic-payments";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get("month") ?? currentMonthKey());
    const { startIso, endIso } = monthBounds(month);
    const brand = brandFromRequest(req);

    const [
      leadsRes,
      captadasClosedRes,
      captadasUpdatedRes,
      facturacionRes,
    ] = await Promise.all([
      supabase
        .from("captacion_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startIso)
        .lt("created_at", endIso),
      supabase
        .from("captacion_leads")
        .select("id", { count: "exact", head: true })
        .eq("estado", "captado")
        .gte("closed_at", startIso)
        .lt("closed_at", endIso),
      supabase
        .from("captacion_leads")
        .select("id", { count: "exact", head: true })
        .eq("estado", "captado")
        .is("closed_at", null)
        .gte("updated_at", startIso)
        .lt("updated_at", endIso),
      loadOfficialPayments(supabase, startIso, endIso, brand),
    ]);

    if (leadsRes.error) throw leadsRes.error;
    if (captadasClosedRes.error) throw captadasClosedRes.error;
    if (captadasUpdatedRes.error) throw captadasUpdatedRes.error;
    const facturacionMes = totalOfficialRevenue(facturacionRes || []);

    return NextResponse.json({
      ok: true,
      month,
      leads_mes: Number(leadsRes.count || 0),
      captadas_mes: Number(captadasClosedRes.count || 0) + Number(captadasUpdatedRes.count || 0),
      facturacion_mes: Math.round(facturacionMes * 100) / 100,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ADMIN_DASHBOARD" }, { status: error?.message === "INVALID_MONTH_KEY" ? 400 : 500 });
  }
}
