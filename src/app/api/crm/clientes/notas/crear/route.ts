import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const token = auth.slice("Bearer ".length);
    const sb = getSupabase();

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const cliente_id = String(body?.cliente_id || "").trim();
    const texto = String(body?.texto || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "cliente_id es obligatorio" }, { status: 400 });
    }
    if (!texto) {
      return NextResponse.json({ ok: false, error: "texto es obligatorio" }, { status: 400 });
    }

    const { data: worker } = await sb
      .from("workers")
      .select("display_name, email")
      .eq("user_id", user.id)
      .maybeSingle();

    const payload = {
      cliente_id,
      texto,
      author_user_id: user.id,
      author_name: worker?.display_name || user.email || "Usuario",
      author_email: worker?.email || user.email || null,
    };

    const { data, error } = await sb
      .from("crm_client_notes")
      .insert(payload)
      .select("id, cliente_id, texto, author_user_id, author_name, author_email, created_at")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, nota: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error interno" }, { status: 500 });
  }
}
