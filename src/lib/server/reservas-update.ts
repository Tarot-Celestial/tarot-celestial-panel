import { reservasStaff } from "./reservas-staff";
import { reservaChange } from "@/lib/reservas";

export async function updateReserva(req: Request, action?: string) {
  try {
    const gate = await reservasStaff(req);
    if (gate.response) return gate.response;
    const body = await req.json().catch(() => ({}));
    if (action) body.action = action;
    if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ""))) return Response.json({ error: "Reserva no válida." }, { status: 400 });
    const { data: row, error } = await gate.db!.from("reservas").select("*").eq("id", body.id).maybeSingle();
    if (error) throw error;
    if (!row) return Response.json({ error: "La reserva no existe." }, { status: 404 });
    if ("version" in body && body.version !== row.updated_at) return Response.json({ error: "La reserva ha cambiado. Actualiza antes de continuar." }, { status: 409 });
    let patch;
    try { patch = reservaChange(row, body, gate.worker!.display_name || "Central"); }
    catch (e: any) { return Response.json({ error: e.message }, { status: 400 }); }
    let query = gate.db!.from("reservas").update(patch).eq("id", row.id).eq("estado", row.estado).eq("fecha_reserva", row.fecha_reserva);
    query = row.updated_at ? query.eq("updated_at", row.updated_at) : query.is("updated_at", null);
    const { data: saved, error: saveError } = await query.select("*").maybeSingle();
    if (saveError) throw saveError;
    if (!saved) return Response.json({ error: "Otra central acaba de modificar esta reserva. Actualiza la lista." }, { status: 409 });
    return Response.json({ ok: true, reserva: saved });
  } catch (e) {
    console.error("[reservas/update]", e);
    return Response.json({ error: "No se pudo guardar la reserva. Inténtalo de nuevo." }, { status: 500 });
  }
}
