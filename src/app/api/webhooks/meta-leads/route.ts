import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { nombre, telefono, email, origen } = body;

    if (!telefono && !email) {
      return NextResponse.json(
        { ok: false, error: "Datos insuficientes" },
        { status: 400 }
      );
    }

    // Crear cliente directamente
    const { data: cliente, error } = await supabase
      .from("crm_clientes")
      .insert([
        {
          nombre,
          telefono,
          email,
          origen: origen || "facebook_ads",
          estado: "nuevo_lead",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    // Crear notificación
    await supabase.from("notificaciones").insert([
      {
        tipo: "nuevo_lead",
        mensaje: `Nuevo lead: ${nombre || telefono}`,
        leido: false,
        referencia_id: cliente.id,
      },
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
