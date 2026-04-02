import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

export async function GET(req: Request) {
  try {
    const admin = adminClient();

    // 🔥 SIN FILTROS (para asegurar que funciona)
    const { data, error } = await admin
      .from("rendimiento_llamadas")
      .select("*")
      .order("fecha_hora", { ascending: false });

    if (error) {
      console.error("❌ ERROR LISTADO:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    console.log("📊 REGISTROS ENCONTRADOS:", data?.length);

    return NextResponse.json({
      ok: true,
      data: data || [],
    });

  } catch (e: any) {
    console.error("🔥 ERROR GENERAL LISTAR:", e);
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
