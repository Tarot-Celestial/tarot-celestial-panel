import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server/auth-worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!token) return NextResponse.json({ ok: false, error: "Vuelve a iniciar sesión." }, { status: 401, headers });
    const admin = getAdminClient();
    const auth = await admin.auth.getUser(token);
    if (auth.error || !auth.data.user) return NextResponse.json({ ok: false, error: "Tu sesión ha caducado." }, { status: 401, headers });
    const raffle = await admin.from("raffles").select("id").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (raffle.error) throw raffle.error;
    if (!raffle.data) return NextResponse.json({ ok: true, winners: [] }, { headers });
    // Deliberate allowlist: never join CRM, worker or private prize information here.
    const result = await admin.from("raffle_public_winners").select("position,prize_name,winning_number,selection_method,is_test")
      .eq("raffle_id", raffle.data.id).order("position").limit(100);
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, winners: result.data || [] }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudieron cargar los ganadores. Vuelve a intentarlo." }, { status: 503, headers });
  }
}
