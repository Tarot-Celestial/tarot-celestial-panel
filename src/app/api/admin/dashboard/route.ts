
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const now = new Date();

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date();

  const { data: rows, error } = await supabase
    .from("rendimiento_llamadas")
    .select("importe, fecha_hora");

  if (error) {
    console.error(error);
    return NextResponse.json({ ok:false, error:error.message });
  }

  const filtered = (rows || []).filter((r:any) => {
    if (!r.fecha_hora) return false;
    const d = new Date(r.fecha_hora);
    return d >= start && d <= end;
  });

  const totalFacturacion = filtered.reduce(
    (acc:number, r:any) => acc + (Number(r.importe) || 0),
    0
  );

  return NextResponse.json({
    ok:true,
    facturacion_mes: totalFacturacion
  });
}
