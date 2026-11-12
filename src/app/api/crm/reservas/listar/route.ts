import { reservasStaff } from "@/lib/server/reservas-staff";
import { brandFromRequest, filterRowsByBrand } from "@/lib/server/brand-filter";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const uncachedHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Vary": "Authorization",
};

export async function GET(req: Request) {
  try {
    const gate = await reservasStaff(req);
    if (gate.response) return gate.response;
    const rows: any[] = [];
    const alertsOnly = new URL(req.url).searchParams.get("scope") === "alerts";
    // Página por ID: al cancelar o aplazar durante la lectura no cambia la posición
    // de las demás reservas, como ocurría con los offsets y la fecha mutable.
    let lastId = "";
    for (;;) {
      let query = gate.db!.from("reservas").select("*").is("deleted_at", null);
      if (alertsOnly) query = query.in("estado", ["pendiente", "confirmada"])
        .gte("fecha_reserva", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
        .lte("fecha_reserva", new Date(Date.now() + 24 * 60 * 60_000).toISOString());
      if (lastId) query = query.gt("id", lastId);
      const { data, error } = await query.order("id").limit(500);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 500) break;
      lastId = data[data.length - 1].id;
    }
    const brand = brandFromRequest(req);
    return Response.json({ ok: true, workerId: gate.worker!.id, reservas: await filterRowsByBrand(gate.db!, rows, brand), serverNow: new Date().toISOString() }, { headers: uncachedHeaders });
  } catch (e) {
    console.error("[reservas/list]", e);
    return Response.json({ error: "No se pudieron cargar las reservas." }, { status: 500, headers: uncachedHeaders });
  }
}
