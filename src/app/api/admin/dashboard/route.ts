import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeMonthKey(value: string | null) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
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
    const month = normalizeMonthKey(url.searchParams.get("month"));
    const { startIso, endIso } = monthBounds(month);

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
      supabase
        .from("rendimiento_llamadas")
        .select("importe, fecha_hora")
        .gte("fecha_hora", startIso)
        .lt("fecha_hora", endIso),
    ]);

    if (leadsRes.error) throw leadsRes.error;
    if (captadasClosedRes.error) throw captadasClosedRes.error;
    if (captadasUpdatedRes.error) throw captadasUpdatedRes.error;
    if (facturacionRes.error) throw facturacionRes.error;

    const facturacionMes = (facturacionRes.data || []).reduce((acc: number, row: any) => {
      return acc + (Number(row?.importe || 0) || 0);
    }, 0);

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
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ADMIN_DASHBOARD" }, { status: 500 });
  }
}
