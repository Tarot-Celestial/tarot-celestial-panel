import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ACCESS_PASSWORD = "Nosotrostarot1.";

export async function GET(request: NextRequest) {
  if (request.headers.get("x-contabilidad-password") !== ACCESS_PASSWORD) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ events: [], dbReady: false });
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 200, 1), 500);
  const { data, error } = await supabaseAdmin.from("manual_accounting_audit").select("id, movement_id, action, occurred_at, actor_user_id, database_role, source, old_data, new_data").order("occurred_at", { ascending: false }).limit(limit);
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ events: [], auditReady: false, error: "Ejecuta el SQL de auditoría incluido." });
    return NextResponse.json({ error: "No se pudo cargar el historial de comparación." }, { status: 500 });
  }
  return NextResponse.json({ events: data || [], auditReady: true });
}
