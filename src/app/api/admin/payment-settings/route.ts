import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getActiveClientPaymentProvider, getClientWebPaymentsEnabled } from "@/lib/server/client-payment-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.error === "FORBIDDEN" ? 403 : 401 },
      );
    }

    const provider = await getActiveClientPaymentProvider(gate.admin);
    return NextResponse.json({ ok: true, provider, web_payments_enabled: await getClientWebPaymentsEnabled(gate.admin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "ERR_PAYMENT_SETTINGS" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.error === "FORBIDDEN" ? 403 : 401 },
      );
    }

    const body = await req.json().catch(() => ({}));
    if (String(body?.provider || "mollie").toLowerCase() !== "mollie") {
      return NextResponse.json({ ok: false, error: "PROVIDER_INVALIDO" }, { status: 400 });
    }

    if (typeof body.web_payments_enabled !== "boolean") return NextResponse.json({ ok: false, error: "Indica si los pagos web están habilitados." }, { status: 400 });
    const { error } = await gate.admin.from("cliente_payment_settings").upsert({
      id: "default",
      provider: "mollie",
      web_payments_enabled: body.web_payments_enabled,
      updated_at: new Date().toISOString(),
      updated_by: null,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, provider: "mollie", web_payments_enabled: body.web_payments_enabled });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "ERR_PAYMENT_SETTINGS" },
      { status: 500 },
    );
  }
}
