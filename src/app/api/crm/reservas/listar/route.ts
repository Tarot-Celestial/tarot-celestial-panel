import { reservasStaff } from "@/lib/server/reservas-staff";
import { brandFromRequest, filterRowsByBrand } from "@/lib/server/brand-filter";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const gate = await reservasStaff(req);
    if (gate.response) return gate.response;
    const rows: any[] = [];
    const alertsOnly = new URL(req.url).searchParams.get("scope") === "alerts";
    // Supabase caps each response; fetch every page to preserve the full history.
    for (let offset = 0; ; offset += 500) {
      let query = gate.db!.from("reservas").select("*").is("deleted_at", null);
      if (alertsOnly) query = query.in("estado", ["pendiente", "confirmada"])
        .gte("fecha_reserva", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
        .lte("fecha_reserva", new Date(Date.now() + 24 * 60 * 60_000).toISOString());
      const { data, error } = await query.order("fecha_reserva").order("id").range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    const brand = brandFromRequest(req);
    return Response.json({ ok: true, workerId: gate.worker!.id, reservas: await filterRowsByBrand(gate.db!, rows, brand), serverNow: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[reservas/list]", e);
    return Response.json({ error: "No se pudieron cargar las reservas." }, { status: 500 });
  }
}
