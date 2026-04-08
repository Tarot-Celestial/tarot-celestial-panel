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
  const { data, error } = await supabase
    .from("captacion_leads")
    .select("*")
    // 🔥 SOLO EXCLUIMOS LOS CERRADOS (MUCHO MÁS ROBUSTO)
    .not(
      "estado",
      "in",
      '("contactado","no_interesado","numero_invalido","perdido")'
    )
    .order("next_contact_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  return NextResponse.json({ ok: true, items: data });
}
