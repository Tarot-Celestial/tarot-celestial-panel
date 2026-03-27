import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cliente_id = String(searchParams.get("cliente_id") || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "cliente_id requerido" }, { status: 400 });
    }

    const supabase = adminClient();

    const { data, error } = await supabase
      .from("crm_cliente_etiquetas")
      .select("etiqueta_id")
      .eq("cliente_id", cliente_id);

    if (error) throw error;

    const etiquetas = (data || []).map((r: any) => ({
      id: String(r.etiqueta_id),
      etiqueta_id: String(r.etiqueta_id),
    }));

    return NextResponse.json({ ok: true, etiquetas });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
