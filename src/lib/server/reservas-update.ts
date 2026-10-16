import { reservasStaff } from "./reservas-staff";
import { reservaChange } from "@/lib/reservas";

export async function updateReserva(req: Request, action?: string) {
  try {
    const gate = await reservasStaff(req);
    if (gate.response) return gate.response;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Solicitud no válida." }, { status: 400 });
    if (action) body.action = action;
    if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ""))) return Response.json({ error: "Reserva no válida." }, { status: 400 });
    if (body.action === "eliminar" && (body.confirmed !== true || !("version" in body))) {
      return Response.json({ error: "Revisa y confirma la reserva que quieres eliminar." }, { status: 400 });
    }
    const { data: row, error } = await gate.db!.from("reservas").select("*").eq("id", body.id).maybeSingle();
    if (error) throw error;
    if (!row) return Response.json({ error: "La reserva no existe." }, { status: 404 });
    if (row.deleted_at) {
      if (body.action === "eliminar") return Response.json({ ok: true, reserva: row }, { headers: { "Cache-Control": "no-store" } });
      return Response.json({ error: "Esta reserva ya está eliminada. Actualiza la agenda." }, { status: 409 });
    }
    if ("version" in body && body.version !== row.updated_at) return Response.json({ error: "La reserva ha cambiado. Actualiza antes de continuar." }, { status: 409 });
    let patch;
    try { patch = reservaChange(row, body, gate.worker!.display_name || "Central"); }
    catch (e: any) { return Response.json({ error: e.message }, { status: 400 }); }
    if (body.action === "eliminar") patch.deleted_by_worker_id = gate.worker!.id;
    let query = gate.db!.from("reservas").update(patch).eq("id", row.id).is("deleted_at", null);
    query = row.estado === null ? query.is("estado", null) : query.eq("estado", row.estado);
    query = row.fecha_reserva === null ? query.is("fecha_reserva", null) : query.eq("fecha_reserva", row.fecha_reserva);
    query = row.updated_at ? query.eq("updated_at", row.updated_at) : query.is("updated_at", null);
    const { data: saved, error: saveError } = await query.select("*").maybeSingle();
    if (saveError) throw saveError;
    if (!saved) return Response.json({ error: "Otra central acaba de modificar esta reserva. Actualiza la lista." }, { status: 409 });
    return Response.json({ ok: true, reserva: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[reservas/update]", e);
    return Response.json({ error: "No se pudo guardar la reserva. Inténtalo de nuevo." }, { status: 500 });
  }
}
