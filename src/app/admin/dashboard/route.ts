import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const month = new Date().toISOString().slice(0,7);

  const { data: pagos } = await supabase
    .from("crm_clientes_pagos")
    .select("importe, created_at");

  const total = (pagos||[])
    .filter((p:any)=>p.created_at?.startsWith(month))
    .reduce((a:number,p:any)=>a + Number(p.importe||0),0);

  const { count: clientes } = await supabase
    .from("crm_clientes")
    .select("*", { count: "exact", head: true });

  const { count: rendimiento } = await supabase
    .from("rendimiento_llamadas")
    .select("*", { count: "exact", head: true })
    .gte('fecha', `${month}-01`)
    .lt('fecha', new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1)).toISOString().slice(0,10));

  const { count: workers } = await supabase
    .from("workers")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    ok: true,
    total,
    clientes,
    reservas: rendimiento,
    tarotistas: workers
  });
}
