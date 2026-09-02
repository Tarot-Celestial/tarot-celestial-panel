import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function spinSummary(rows: any[]) {
  const pending = rows.filter((row: any) => row.estado === "pending");
  const next = pending[0] || null;
  return {
    available_spins: pending.length,
    next_level: Number(next?.nivel || 1) === 2 ? 2 : 1,
    level_1_spins: pending.filter((row: any) => Number(row?.nivel || 1) === 1).length,
    level_2_spins: pending.filter((row: any) => Number(row?.nivel || 1) === 2).length,
  };
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const [pendingResult, lastUsedResult] = await Promise.all([
      gate.admin
        .from("cliente_ruleta_giros")
        .select("id,estado,nivel,purchase_minutes,premio_minutos,created_at,used_at")
        .eq("cliente_id", gate.cliente.id)
        .eq("estado", "pending")
        .order("created_at", { ascending: true })
        .limit(100),
      gate.admin
        .from("cliente_ruleta_giros")
        .select("id,estado,nivel,purchase_minutes,premio_minutos,created_at,used_at")
        .eq("cliente_id", gate.cliente.id)
        .eq("estado", "used")
        .order("used_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (pendingResult.error) throw pendingResult.error;
    if (lastUsedResult.error) throw lastUsedResult.error;

    const rows = pendingResult.data || [];
    const summary = spinSummary(rows);
    const lastUsed = lastUsedResult.data || null;

    return NextResponse.json({
      ok: true,
      ...summary,
      last_prize: Number(lastUsed?.premio_minutos || 0) || null,
      last_prize_level: lastUsed ? (Number(lastUsed?.nivel || 1) === 2 ? 2 : 1) : null,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_RULETA" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { data, error } = await gate.admin.rpc("cliente_girar_ruleta", { p_cliente_id: gate.cliente.id });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.prize_minutes) {
      return NextResponse.json({ ok: false, error: "SIN_GIROS_DISPONIBLES" }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      prize_minutes: Number(result.prize_minutes),
      spin_level: Number(result.spin_level || 1) === 2 ? 2 : 1,
      available_spins: Number(result.available_spins || 0),
      next_level: Number(result.next_spin_level || 1) === 2 ? 2 : 1,
      level_1_spins: Number(result.level_1_spins || 0),
      level_2_spins: Number(result.level_2_spins || 0),
      total_minutes: Number(result.total_minutes || 0),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_GIRAR_RULETA" }, { status: 500 });
  }
}
