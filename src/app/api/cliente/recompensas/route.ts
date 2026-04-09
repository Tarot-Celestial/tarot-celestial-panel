import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

export async function GET() {
  try {
    const admin = adminClient();
    const { data, error } = await admin
      .from("recompensas")
      .select("id, nombre, puntos_coste, minutos_otorgados, activo")
      .eq("activo", true)
      .order("puntos_coste", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, recompensas: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_RECOMPENSAS" }, { status: 500 });
  }
}
