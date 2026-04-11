import { createClient } from "@/lib/supabaseServer";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = createClient();
  const { threadId } = await req.json();

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
}
