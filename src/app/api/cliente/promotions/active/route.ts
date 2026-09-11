import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { loadActivePromotion } from "@/lib/server/client-promotions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const promotion = await loadActivePromotion(gate.admin);
    return NextResponse.json({ ok: true, promotion });
  } catch (error: any) {
    console.error("[cliente/promotions/active]", error);
    return NextResponse.json({ ok: false, error: error?.message || "PROMOTION_LOAD_FAILED" }, { status: 500 });
  }
}
