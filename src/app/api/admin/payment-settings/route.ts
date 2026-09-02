import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getActiveClientPaymentProvider, type ClientPaymentProvider } from "@/lib/server/client-payment-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });

    const provider = await getActiveClientPaymentProvider(gate.admin);
    return NextResponse.json({ ok: true, provider });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_PAYMENT_SETTINGS" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });

    const body = await req.json().catch(() => ({}));
    const provider = String(body?.provider || "").toLowerCase() as ClientPaymentProvider;
    if (!(["stripe", "redsys"] as const).includes(provider)) {
      return NextResponse.json({ ok: false, error: "PROVIDER_INVALIDO" }, { status: 400 });
    }

    const { error } = await gate.admin.from("cliente_payment_settings").upsert({
      id: "default",
      provider,
      updated_at: new Date().toISOString(),
      updated_by: null,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, provider });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_PAYMENT_SETTINGS" }, { status: 500 });
  }
}
