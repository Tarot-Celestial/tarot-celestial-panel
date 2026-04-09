export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabase = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY")
);

const CLOSED_STATUSES = new Set(["contactado", "no_interesado", "numero_invalido", "perdido"]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "pendientes").trim().toLowerCase();

    const { data, error } = await supabase
      .from("captacion_leads")
      .select(`
        id,
        cliente_id,
        estado,
        intento_actual,
        max_intentos,
        next_contact_at,
        last_contact_at,
        contacted_at,
        closed_at,
        last_result,
        campaign_name,
        form_name,
        origen,
        assigned_worker_id,
        assigned_role,
        notas,
        created_at,
        updated_at,
        cliente:crm_clientes(
          id,
          nombre,
          apellido,
          telefono,
          email,
          origen,
          estado,
          lead_status,
          lead_campaign_name,
          lead_form_name,
          created_at
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let items = Array.isArray(data) ? data : [];

    // Filtro en servidor para evitar inconsistencias del operador SQL .not(... in ...)
    if (scope === "pendientes") {
      items = items.filter((item: any) => !CLOSED_STATUSES.has(String(item?.estado || "").toLowerCase()));
    }

    // Orden útil para call-center: primero vencidos / toca llamar, luego más antiguos
    items.sort((a: any, b: any) => {
      const aNext = a?.next_contact_at ? new Date(a.next_contact_at).getTime() : 0;
      const bNext = b?.next_contact_at ? new Date(b.next_contact_at).getTime() : 0;
      const aCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
      if (aNext !== bNext) return aNext - bNext;
      return aCreated - bCreated;
    });

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "ERR" }, { status: 500 });
  }
}
