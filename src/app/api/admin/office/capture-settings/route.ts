import { officeAccess, officeError, officeJson } from "@/lib/server/office-access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

async function latestInstagramReply(db: SupabaseClient) {
  const {data: attempt, error} = await db.from("office_capture_attempts")
    .select("opportunity_id,source_id,completed_at,office_capture_opportunities!inner(channel,kind)")
    .eq("office_capture_opportunities.channel", "instagram").eq("office_capture_opportunities.kind", "message")
    .eq("outcome", "sent").not("receipt_id", "is", null).not("completed_at", "is", null)
    .order("completed_at", {ascending: false}).limit(1).maybeSingle();
  if (error || !attempt) return null;
  const {data: inbound} = await db.from("office_capture_inbound").select("source_at")
    .eq("opportunity_id", attempt.opportunity_id).eq("source_id", attempt.source_id)
    .eq("kind", "message").eq("verified", true).maybeSingle();
  if (!inbound) return null;
  const elapsed = Date.parse(attempt.completed_at) - Date.parse(inbound.source_at);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return {sent_at: attempt.completed_at, elapsed_seconds: Math.round(elapsed / 1000)};
}

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const [settings, lines, instagramReply] = await Promise.all([
      access.admin.from("office_capture_settings").select("enabled,last_round_at,last_round").eq("id", true).single(),
      access.admin.from("office_capture_lines").select("country,phone,enabled").order("country"),
      latestInstagramReply(access.admin),
    ]);
    if (settings.error || lines.error) throw Error();
    return officeJson({ ...settings.data, lines: lines.data, latest_instagram_reply: instagramReply });
  } catch { return officeError("No se pudo consultar la configuración de Captación.", 503); }
}

export async function POST(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const body = await req.json().catch(() => null);
    if (typeof body?.enabled !== "boolean") return officeError("Elige el estado de las respuestas o de la línea.", 400);
    if (body.country !== undefined && (typeof body.country !== "string" || !/^[A-Z]{2}$/.test(body.country))) return officeError("País no válido.", 400);
    const result = body.country
      ? await access.admin.from("office_capture_lines").update({ enabled: body.enabled }).eq("country", body.country).select("country").maybeSingle()
      : await access.admin.from("office_capture_settings").update({ enabled: body.enabled, actor_user_id: access.authUserId }).eq("id", true).select("id").maybeSingle();
    if (result.error) throw Error();
    return result.data ? officeJson({ ok: true }) : officeError("La configuración ya no está disponible.", 404);
  } catch { return officeError("No se pudo guardar el cambio de Captación.", 503); }
}
