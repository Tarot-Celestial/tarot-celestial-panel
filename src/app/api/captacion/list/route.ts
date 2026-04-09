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
      *,
      cliente:crm_clientes(*)
    `)
    .order("created_at", { ascending: false });

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
