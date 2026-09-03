import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof RouletteAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers });
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (["INVALID_SPIN", "LEGACY_SPIN_ALREADY_USED"].some(code => message.includes(code))) {
    return NextResponse.json({ ok: false, error: "Este giro ya no está disponible. Actualiza para ver tus giros actuales." }, { status: 409, headers });
  }
  console.error("[ruleta]", error);
  return NextResponse.json({ ok: false, error: "No hemos podido confirmar la operación. Puedes reintentar con seguridad." }, { status: 503, headers });
}
export async function GET(req: Request) {
  try {
    const gate = await rouletteClient(req);
    const { data, error } = await gate.admin.rpc("cliente_ruleta_resumen_v2", { p_cliente_id: gate.cliente.id });
    if (error) throw error;
    return NextResponse.json({ ok: true, ...data }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const gate = await rouletteClient(req);
    const body = await req.json().catch(() => null);
    if (![1, 2].includes(body?.level) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.spin_id || "")) {
      return NextResponse.json({ ok: false, error: "Selecciona un giro disponible." }, { status: 400, headers });
    }
    const { data, error } = await gate.admin.rpc("cliente_girar_ruleta_v2", {
      p_cliente_id: gate.cliente.id, p_spin_id: body.spin_id, p_level: body.level,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, ...data }, { headers });
  } catch (error) { return failure(error); }
}
