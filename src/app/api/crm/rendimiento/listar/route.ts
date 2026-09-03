import { NextResponse } from "next/server";
import { rendimientoActor } from "@/lib/server/rendimiento-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(req: Request) {
  try {
    const { admin, worker } = await rendimientoActor(req);
    if (!worker) return NextResponse.json({ ok: false, error: "Sesión no autorizada." }, { status: 401 });
    const params = new URL(req.url).searchParams;
    const filters: Record<string,string> = {};
    for (const key of ["cliente","telefonista","tarotista","codigo","metodo"]) {
      const value = (params.get(key) || "").trim();
      if (value.length > 200) return NextResponse.json({ ok: false, error: "El filtro es demasiado largo." }, { status: 400 });
      if (value) filters[key] = value;
    }
    for (const key of ["from","to"]) {
      const value = params.get(key);
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)
        return NextResponse.json({ ok: false, error: "Fecha inválida." }, { status: 400 });
      filters[key] = value;
    }
    for (const key of ["captado","promo","call"]) if (["true","false"].includes(params.get(key) || "")) filters[key] = params.get(key)!;
    if (["positive","zero"].includes(params.get("importe") || "")) filters.importe = params.get("importe")!;
    const page = Math.min(1000000, Math.max(1, Math.floor(Number(params.get("page")) || 1)));
    const size = Math.min(100, Math.max(20, Math.floor(Number(params.get("page_size")) || 50)));
    const { data, error } = await admin.rpc("tc_rendimiento_list", { p_worker: worker.id, p_filters: filters, p_page: page, p_size: size });
    if (error) throw error;
    const totals = worker.role === "admin" ? data.totals : { records: data.totals.records, captured: data.totals.captured };
    return NextResponse.json({ ...data, totals, ok: true, brand: "celestial", viewer: { role: worker.role, worker_id: worker.id, read_scope: "all_centrals" } },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo cargar Rendimiento. Comprueba la conexión y que el SQL de Rendimiento esté aplicado." }, { status: 500 });
  }
}
