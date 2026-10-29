import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getActiveClientPaymentProvider, getClientWebPaymentsEnabled } from "@/lib/server/client-payment-settings";
import { diagnoseCustomerPayPalConfiguration, PayPalError } from "@/lib/server/paypal-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: "Acceso reservado a administración." },
      { status: gate.error === "FORBIDDEN" ? 403 : 401, headers });
    const body = await req.json().catch(() => null);
    if (body?.action !== "diagnose_paypal_customer") return NextResponse.json({ ok: false, error: "Diagnóstico no válido." }, { status: 400, headers });
    // Fixed server account, independent from the activation selector. This path
    // never reads payment rows or invokes creation, reconciliation or capture.
    return NextResponse.json({ ok: true, ...await diagnoseCustomerPayPalConfiguration() }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof PayPalError ? error.message : "No se pudo comprobar PayPal cliente. Inténtalo de nuevo." },
      { status: error instanceof PayPalError ? error.status : 503, headers });
  }
}

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
