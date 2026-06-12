import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getChatWorkerStatusMeta } from "@/lib/server/chat-platform";
import { monthRange, roundMoney } from "@/lib/server/auth-worker";
import { aggregateRendimientoByTarotista, listRendimientoRows, listTarotistaWorkers } from "@/lib/server/rendimiento-metrics";

export const runtime = "nodejs";

type TarotistaCard = {
  id: string;
  nombre: string;
  team?: string | null;
  rango: "A" | "B";
  media: number;
  puntuacion: number;
  score: number;
  llamadas_mes: number;
  minutos_mes: number;
  estado_key: string;
  estado_label: string;
  estado_color: string;
  estado_bg: string;
  estado_border: string;
  disponible: boolean;
  especialidad: string;
  experiencia: string;
  estilo: string;
  descripcion: string;
  iniciales: string;
};

const SPECIALTIES = [
  "Amor, reconciliaciones y vínculos de alma",
  "Energía emocional, decisiones y bloqueos",
  "Pareja, compatibilidad y caminos abiertos",
  "Intuición espiritual, sueños y señales",
  "Trabajo, protección energética y propósito",
  "Lecturas rápidas, claridad y consejos directos",
];

const STYLES = [
  "Cercana, dulce y muy clara",
  "Directa, espiritual y protectora",
  "Empática, profunda y práctica",
  "Serena, intuitiva y muy detallista",
  "Rápida, honesta y resolutiva",
  "Calmada, luminosa y muy acompañante",
];

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function hashIndex(value: string, length: number) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return length ? hash % length : 0;
}

function initials(name: string) {
  const parts = String(name || "Tarotista").split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "TC";
}

function cleanName(value: unknown) {
  return String(value || "").trim();
}

function isCallName(value: unknown) {
  const name = cleanName(value).toLowerCase();
  return name === "call" || /^call\s*\d*$/i.test(name) || name.includes(" call ");
}

function averageScore(row: any) {
  const calls = Math.max(0, Number(row?.calls_total || 0));
  const pctCliente = Math.max(0, Math.min(100, Number(row?.pct_cliente || 0)));
  const pctRepite = Math.max(0, Math.min(100, Number(row?.pct_repite || 0)));

  // Puntuación pública 1-10 basada SOLO en calidad de rendimiento:
  // media de % Cliente y % Repite. No usa euros, importes ni factura.
  if (!calls && !pctCliente && !pctRepite) return 0;
  const raw = ((pctCliente + pctRepite) / 2) / 10;
  return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const admin = gate.admin;
    const url = new URL(req.url);
    const month = /^\d{4}-\d{2}$/.test(String(url.searchParams.get("month") || ""))
      ? String(url.searchParams.get("month"))
      : currentMonthKey();
    const { start, endExclusive } = monthRange(month);

    const [workers, rows, statusRes] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRows(start, endExclusive),
      admin
        .from("cliente_chat_tarotistas")
        .select("worker_id, is_online, is_busy, chat_enabled, visible_name, welcome_message, updated_at"),
    ]);

    if (statusRes.error) throw statusRes.error;

    const statusByWorker = new Map<string, any>();
    for (const status of statusRes.data || []) {
      const wid = String((status as any).worker_id || "");
      if (wid) statusByWorker.set(wid, status);
    }

    const aggregated = aggregateRendimientoByTarotista(rows, workers);
    const metricByWorker = new Map<string, any>();
    for (const row of aggregated || []) metricByWorker.set(String(row.worker_id), row);

    const scoreList = aggregated
      .filter((row: any) => !isCallName(row?.display_name))
      .map((row: any) => ({ worker_id: String(row.worker_id), score: averageScore(row) }))
      .sort((a, b) => b.score - a.score);

    const positiveScores = scoreList.filter((x) => x.score > 0);
    const midpoint = positiveScores.length ? Math.ceil(positiveScores.length / 2) : 0;
    const rangoAIds = new Set(positiveScores.slice(0, midpoint).map((x) => x.worker_id));

    const tarotistas: TarotistaCard[] = (workers || [])
      .filter((worker: any) => worker?.is_active !== false)
      .filter((worker: any) => String(worker?.role || "tarotista") === "tarotista")
      .filter((worker: any) => !isCallName(worker?.display_name))
      .map((worker: any) => {
        const workerId = String(worker.id);
        const status = statusByWorker.get(workerId) || null;
        const meta = getChatWorkerStatusMeta(status || { is_online: false, is_busy: false, chat_enabled: false });
        const metric = metricByWorker.get(workerId) || {};
        const score = averageScore(metric);
        const name = cleanName(status?.visible_name || worker?.display_name || "Tarotista Celestial");
        const idx = hashIndex(workerId + name, SPECIALTIES.length);
        const available = Boolean(status?.chat_enabled !== false && status?.is_online && !status?.is_busy);
        const rango: "A" | "B" = rangoAIds.has(workerId) ? "A" : "B";
        const calls = Number(metric?.calls_total || 0) || 0;
        const puntuacion = score;

        return {
          id: workerId,
          nombre: name,
          team: worker?.team || null,
          rango,
          media: puntuacion,
          puntuacion,
          score,
          llamadas_mes: calls,
          minutos_mes: roundMoney(Number(metric?.minutes_total || 0) || 0),
          estado_key: meta.key,
          estado_label: available ? "Disponible ahora" : meta.label || "No disponible",
          estado_color: available ? "#63f6b2" : meta.color,
          estado_bg: available ? "rgba(99,246,178,.16)" : meta.bg,
          estado_border: available ? "1px solid rgba(99,246,178,.34)" : meta.border,
          disponible: available,
          especialidad: SPECIALTIES[idx],
          experiencia: `${7 + hashIndex(workerId, 12)} años de experiencia`,
          estilo: STYLES[hashIndex(name + workerId, STYLES.length)],
          descripcion:
            status?.welcome_message?.replace(/^\[(vuelvo|break)\]\s*/i, "").trim() ||
            "Lectura cercana y profesional para ayudarte a entender la energía de tu situación y tomar decisiones con más calma.",
          iniciales: initials(name),
        };
      })
      .sort((a, b) => Number(b.disponible) - Number(a.disponible) || a.rango.localeCompare(b.rango) || b.score - a.score || a.nombre.localeCompare(b.nombre));

    return NextResponse.json({
      ok: true,
      month,
      total: tarotistas.length,
      disponibles: tarotistas.filter((t) => t.disponible).length,
      rango_a: tarotistas.filter((t) => t.rango === "A").length,
      rango_b: tarotistas.filter((t) => t.rango === "B").length,
      tarotistas,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_TAROTISTAS" }, { status: 500 });
  }
}
