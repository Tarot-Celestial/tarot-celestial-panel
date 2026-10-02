import { clientRankBenefits } from "@/lib/server/rank-benefits";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { loadActivePromotion } from "@/lib/server/client-promotions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const promotion = await loadActivePromotion(gate.admin);
    const benefits = await clientRankBenefits(gate.admin, gate.cliente.id);
    return NextResponse.json({ ok: true, promotion: promotion ? { ...promotion, packages: promotion.packages.map((pack: any) => ({ ...pack, coins: benefits.purchase_coins })) } : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    console.error("[cliente/promotions/active]", error);
    return NextResponse.json({ ok: false, error: error?.message || "PROMOTION_LOAD_FAILED" }, { status: 500 });
  }
}
