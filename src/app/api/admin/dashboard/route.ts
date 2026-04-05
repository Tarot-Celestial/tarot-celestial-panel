
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data, error } = await supabase
    .from("rendimiento_llamadas")
    .select("importe")
    .gte("fecha_hora", start);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  const totalFacturacion = (data || []).reduce((acc, r) => acc + (r.importe || 0), 0);

  return NextResponse.json({
    ok: true,
    facturacion_mes: totalFacturacion
  });
}
