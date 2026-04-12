import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getClientChatCredits, getChatWorkerStatusMeta } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

function lastPreview(text: any) {
  return String(text || "").trim().slice(0, 140) || null;
}

function parseWorkerPresentation(status: any) {
  const rawWelcome = String(status?.welcome_message || "").trim();
  const lower = rawWelcome.toLowerCase();
  const away = lower.startsWith("[vuelvo]") || lower.startsWith("[break]") || lower.includes("vuelvo en 5");
  const cleanWelcome = rawWelcome.replace(/^\[(vuelvo|break)\]\s*/i, "").trim() || null;
  return { away, cleanWelcome };
}

export async function GET(req: Request) {
  export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);

    // 🔐 solo validamos usuario
    if (!gate.uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const admin = gate.admin;

    // 🚨 cliente aún no creado → onboarding obligatorio
    if (!gate.cliente) {
      return NextResponse.json({
        ok: true,
        cliente: null,
        creditos_disponibles: 0,
        tarotistas: [],
        onboarding_required: true,
      });
    }

    // 👇 A PARTIR DE AQUÍ DEJAS TU CÓDIGO TAL CUAL

    if (statusErr) throw statusErr;
    if (threadsErr) throw threadsErr;
    if (workersErr) throw workersErr;

    const workerById = new Map<string, any>();
    for (const worker of workers || []) workerById.set(String(worker.id), worker);

    const threadByWorker = new Map<string, any>();
    for (const row of threads || []) {
      const key = String(row.tarotista_worker_id || "");
      if (key && !threadByWorker.has(key)) threadByWorker.set(key, row);
    }

    const balance = await getClientChatCredits(admin, gate.cliente.id);

    const tarotistas = (statusRows || [])
      .map((status: any) => {
        const workerId = String(status.worker_id || "");
        if (!workerId) return null;

        const worker = workerById.get(workerId) || null;
        const isTarotistaRole = !worker?.role || worker?.role === "tarotista";
        const isActiveWorker = worker?.is_active !== false;

        if (!isTarotistaRole || !isActiveWorker) return null;

        const thread = threadByWorker.get(workerId) || null;
        const presentation = parseWorkerPresentation(status);
        const baseMeta = getChatWorkerStatusMeta(status);
        const finalMeta = presentation.away
          ? {
              key: "vuelvo",
              label: "Vuelvo en 5 min",
              color: "#c084fc",
              bg: "rgba(168,85,247,.16)",
              border: "1px solid rgba(168,85,247,.34)",
            }
          : baseMeta;

        return {
          id: workerId,
          display_name: status?.visible_name || worker?.display_name || "Tarotista",
          team: worker?.team || null,
          status_key: finalMeta.key,
          status_label: finalMeta.label,
          status_color: finalMeta.color,
          status_bg: finalMeta.bg,
          status_border: finalMeta.border,
          chat_enabled: status?.chat_enabled !== false,
          is_online: Boolean(status?.is_online),
          is_busy: Boolean(status?.is_busy),
          welcome_message: presentation.cleanWelcome,
          current_thread_id: thread?.id ? String(thread.id) : null,
          current_thread_state: thread?.estado || null,
          current_thread_last_message_at: thread?.last_message_at || null,
          current_thread_last_message_preview: lastPreview(thread?.last_message_preview),
          free_consulta_usada: Boolean(thread?.free_consulta_usada),
          creditos_restantes: Math.max(0, Number(thread?.creditos_restantes || balance || 0)),
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      cliente: {
        id: gate.cliente.id,
        nombre: gate.cliente?.nombre || "",
        apellido: gate.cliente?.apellido || "",
        telefono: gate.cliente?.telefono || gate.cliente?.telefono_normalizado || "",
        email: gate.cliente?.email || gate.email || "",
        pais: gate.cliente?.pais || "",
        fecha_nacimiento: gate.cliente?.fecha_nacimiento || "",
        onboarding_completado: Boolean(gate.cliente?.onboarding_completado),
        nombre_completo:
          [gate.cliente?.nombre, gate.cliente?.apellido].filter(Boolean).join(" ").trim() ||
          gate.cliente?.nombre ||
          "Cliente",
      },
      creditos_disponibles: balance,
      tarotistas,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_CHAT_TAROTISTAS" }, { status: 500 });
  }
}
