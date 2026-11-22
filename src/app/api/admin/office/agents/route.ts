import { officeAccess, officeDatabaseError, officeError, officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const fields = "id,action,opportunity_id,created_at,opportunity:office_capture_opportunities!inner(channel,source_at)";
    const [{ data, error }, arrivals, transfers] = await Promise.all([
      access.admin.rpc("office_agent_activity", { p_actor: access.authUserId }),
      access.admin.from("office_capture_events").select(fields).eq("action", "discovered").order("id", { ascending: false }).limit(8),
      access.admin.from("office_capture_events").select(fields).in("action", ["handoff", "commercial_returned"])
        .or("action.eq.commercial_returned,detail.is.null,detail.not.in.(commercial_intervention,commercial_wait_new_inbound)")
        .order("id", { ascending: false }).limit(12),
    ]);
    if (error) return officeDatabaseError(error);
    const captureError = arrivals.error || transfers.error;
    if (captureError) return officeDatabaseError(captureError);
    const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" });
    const sources: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", meta_form: "Formulario de Meta" };
    const social = [...(transfers.data || []), ...(arrivals.data || [])].map(event => {
      const op = Array.isArray(event.opportunity) ? event.opportunity[0] : event.opportunity;
      const base = { id: "oportunidad:" + event.id, at: event.created_at, taskTitle: sources[op.channel] || "Contacto" };
      if (event.action === "commercial_returned") return { ...base, taskId: "comercial:" + event.opportunity_id,
        from: "comercial", to: "atlas", what: "Comercial ha devuelto la conversación a Atlas" };
      if (event.action === "handoff") return { ...base, taskId: "comercial:" + event.opportunity_id,
        from: "captacion-reservas", to: "comercial", what: "Oportunidad derivada para atención personal" };
      return { ...base, taskId: "meta:" + month.format(new Date(op.source_at)),
        from: "marketing", to: "captacion-reservas", what: "Entrada registrada para seguimiento" };
    });
    return officeJson({ ok: true, checked_at: data.checked_at, handoffs: [...data.handoffs, ...social] });
  } catch { return officeError("No se pudo consultar la actividad interna de la Oficina.", 503); }
}
