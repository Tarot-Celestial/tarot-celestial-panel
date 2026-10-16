import { reservasStaff } from "@/lib/server/reservas-staff";
import { reservaDate } from "@/lib/reservas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_STATES = ["pendiente", "confirmada"];

export async function GET(req: Request) {
  try {
    const gate = await reservasStaff(req);
    if (gate.response) return gate.response;
    const admin = gate.db!;
    const now = new Date();
    const { data: reservas, error } = await admin
      .from("reservas")
      .select("*")
      .eq("notify_when_tarotista_idle", true)
      .is("ready_notified_at", null)
      .is("deleted_at", null)
      .in("estado", OPEN_STATES)
      .lte("fecha_reserva", now.toISOString())
      .order("fecha_reserva", { ascending: true })
      .limit(100);
    if (error) throw error;

    for (const reserva of reservas || []) {
      const due = reservaDate(String(reserva.fecha_reserva || "")).getTime();
      if (!Number.isFinite(due) || due > now.getTime() || !reserva.tarotista_id) continue;
      const { data: ext, error: extensionError } = await admin
        .from("pbx_extensions")
        .select("extension,status,active_call_count,registered,is_active,worker_id,label,last_seen_at,updated_at")
        .eq("worker_id", reserva.tarotista_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (extensionError) throw extensionError;

      // Match the PBX panel's fresh-runtime window. Missing/offline/old telemetry is not availability.
      const seen = ext?.last_seen_at ? reservaDate(ext.last_seen_at).getTime() : NaN;
      const age = Date.now() - seen;
      if (ext?.is_active === false || ext?.registered !== true || ext.status !== "registered"
        || ext.active_call_count == null || Number(ext.active_call_count) !== 0
        || !Number.isFinite(age) || age < 0 || age >= 20_000) continue;

      // Claim only the version inspected above. A concurrent cancellation, deletion or reschedule wins.
      // Never change estado here: delivering an alert cannot reopen a reservation.
      let claim = admin.from("reservas")
        .update({ ready_notified_at: new Date().toISOString() })
        .eq("id", reserva.id)
        .eq("estado", reserva.estado)
        .eq("fecha_reserva", reserva.fecha_reserva)
        .eq("tarotista_id", reserva.tarotista_id)
        .eq("notify_when_tarotista_idle", true)
        .is("ready_notified_at", null)
        .is("deleted_at", null);
      claim = reserva.updated_at == null ? claim.is("updated_at", null) : claim.eq("updated_at", reserva.updated_at);
      const { data: claimed, error: claimError } = await claim.select("*").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      // The watcher displays one modal at a time; do not consume alerts it cannot show.
      return Response.json({ ok: true, serverNow: new Date().toISOString(), reservas: [{
        ...claimed, tarotista_extension: ext.extension || null,
        tarotista_extension_label: ext.label || null, ready_reason: "tarotista_idle",
      }] }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: true, serverNow: new Date().toISOString(), reservas: [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[reservas/ready]", error);
    return Response.json({ ok: false, error: "No se pudo comprobar la disponibilidad de la tarotista." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
