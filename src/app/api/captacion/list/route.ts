export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") || "pendientes";

    let query = supabase
      .from("captacion_leads")
      .select(`
        *,
        cliente:crm_clientes(*)
      `)
      .order("created_at", { ascending: false });

    // 🔥 SOLO FILTRAMOS POR ESTADO (NO POR FECHA)
    if (scope === "pendientes") {
      query = query.not("estado", "in", '("contactado","no_interesado","numero_invalido","perdido")');
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
