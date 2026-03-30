import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const id = String(body?.id || "");
    const is_pinned = !!body?.is_pinned;

    if (!id) {
      return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    }

    const { error } = await supabase
      .from("crm_client_notes")
      .update({ is_pinned })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
