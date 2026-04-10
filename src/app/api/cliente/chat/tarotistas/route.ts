import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getClientChatCredits, getChatWorkerStatusMeta } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

function lastPreview(text: any) {
  return String(text || "").trim().slice(0, 140) || null;
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const admin = gate.admin;

    const [{ data: workers, error: workersErr }, { data: statusRows, error: statusErr }, { data: threads, error: threadsErr }] = await Promise.all([
      admin
        .from("workers")
        .select("id, display_name, team, role, is_active")
        .eq("role", "tarotista")
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
      admin
        .from("cliente_chat_tarotistas")
        .select("worker_id, is_online, is_busy, chat_enabled, visible_name, welcome_message, updated_at")
        .order("updated_at", { ascending: false }),
      admin
        .from("cliente_chat_threads")
        .select("id, tarotista_worker_id, estado, free_consulta_usada, creditos_restantes, last_message_at, last_message_preview")
        .eq("cliente_id", gate.cliente.id)
        .order("last_message_at", { ascending: false }),
    ]);

    if (workersErr) throw workersErr;
    if (statusErr) throw statusErr;
    if (threadsErr) throw threadsErr;

    const statusByWorker = new Map<string, any>();
    for (const row of statusRows || []) {
      statusByWorker.set(String(row.worker_id), row);
    }

    const threadByWorker = new Map<string, any>();
    for (const row of threads || []) {
      const key = String(row.tarotista_worker_id || "");
      if (key && !threadByWorker.has(key)) threadByWorker.set(key, row);
    }

    const balance = await getClientChatCredits(admin, gate.cliente.id);

    const tarotistas = (workers || []).map((worker: any) => {
      const status = statusByWorker.get(String(worker.id)) || null;
      const meta = getChatWorkerStatusMeta(status);
      const thread = threadByWorker.get(String(worker.id)) || null;
      return {
        id: String(worker.id),
        display_name: status?.visible_name || worker.display_name || "Tarotista",
        team: worker.team || null,
        status_key: meta.key,
        status_label: meta.label,
        status_color: meta.color,
        status_bg: meta.bg,
        status_border: meta.border,
        chat_enabled: status?.chat_enabled !== false,
        is_online: Boolean(status?.is_online),
        is_busy: Boolean(status?.is_busy),
        welcome_message: status?.welcome_message || null,
        current_thread_id: thread?.id ? String(thread.id) : null,
        current_thread_state: thread?.estado || null,
        current_thread_last_message_at: thread?.last_message_at || null,
        current_thread_last_message_preview: lastPreview(thread?.last_message_preview),
        free_consulta_usada: Boolean(thread?.free_consulta_usada),
        creditos_restantes: Math.max(0, Number(thread?.creditos_restantes || balance || 0)),
      };
    });

    return NextResponse.json({
      ok: true,
      cliente: {
        id: gate.cliente.id,
        nombre: [gate.cliente?.nombre, gate.cliente?.apellido].filter(Boolean).join(" ").trim() || gate.cliente?.nombre || "Cliente",
      },
      creditos_disponibles: balance,
      tarotistas,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_CHAT_TAROTISTAS" }, { status: 500 });
  }
}
