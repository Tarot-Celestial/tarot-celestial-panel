import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const token = auth.replace("Bearer ", "");
    const sb = getSupabase();

    const { data: userData } = await sb.auth.getUser(token);
    if (!userData?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const cliente_id = String(searchParams.get("cliente_id") || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "cliente_id requerido" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("crm_client_notes")
      .select("*")
      .eq("cliente_id", cliente_id)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ ok: true, notas: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
