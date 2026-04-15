import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";

export const runtime = "nodejs";

function normalizeDay(raw: string | null) {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date().toISOString().slice(0, 10);
  }
  return value;
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const day = normalizeDay(searchParams.get("day"));
    const admin = getAdminClient();

    const baseQuery = admin
      .from("rendimiento_llamadas")
      .select("id", { count: "exact", head: true })
      .eq("fecha", day)
      .or("cliente_compra_minutos.eq.true,importe.gt.0");

    const latestQuery = admin
      .from("rendimiento_llamadas")
      .select("id, cliente_nombre, importe, forma_pago, fecha_hora, telefonista_nombre, tarotista_nombre")
      .eq("fecha", day)
      .or("cliente_compra_minutos.eq.true,importe.gt.0")
      .order("fecha_hora", { ascending: false })
      .limit(1)
      .maybeSingle();

    const [{ count, error: countError }, { data: latestPayment, error: latestError }] = await Promise.all([
      baseQuery,
      latestQuery,
    ]);

    if (countError) throw countError;
    if (latestError) throw latestError;

    return NextResponse.json({
      ok: true,
      day_key: day,
      count_today: Number(count) || 0,
      latest_payment: latestPayment || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
