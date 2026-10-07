import { NextResponse } from "next/server";
import { PAYPAL_TABLE, paypalAdmin, paypalConfig, reconcilePayPal } from "@/lib/server/paypal-crm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function POST(req: Request) {
  try {
    const config = paypalConfig();
    if (req.headers.get("origin") !== config.origin) return new NextResponse(null, { status: 403, headers });
    const body = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(body.ref || "")) return new NextResponse(null, { status: 400, headers });
    const admin = paypalAdmin();
    const { data, error } = await admin.from(PAYPAL_TABLE).select("*").eq("public_token", body.ref).eq("environment", config.environment).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Enlace no encontrado." }, { status: 404, headers });
    const current = await reconcilePayPal(admin, data, body.cancel !== true);
    return NextResponse.json({ status: current.status, remote_status: current.remote_status, amount: Number(current.amount), currency: current.currency, last_error: current.last_error || null }, { headers });
  } catch {
    return NextResponse.json({ error: "No hemos podido confirmar el estado. No repitas el pago; vuelve a comprobarlo o contacta con tu central." }, { status: 503, headers });
  }
}
