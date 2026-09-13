import { NextResponse } from "next/server";
import { rouletteStaff, RouletteAccessError } from "@/lib/server/ruleta-access";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(req: Request) {
  try {
    const { admin, worker } = await rouletteStaff(req);
    const body = await req.json();
    if (!uuid.test(body.cliente_id || "") || !uuid.test(body.request_id || "") || !Number.isInteger(body.expected_used) || body.expected_used < 0 || !body.cycle_start || !Number.isFinite(Date.parse(body.cycle_start))) {
      return NextResponse.json({ error: "Vuelve a abrir la ficha para consultar tus pases." }, { status: 400 });
    }
    const { data, error } = await admin.rpc("crm_free_pass_use", { p_cliente_id: body.cliente_id, p_worker_id: worker.id, p_request_id: body.request_id, p_cycle_start: body.cycle_start, p_expected_used: body.expected_used });
    if (error) {
      const known = ["PASS_STATE_CHANGED", "NO_PASSES", "NO_CONFIRMED_PURCHASE"].some(code => error.message.includes(code));
      return NextResponse.json({ error: known ? "Los pases han cambiado. Revisa el saldo actualizado antes de continuar." : "No se pudo confirmar el pase. Puedes reintentar la misma operación.", refresh: known }, { status: known ? 409 : 503 });
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof RouletteAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "No se pudo confirmar el pase. Inténtalo de nuevo." }, { status: 503 });
  }
}
