import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rouletteStaff, RouletteAccessError } from "@/lib/server/ruleta-access";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { admin: supabase } = await rouletteStaff(req);
    const body = await req.json();

    const id = String(body?.id || "").trim();
    const texto = String(body?.texto || "").trim();

    if (!id || !texto) {
      return NextResponse.json({ ok: false, error: "Datos inválidos" }, { status: 400 });
    }

    const { data: note, error: noteError } = await supabase.from("crm_client_notes").select("id,ruleta_spin_id").eq("id", id).maybeSingle();
    if (noteError) throw noteError;
    if (!note) return NextResponse.json({ ok: false, error: "Nota no encontrada." }, { status: 404 });
    if (note.ruleta_spin_id) return NextResponse.json({ ok: false, error: "Los premios son registros de solo lectura." }, { status: 409 });
    const { error } = await supabase
      .from("crm_client_notes")
      .update({ texto })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e instanceof RouletteAccessError ? e.message : "No se pudo actualizar la nota." }, { status: e instanceof RouletteAccessError ? e.status : 500 });
  }
}
