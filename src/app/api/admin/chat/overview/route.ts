import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";
import { getChatWorkerStatusMeta } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const admin = supabaseAdmin();
    const [workersRes, statusRes, threadsRes, creditsRes] = await Promise.all([
      admin.from("workers").select("id, display_name, role, team, is_active").eq("role", "tarotista").eq("is_active", true).order("display_name", { ascending: true }),
      admin.from("cliente_chat_tarotistas").select("worker_id, is_online, is_busy, chat_enabled, visible_name, welcome_message, updated_at"),
      admin
        .from("cliente_chat_threads")
        .select("id, cliente_id, tarotista_worker_id, estado, free_consulta_usada, free_reply_used, creditos_restantes, last_message_at, last_message_preview, created_at")
        .neq("estado", "closed")
        .order("last_message_at", { ascending: false })
        .limit(500),
      admin.from("cliente_chat_creditos").select("cliente_id, saldo_resultante, created_at").order("created_at", { ascending: false }).limit(1000),
    ]);
    if (workersRes.error) throw workersRes.error;
    if (statusRes.error) throw statusRes.error;
    if (threadsRes.error) throw threadsRes.error;
    if (creditsRes.error) throw creditsRes.error;

    const threads = threadsRes.data || [];
    const clienteIds = Array.from(new Set(threads.map((t: any) => String(t.cliente_id || "")).filter(Boolean)));

    const [clientesRes, messagesRes] = await Promise.all([
      admin.from("crm_clientes").select("id, nombre, apellido, telefono, telefono_normalizado, email").in("id", clienteIds.length ? clienteIds : ["00000000-0000-0000-0000-000000000000"]),
      admin.from("cliente_chat_messages").select("thread_id, sender_type, sender_display_name, body, created_at").in("thread_id", threads.length ? threads.map((t: any) => t.id) : ["00000000-0000-0000-0000-000000000000"]).order("created_at", { ascending: false }),
    ]);
    if (clientesRes.error) throw clientesRes.error;
    if (messagesRes.error) throw messagesRes.error;

    const statusByWorker = new Map<string, any>();
    for (const row of statusRes.data || []) statusByWorker.set(String(row.worker_id), row);

    const workerById = new Map<string, any>();
    for (const w of workersRes.data || []) workerById.set(String(w.id), w);

    const creditByCliente = new Map<string, number>();
    for (const row of creditsRes.data || []) {
      const key = String(row.cliente_id || "");
      if (key && !creditByCliente.has(key)) creditByCliente.set(key, Math.max(0, Number(row.saldo_resultante || 0)));
    }

    const clienteById = new Map<string, any>();
    for (const c of clientesRes.data || []) clienteById.set(String(c.id), c);

    const lastMessageByThread = new Map<string, any>();
    for (const m of messagesRes.data || []) {
      const key = String(m.thread_id || "");
      if (key && !lastMessageByThread.has(key)) lastMessageByThread.set(key, m);
    }

    const tarotistas = (workersRes.data || []).map((worker: any) => {
      const status = statusByWorker.get(String(worker.id)) || null;
      const meta = getChatWorkerStatusMeta(status);
      const openThreads = threads.filter((t: any) => String(t.tarotista_worker_id) === String(worker.id) && String(t.estado || "open") !== "closed").length;
      return {
        id: String(worker.id),
        display_name: status?.visible_name || worker.display_name || "Tarotista",
        team: worker.team || null,
        status_key: meta.key,
        status_label: meta.label,
        status_color: meta.color,
        status_bg: meta.bg,
        status_border: meta.border,
        is_online: Boolean(status?.is_online),
        chat_enabled: status?.chat_enabled !== false,
        is_busy: Boolean(status?.is_busy),
        open_threads: openThreads,
        welcome_message: status?.welcome_message || null,
      };
    });

    const outThreads = threads.map((thread: any) => {
      const cliente = clienteById.get(String(thread.cliente_id)) || null;
      const last = lastMessageByThread.get(String(thread.id)) || null;
      return {
        ...thread,
        cliente_nombre: [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || cliente?.nombre || "Cliente",
        cliente_telefono: cliente?.telefono || cliente?.telefono_normalizado || "",
        cliente_email: cliente?.email || null,
        tarotista_display_name: statusByWorker.get(String(thread.tarotista_worker_id))?.visible_name || workerById.get(String(thread.tarotista_worker_id))?.display_name || "Tarotista",
        creditos_cliente: creditByCliente.get(String(thread.cliente_id)) || Math.max(0, Number(thread.creditos_restantes || 0)),
        last_sender_type: last?.sender_type || null,
        last_sender_display_name: last?.sender_display_name || null,
        last_message_preview: String(last?.body || thread?.last_message_preview || "").slice(0, 140) || null,
      };
    });

    const summary = {
      total_threads: outThreads.length,
      open_threads: outThreads.filter((t: any) => String(t.estado || "open") !== "closed").length,
      pending_payment: outThreads.filter((t: any) => Number(t.creditos_cliente || 0) <= 0 && Boolean(t.free_consulta_usada)).length,
      tarotistas_online: tarotistas.filter((t: any) => t.status_key !== "desconectada").length,
      tarotistas_busy: tarotistas.filter((t: any) => t.status_key === "ocupada").length,
    };

    return NextResponse.json({ ok: true, summary, tarotistas, threads: outThreads });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_OVERVIEW" }, { status: 500 });
  }
}
