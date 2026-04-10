import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const workerId = String(body?.worker_id || "").trim();
    if (!workerId) return NextResponse.json({ ok: false, error: "MISSING_WORKER_ID" }, { status: 400 });

    const patch = {
      worker_id: workerId,
      is_online: body?.is_online === undefined ? true : Boolean(body.is_online),
      is_busy: Boolean(body?.is_busy),
      chat_enabled: body?.chat_enabled === undefined ? true : Boolean(body.chat_enabled),
      visible_name: body?.visible_name ? String(body.visible_name).trim() : null,
      welcome_message: body?.welcome_message ? String(body.welcome_message).trim() : null,
      updated_at: new Date().toISOString(),
    };

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("cliente_chat_tarotistas")
      .upsert(patch, { onConflict: "worker_id" })
      .select("worker_id, is_online, is_busy, chat_enabled, visible_name, welcome_message, updated_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, status: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_STATUS" }, { status: 500 });
  }
}
