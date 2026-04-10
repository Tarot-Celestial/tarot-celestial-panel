import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";
import { addClientChatCredits } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body?.cliente_id || "").trim();
    const threadId = String(body?.thread_id || "").trim() || null;
    const amount = Math.trunc(Number(body?.amount || 0));
    const notes = String(body?.notes || "").trim() || null;
    if (!clienteId) return NextResponse.json({ ok: false, error: "MISSING_CLIENTE_ID" }, { status: 400 });
    if (!amount) return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });

    const admin = supabaseAdmin();
    const result = await addClientChatCredits(admin, {
      clienteId,
      threadId,
      amount,
      type: amount > 0 ? "admin_add" : "admin_remove",
      notes,
      meta: {
        actor_role: gate.me?.role || null,
        actor_user: gate.me?.user?.email || null,
      },
    });

    if (threadId) {
      await admin.from("cliente_chat_threads").update({ creditos_restantes: result.balance }).eq("id", threadId);
    }

    return NextResponse.json({ ok: true, balance: result.balance, ledger: result.ledger });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_CREDITS" }, { status: 500 });
  }
}
