import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { worker_id, team } = await req.json();

    if (!worker_id || !team) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const { error } = await supabase
      .from("workers")
      .update({ team })
      .eq("id", worker_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
