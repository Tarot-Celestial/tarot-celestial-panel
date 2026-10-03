import { rankPackageBenefitsForPacks } from "@/lib/server/rank-benefits";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { loadActivePromotion } from "@/lib/server/client-promotions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const promotion = await loadActivePromotion(gate.admin);
    if (!promotion) {
      return NextResponse.json({ ok: true, promotion: null }, { headers: { "Cache-Control": "private, no-store" } });
    }

    // Preserve the native benefits configured on each promotion package.
    // Rank × package-level benefits are returned separately as rankBenefits;
    // they must never overwrite the package's own coins/oracle/roulette values.
    const packages = await rankPackageBenefitsForPacks(
      gate.admin,
      gate.cliente.id,
      promotion.packages,
      "promotion"
    );

    return NextResponse.json(
      { ok: true, promotion: { ...promotion, packages } },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    console.error("[cliente/promotions/active]", error);
    return NextResponse.json({ ok: false, error: error?.message || "PROMOTION_LOAD_FAILED" }, { status: 500 });
  }
}
