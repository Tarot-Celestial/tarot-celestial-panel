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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "pendientes";

  let query = supabase
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
    .order("next_contact_at", { ascending: true });

  if (scope === "pendientes") {
    query = query.not(
      "estado",
      "in",
      '("contactado","no_interesado","numero_invalido","perdido")'
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  return NextResponse.json({ ok: true, items: data || [] });
}
