
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: ingresos } = await supabase
    .from("crm_clientes_pagos")
    .select("importe");

  const totalIngresos = (ingresos||[])
    .reduce((a,p)=>a + Number(p.importe||0),0);

  const { data: gastos } = await supabase
    .from("worker_payments")
    .select("amount_eur");

  const totalGastos = (gastos||[])
    .reduce((a,p)=>a + Number(p.amount_eur||0),0);

  return NextResponse.json({
    ok: true,
    ingresos: totalIngresos,
    gastos: totalGastos,
    balance: totalIngresos - totalGastos
  });
}
