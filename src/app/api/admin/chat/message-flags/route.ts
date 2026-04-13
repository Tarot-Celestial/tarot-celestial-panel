import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";
import { addClientChatCredits, getClientChatCredits } from "@/lib/server/chat-platform";

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
      .select("id, thread_id, sender_type, sender_cliente_id, meta")
      .eq("id", messageId)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!message) return NextResponse.json({ ok: false, error: "MESSAGE_NOT_FOUND" }, { status: 404 });

    const currentMeta = message?.meta && typeof message.meta === "object" ? message.meta : {};
    const wasPregunta = Boolean(currentMeta?.is_pregunta);
    const wasRespuesta = Boolean(currentMeta?.is_respuesta);

    const nextMeta: Record<string, any> = {
      ...currentMeta,
      is_pregunta: mode === "pregunta",
      is_respuesta: mode === "respuesta",
      flagged_at: new Date().toISOString(),
      flagged_by: (gate.me as any)?.id || null,
    };

    if (mode === "clear") {
      nextMeta.is_pregunta = false;
      nextMeta.is_respuesta = false;
    }

    let balance: number | null = null;
    let threadPatch: Record<string, any> | null = null;

    if (message.sender_type === "cliente" && message.thread_id && message.sender_cliente_id) {
      const { data: thread, error: threadErr } = await admin
        .from("cliente_chat_threads")
        .select("id, cliente_id, free_consulta_usada, creditos_restantes")
        .eq("id", message.thread_id)
        .maybeSingle();
      if (threadErr) throw threadErr;

      if (thread) {
        const freeUsed = Boolean(thread.free_consulta_usada);

        if (!wasPregunta && mode === "pregunta") {
          if (!freeUsed) {
            threadPatch = {
              ...(threadPatch || {}),
              free_consulta_usada: true,
            };
            balance = await getClientChatCredits(admin, String(thread.cliente_id));
          } else {
            const result = await addClientChatCredits(admin, {
              clienteId: String(thread.cliente_id),
              threadId: String(thread.id),
              amount: -1,
              type: "consume",
              notes: "Descuento manual por mensaje marcado como pregunta",
              meta: { message_id: message.id, source: "admin_mark_question" },
            });
            balance = result.balance;
            threadPatch = {
              ...(threadPatch || {}),
              creditos_restantes: result.balance,
            };
          }
        }

        if (wasPregunta && mode !== "pregunta") {
          const result = await addClientChatCredits(admin, {
            clienteId: String(thread.cliente_id),
            threadId: String(thread.id),
            amount: 1,
            type: "refund",
            notes: "Reversión manual al quitar la marca de pregunta",
            meta: { message_id: message.id, source: "admin_unmark_question" },
          });
          balance = result.balance;
          threadPatch = {
            ...(threadPatch || {}),
            creditos_restantes: result.balance,
          };
        }
      }
    }

    const { data, error } = await admin
      .from("cliente_chat_messages")
      .update({ meta: nextMeta })
      .eq("id", messageId)
      .select("id, meta")
      .single();

    if (error) throw error;

    if (threadPatch && message.thread_id) {
      const finalPatch = {
        ...threadPatch,
        updated_at: new Date().toISOString(),
      };
      await admin.from("cliente_chat_threads").update(finalPatch).eq("id", message.thread_id);
    }

    return NextResponse.json({
      ok: true,
      message: data,
      balance,
      state: {
        wasPregunta,
        wasRespuesta,
        isPregunta: Boolean(nextMeta.is_pregunta),
        isRespuesta: Boolean(nextMeta.is_respuesta),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_MESSAGE_FLAGS" }, { status: 500 });
  }
}
