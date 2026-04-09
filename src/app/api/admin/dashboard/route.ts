import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseMonth(monthRaw: string | null) {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = String(monthRaw || fallback).trim();
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return parseMonth(fallback);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { month, startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const { month, startIso, endIso } = parseMonth(searchParams.get("month"));

    const [rendimientoRes, leadsRes, captadasRes] = await Promise.all([
      supabase
        .from("rendimiento_llamadas")
        .select("importe, fecha_hora")
        .gte("fecha_hora", startIso)
        .lt("fecha_hora", endIso),
      supabase
        .from("captacion_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startIso)
        .lt("created_at", endIso),
      supabase
        .from("captacion_leads")
        .select("id", { count: "exact", head: true })
        .eq("estado", "captado")
        .gte("updated_at", startIso)
        .lt("updated_at", endIso),
    ]);

    if (rendimientoRes.error) throw rendimientoRes.error;
    if (leadsRes.error) throw leadsRes.error;
    if (captadasRes.error) throw captadasRes.error;

    const facturacionMes = (rendimientoRes.data || []).reduce((acc: number, row: any) => {
      return acc + (Number(row?.importe || 0) || 0);
    }, 0);

    return NextResponse.json({
      ok: true,
      month,
      facturacion_mes: Math.round(facturacionMes * 100) / 100,
      leads_mes: Number(leadsRes.count || 0),
      captadas_mes: Number(captadasRes.count || 0),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_ADMIN_DASHBOARD" }, { status: 500 });
  }
}
