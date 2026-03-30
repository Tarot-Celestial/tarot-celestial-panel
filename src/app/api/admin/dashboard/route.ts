
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
    .filter(p=>p.created_at?.startsWith(month))
    .reduce((a,p)=>a + Number(p.importe||0),0);

  const { count: clientes } = await supabase
    .from("crm_clientes")
    .select("*", { count: "exact", head: true });

  const { count: llamadas } = await supabase
    .from("calls")
    .select("*", { count: "exact", head: true });

  const { count: workers } = await supabase
    .from("workers")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    ok: true,
    total,
    clientes,
    reservas: llamadas,
    tarotistas: workers
  });
}
