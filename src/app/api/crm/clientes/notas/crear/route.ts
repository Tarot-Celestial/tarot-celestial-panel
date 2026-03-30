import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const token = auth.replace("Bearer ", "");
    const sb = getSupabase();

    const { data: userData } = await sb.auth.getUser(token);
    const user = userData?.user;

    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const cliente_id = String(body?.cliente_id || "").trim();
    const texto = String(body?.texto || "").trim();

    if (!cliente_id || !texto) {
      return NextResponse.json({ ok: false, error: "Datos inválidos" }, { status: 400 });
    }

    const { data: worker } = await sb
      .from("workers")
      .select("display_name, email")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data, error } = await sb
      .from("crm_client_notes")
      .insert({
        cliente_id,
        texto,
        author_user_id: user.id,
        author_name: worker?.display_name || user.email || "Usuario",
        author_email: worker?.email || user.email || null,
        is_pinned: false,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, nota: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
