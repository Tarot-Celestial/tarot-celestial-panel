import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const today = new Date();
  const start = new Date(today.setHours(0, 0, 0, 0)).toISOString();
  const end = new Date(today.setHours(23, 59, 59, 999)).toISOString();

  const { data, error } = await supabase
    .from("rendimiento_llamadas")
    .select("*")
    .gte("fecha_hora", start)
    .lte("fecha_hora", end);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  const total = data.length;
  const importe = data.reduce((acc, r) => acc + (r.importe || 0), 0);
  const minutos = data.reduce((acc, r) => acc + (r.tiempo || 0), 0);
  const captados = data.filter((r) => r.captado).length;

  return NextResponse.json({
    ok: true,
    total,
    importe,
    minutos,
    captados,
  });
}
