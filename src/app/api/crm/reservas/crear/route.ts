import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      cliente_id,
      cliente_nombre,
      tarotista_id,
      tarotista_nombre,
      fecha_reserva,
      nota,
    } = body;

    if (!fecha_reserva) {
      return NextResponse.json(
        { error: "fecha_reserva requerida" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("reservas").insert({
      cliente_id,
      cliente_nombre,
      tarotista_id,
      tarotista_nombre,
      fecha_reserva,
      nota: nota || null,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("crear reserva error:", err);
    return NextResponse.json(
      { error: err.message || "Error interno" },
      { status: 500 }
    );
  }
}
