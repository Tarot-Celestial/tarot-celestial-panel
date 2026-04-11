import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.message_id || "").trim();
    const mode = String(body?.mode || "").trim();
    if (!messageId) return NextResponse.json({ ok: false, error: "MISSING_MESSAGE_ID" }, { status: 400 });
    if (!["pregunta", "respuesta", "clear"].includes(mode)) {
      return NextResponse.json({ ok: false, error: "INVALID_MODE" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: message, error: readErr } = await admin
      .from("cliente_chat_messages")
      .select("id, meta")
      .eq("id", messageId)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!message) return NextResponse.json({ ok: false, error: "MESSAGE_NOT_FOUND" }, { status: 404 });

    const currentMeta = message?.meta && typeof message.meta === "object" ? message.meta : {};
    const nextMeta: Record<string, any> = {
      ...currentMeta,
      is_pregunta: mode === "pregunta",
      is_respuesta: mode === "respuesta",
      flagged_at: new Date().toISOString(),
    };

    if (mode === "clear") {
      nextMeta.is_pregunta = false;
      nextMeta.is_respuesta = false;
    }

    const { data, error } = await admin
      .from("cliente_chat_messages")
      .update({ meta: nextMeta })
      .eq("id", messageId)
      .select("id, meta")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, message: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_MESSAGE_FLAGS" }, { status: 500 });
  }
}
