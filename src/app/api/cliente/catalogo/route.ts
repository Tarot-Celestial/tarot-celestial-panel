import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
import { loadClientePriceCatalog } from "@/lib/server/cliente-price-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };

export async function GET(req: Request) {
  const started = performance.now();
  try {
    const gate = await rouletteClient(req);
    const authenticated = performance.now();
    const catalog = await loadClientePriceCatalog(gate.admin, gate.cliente.id);
    const headers = {
      ...privateHeaders,
      "Server-Timing": `auth;dur=${(authenticated - started).toFixed(1)}, catalog;dur=${(performance.now() - authenticated).toFixed(1)}`,
    };
    return NextResponse.json({ ok: true, ...catalog }, { headers });
  } catch (error) {
    if (error instanceof RouletteAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers: privateHeaders });
    }
    return NextResponse.json({ ok: false, error: "No hemos podido cargar los precios. Inténtalo de nuevo." }, { status: 503, headers: privateHeaders });
  }
}
