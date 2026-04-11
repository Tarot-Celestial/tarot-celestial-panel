import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getClientChatCredits, addClientChatCredits, getChatWorkerStatusMeta } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

async function getOrCreateThread(admin: any, clienteId: string, workerId: string) {
  const { data: existing, error: existingErr } = await admin
    .from("cliente_chat_threads")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("tarotista_worker_id", workerId)
    .neq("estado", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) throw existingErr;
  if (existing?.id) return existing;

  const currentBalance = await getClientChatCredits(admin, clienteId);

  const { data: created, error: createErr } = await admin
    .from("cliente_chat_threads")
    .insert({
      cliente_id: clienteId,
      tarotista_worker_id: workerId,
      estado: "open",
      free_consulta_usada: false,
      free_reply_used: false,
      creditos_restantes: currentBalance,
      asignacion_fija: true,
      last_message_at: new Date().toISOString(),
      last_message_preview: "Hilo creado",
    })
    .select("*")
    .single();

  if (createErr) {
    if (createErr.message?.includes("duplicate key")) {
      const { data: retry, error: retryErr } = await admin
        .from("cliente_chat_threads")
        .select("*")
        .eq("cliente_id", clienteId)
        .eq("tarotista_worker_id", workerId)
        .neq("estado", "closed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (retryErr) throw retryErr;
      if (retry?.id) return retry;
    }

    throw createErr;
  }

  return created;
}

async function readMessages(admin: any, threadId: string) {
  const { data, error } = await admin
    .from("cliente_chat_messages")
    .select("id, thread_id, sender_type, sender_worker_id, sender_cliente_id, sender_display_name, body, kind, meta, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw error;
  return data || [];
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const workerId = String(searchParams.get("worker_id") || "").trim();
    const threadId = String(searchParams.get("thread_id") || "").trim();
    if (!workerId && !threadId) return NextResponse.json({ ok: false, error: "MISSING_TARGET" }, { status: 400 });

    const admin = gate.admin;
    let thread: any = null;

    if (threadId) {
      const { data, error } = await admin
        .from("cliente_chat_threads")
        .select("*")
        .eq("id", threadId)
        .eq("cliente_id", gate.cliente.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
      thread = data;
    } else {
      thread = await getOrCreateThread(admin, gate.cliente.id, workerId);
    }

    const [workerRes, statusRes, messages, balance] = await Promise.all([
      admin.from("workers").select("id, display_name, team").eq("id", thread.tarotista_worker_id).maybeSingle(),
      admin
        .from("cliente_chat_tarotistas")
        .select("worker_id, is_online, is_busy, chat_enabled, visible_name, welcome_message")
        .eq("worker_id", thread.tarotista_worker_id)
        .maybeSingle(),
      readMessages(admin, thread.id),
      getClientChatCredits(admin, gate.cliente.id),
    ]);

    if (workerRes.error) throw workerRes.error;
    if (statusRes.error) throw statusRes.error;

    const worker = workerRes.data || null;
    const status = statusRes.data || null;
    const statusMeta = getChatWorkerStatusMeta(status);

    const nextBalance = Math.max(0, Number(thread?.creditos_restantes || balance || 0));
    if (nextBalance !== Number(thread?.creditos_restantes || 0)) {
      await admin.from("cliente_chat_threads").update({ creditos_restantes: nextBalance }).eq("id", thread.id);
      thread.creditos_restantes = nextBalance;
    }

    return NextResponse.json({
      ok: true,
      thread: {
        ...thread,
        tarotista_display_name: status?.visible_name || worker?.display_name || "Tarotista",
        tarotista_team: worker?.team || null,
        tarotista_status_key: statusMeta?.key || "desconectada",
        tarotista_status_label: statusMeta?.label || "Desconectada",
        tarotista_status_color: statusMeta?.color || "#cbd5e1",
        tarotista_welcome_message: status?.welcome_message || null,
        creditos_restantes: nextBalance,
      },
      messages,
      creditos_disponibles: balance,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_CHAT_THREAD_GET" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const workerId = String(body?.worker_id || "").trim();
    const threadId = String(body?.thread_id || "").trim();
    const text = String(body?.body || body?.text || "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "EMPTY_BODY" }, { status: 400 });

    const admin = gate.admin;
    let thread: any = null;

    if (threadId) {
      const { data, error } = await admin
        .from("cliente_chat_threads")
        .select("*")
        .eq("id", threadId)
        .eq("cliente_id", gate.cliente.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
      thread = data;
    } else {
      if (!workerId) return NextResponse.json({ ok: false, error: "MISSING_WORKER_ID" }, { status: 400 });
      thread = await getOrCreateThread(admin, gate.cliente.id, workerId);
    }

    const currentBalance = await getClientChatCredits(admin, gate.cliente.id);
    const freeUsed = Boolean(thread?.free_consulta_usada);
    let nextBalance = currentBalance;

    if (freeUsed) {
      if (currentBalance <= 0) {
        return NextResponse.json({ ok: false, error: "NO_CREDITOS", need_payment: true, thread_id: thread.id }, { status: 402 });
      }
      const ledger = await addClientChatCredits(admin, {
        clienteId: gate.cliente.id,
        threadId: thread.id,
        amount: -1,
        type: "consume",
        notes: "Consumo de 1 crédito por mensaje del cliente",
      });
      nextBalance = ledger.balance;
    }

    const senderName =
      [gate.cliente?.nombre, gate.cliente?.apellido].filter(Boolean).join(" ").trim() ||
      gate.cliente?.nombre ||
      "Cliente";
    const nowIso = new Date().toISOString();

    const { data: inserted, error: insertErr } = await admin
      .from("cliente_chat_messages")
      .insert({
        thread_id: thread.id,
        sender_type: "cliente",
        sender_cliente_id: gate.cliente.id,
        sender_display_name: senderName,
        body: text,
        kind: "text",
      })
      .select("id, thread_id, sender_type, sender_worker_id, sender_cliente_id, sender_display_name, body, kind, meta, created_at")
      .single();
    if (insertErr) throw insertErr;

    const { error: updateErr } = await admin
      .from("cliente_chat_threads")
      .update({
        estado: "open",
        free_consulta_usada: true,
        creditos_restantes: nextBalance,
        last_message_at: nowIso,
        last_message_preview: text.slice(0, 140),
      })
      .eq("id", thread.id);
    if (updateErr) throw updateErr;

    await admin
      .from("cliente_chat_tarotistas")
      .update({ is_busy: true, updated_at: nowIso })
      .eq("worker_id", thread.tarotista_worker_id);

    return NextResponse.json({
      ok: true,
      thread_id: thread.id,
      message: inserted,
      creditos_restantes: nextBalance,
      free_consulta_usada: true,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_CHAT_THREAD_POST" }, { status: 500 });
  }
}
