export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("reservas")
      .select("*")
      .gte("fecha_reserva", now)
      .order("fecha_reserva", { ascending: true })
      .limit(5);

    if (error) throw error;

    return NextResponse.json({ reservas: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
