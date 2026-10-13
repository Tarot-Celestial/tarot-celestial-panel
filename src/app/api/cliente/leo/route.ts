import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
import { buildLeoRecommendation, leoContextForPath } from "@/lib/leo-celestial-intelligence";
import { LEO_SECTIONS, safeLeoPath } from "@/lib/leo-guide";
import { validLeonarisId } from "@/lib/leonaris-companion";
import { loadLeonarisContext, leonarisCompanion, leonarisProfile } from "@/lib/server/leonaris-context";
import { answerLeonaris } from "@/lib/server/leonaris-chat";
import {
  getLeonarisMemory, updateLeonarisPreferences, rememberLeonarisMemory, forgetLeonarisMemory,
  resetLeonarisMemory, claimLeonarisChat, completeLeonarisChat, failLeonarisChat,
  recordLeonarisFeedback, recordLeonarisSignal, LeonarisMemoryError,
} from "@/lib/server/leonaris-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...HEADERS, ...extra } });
type Gate = Awaited<ReturnType<typeof rouletteClient>>;

function failure(error: unknown) {
  if (error instanceof RouletteAccessError) return json({ ok: false, error: error.message }, error.status);
  if (error instanceof LeonarisMemoryError) {
    const messages: Record<string, string> = {
      invalid_request: "Revisa el mensaje e inténtalo de nuevo.", invalid_memory: "Escribe un recuerdo de hasta cuatrocientos caracteres.",
      invalid_preferences: "Revisa la preferencia seleccionada.", memory_limit: "Ya tienes veinte recuerdos. Borra uno para guardar otro.",
      memory_disabled: "Activa la memoria antes de guardar un recuerdo.", request_conflict: "Envía ese mensaje como una consulta nueva.",
      invalid_feedback: "No he podido guardar esa valoración.", stale_claim: "La consulta ha cambiado. Envía tu mensaje de nuevo.",
      invalid_signal: "Elige un apartado válido del panel.",
      not_found: "Este recuerdo o respuesta ya no está disponible.",
    };
    if (messages[error.code]) return json({ ok: false, error: messages[error.code] }, error.code === "stale_claim" ? 409 : 400);
  }
  // Never log questions, memories, tokens, provider bodies or raw database error messages.
  console.error("[leonaris] request unavailable");
  return json({ ok: false, error: "No he podido consultar tu información ahora. Vuelve a intentarlo en un momento." }, 503);
}

async function responseFor(gate: Gate) {
  const [memory, context, row] = await Promise.all([
    getLeonarisMemory(gate.cliente.id), loadLeonarisContext(gate),
    gate.admin.from("tc_client_leo_profiles").select("hidden,muted,visit_counts,interest_scores,interaction_counts,last_path,last_seen_at").eq("client_id", gate.cliente.id).maybeSingle(),
  ]);
  if (row.error) throw new Error("LEONARIS_PROFILE_UNAVAILABLE");
  const profile = leonarisProfile(row.data);
  const interests = memory.memoryEnabled ? profile : { ...profile, visit_counts: {}, interest_scores: {}, interaction_counts: {} };
  return json({ ok: true, profile: interests, facts: context.facts, recommendation: buildLeoRecommendation(interests, context.facts), companion: leonarisCompanion(memory, context) });
}

export async function GET(req: Request) {
  try { return await responseFor(await rouletteClient(req)); } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const gate = await rouletteClient(req);
    // All queries use the client resolved above; request-supplied identity is ignored.
    if (Number(req.headers.get("content-length") || 0) > 16000) return json({ ok: false, error: "El mensaje es demasiado largo." }, 413);
    const text = await req.text();
    if (text.length > 16000) return json({ ok: false, error: "El mensaje es demasiado largo." }, 413);
    let body: any;
    try { body = JSON.parse(text); } catch { return json({ ok: false, error: "Petición no válida." }, 400); }
    if (!body || Array.isArray(body) || typeof body !== "object") return json({ ok: false, error: "Petición no válida." }, 400);
    const id = gate.cliente.id;
    const pathname = safeLeoPath(body.pathname) ? body.pathname.slice(0, 160) : "/cliente/dashboard";
    if (body.action === "chat") {
      if (!validLeonarisId(body.requestId) || typeof body.message !== "string" || !body.message.trim() || Array.from(body.message).length > 2000) return json({ ok: false, error: "Escribe un mensaje de hasta dos mil caracteres." }, 400);
      const claim = await claimLeonarisChat(id, body.requestId, body.message);
      if (claim.status === "completed") return claim.answer ? json({ ok: true, answer: claim.answer }) : json({ ok: false, error: "Esta respuesta ya no está guardada. Envía una consulta nueva." }, 409);
      if (claim.status !== "claimed") return json({ ok: false, error: claim.status === "in_progress" ? "Todavía estoy preparando esta respuesta. Espera un momento." : "Vamos con calma: espera un momento antes de otra consulta." }, 429, { "Retry-After": String(claim.retryAfter) });
      try {
        const [memory, context] = await Promise.all([getLeonarisMemory(id), loadLeonarisContext(gate, true)]);
        const answer = await answerLeonaris(context, memory, body.requestId, body.message.trim(), pathname);
        await completeLeonarisChat(id, body.requestId, claim.claimToken, answer);
        return json({ ok: true, answer });
      } catch (error) {
        await failLeonarisChat(id, body.requestId, claim.claimToken).catch(() => {});
        throw error;
      }
    }
    if (body.action === "remember") await rememberLeonarisMemory(id, body.content);
    else if (body.action === "forget") await forgetLeonarisMemory(id, body.memoryId);
    else if (body.action === "forget_all") await resetLeonarisMemory(id);
    else if (body.action === "feedback") await recordLeonarisFeedback(id, body.answerId, body.helpful);
    else if (body.action === "preference") {
      if (["memoryEnabled", "style", "displayName"].some(key => key in body)) await updateLeonarisPreferences(id, { memoryEnabled: body.memoryEnabled, style: body.style, displayName: body.displayName });
      if (typeof body.hidden === "boolean" || typeof body.muted === "boolean") {
        const { error } = await gate.admin.rpc("tc_record_client_leo_signal", { p_client_id: id, p_signal: "preference", p_context: "dashboard", p_path: pathname, p_hidden: typeof body.hidden === "boolean" ? body.hidden : null, p_muted: typeof body.muted === "boolean" ? body.muted : null });
        if (error) throw new Error("LEONARIS_PREFERENCES_UNAVAILABLE");
      }
    } else if (body.action === "visit" || body.action === "interaction") {
      const context = LEO_SECTIONS.some(section => section.key === body.context) ? body.context : LEO_SECTIONS.find(section => pathname.startsWith(section.path))?.key || leoContextForPath(pathname);
      await recordLeonarisSignal(id, { signal: body.action, context, pathname: pathname.split(/[?#]/)[0] });
    } else return json({ ok: false, error: "Acción no válida." }, 400);
    return await responseFor(gate);
  } catch (error) { return failure(error); }
}
