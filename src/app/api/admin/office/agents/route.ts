import { officeAccess, officeDatabaseError, officeError, officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const [{ data, error }, capture] = await Promise.all([
      access.admin.rpc("office_agent_activity", { p_actor: access.authUserId }),
      access.admin.from("office_capture_events").select("id,action,created_at,opportunity:office_capture_opportunities!inner(channel,source_at)")
        .in("action", ["discovered", "handoff"]).order("id", { ascending: false }).limit(12),
    ]);
    if (error) return officeDatabaseError(error);
    if (capture.error) return officeDatabaseError(capture.error);
    const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" });
    const sources: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", meta_form: "Formulario de Meta" };
    const social = capture.data.map(event => {
      const op = Array.isArray(event.opportunity) ? event.opportunity[0] : event.opportunity;
      const handoff = event.action === "handoff";
      return { id: "oportunidad:" + event.id, taskId: "meta:" + month.format(new Date(op.source_at)),
        taskTitle: sources[op.channel] || "Contacto", from: handoff ? "captacion-reservas" : "marketing",
        to: handoff ? "comercial" : "captacion-reservas", at: event.created_at,
        what: handoff ? "Oportunidad derivada para atención personal" : "Entrada registrada para seguimiento" };
    });
    return officeJson({ ok: true, checked_at: data.checked_at, handoffs: [...data.handoffs, ...social] });
  } catch { return officeError("No se pudo consultar la actividad interna de la Oficina.", 503); }
}
