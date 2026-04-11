import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const { threadId } = await req.json();

    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
    }

    const { error } = await supabase
      .from("cliente_chat_threads")
      .update({
        is_closed: true,
        closed_at: new Date().toISOString(),
      })
      .eq("id", threadId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
