import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  try {
    // 👉 AQUÍ SIMULAMOS QUE YA TIENES LOS DATOS DEL SHEET
    // (luego si quieres conectamos Google Sheets real)

    const fakeData = [
      {
        call_date: "2026-03-31",
        telefonista: "Maria",
        tarotista: "Ana",
        minutos: 10,
        codigo: "cliente",
        importe: 15,
        captada: true,
      },
    ];

    // 👉 Insertamos en Supabase (tabla real: calls)
    const { data, error } = await supabase
      .from("calls")
      .insert(fakeData);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    return NextResponse.json({
      ok: true,
      inserted: data?.length || 0,
    });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e.message,
    });
  }
}
