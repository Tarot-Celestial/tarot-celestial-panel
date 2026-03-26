import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { cliente_id, tarotista_worker_id, fecha_reserva, nota } = body;

    const { error } = await supabase.from("crm_reservas").insert({
      cliente_id,
      tarotista_worker_id,
      fecha_reserva,
      nota,
      estado: "pendiente",
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
