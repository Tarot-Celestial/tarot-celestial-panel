
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const threadId = String(body?.threadId || body?.thread_id || "").trim();

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { error } = await admin
      .from("cliente_chat_threads")
      .update({
        estado: "closed",
      })
      .eq("id", threadId);

    if (error) throw error;

    return NextResponse.json({ ok: true, thread_id: threadId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_CLOSE_THREAD" }, { status: 500 });
  }
}
