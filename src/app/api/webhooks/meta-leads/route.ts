import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

function normalizarTelefono(tel: string | null) {
  if (!tel) return null;

  // quitar espacios, guiones, etc
  let limpio = tel.replace(/\D/g, "");

  // si empieza sin +, asumimos España
  if (!limpio.startsWith("34") && limpio.length === 9) {
    limpio = "34" + limpio;
  }

  return limpio;
}

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

    const telefono_normalizado = normalizarTelefono(telefono);

   let telefono_normalizado = normalizarTelefono(telefono);

// 🔥 fallback si no hay teléfono
if (!telefono_normalizado) {
  telefono_normalizado = "sin_telefono_" + Date.now();
}

    const { data: cliente, error } = await supabase
      .from("crm_clientes")
      .insert([
        {
          nombre,
          telefono,
          telefono_normalizado, // 🔥 CLAVE
          email,
          origen: origen || "facebook_ads",
        },
      ])
      .select()
      .single();

    if (error) throw error;

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
