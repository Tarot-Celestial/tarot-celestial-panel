import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("reservas")
      .select("*")
      .order("fecha_reserva", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ reservas: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
