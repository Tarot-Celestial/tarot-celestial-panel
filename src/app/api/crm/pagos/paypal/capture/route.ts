import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string, fallback?: string) {
  const v = process.env[name];
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env var: ${name}`);
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

function paypalBaseUrl() {
  return getEnv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com");
}

async function getPayPalAccessToken() {
  const clientId = getEnv("PAYPAL_CLIENT_ID");
  const clientSecret = getEnv("PAYPAL_CLIENT_SECRET");

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json?.access_token) {
    throw new Error(json?.error_description || json?.error || "PAYPAL_AUTH_ERROR");
  }

  return json.access_token as string;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const paypalOrderId = String(searchParams.get("paypal_order_id") || searchParams.get("token") || "").trim();
    const cancelled = String(searchParams.get("cancel") || "") === "1";

    if (!paypalOrderId) {
      return NextResponse.json({ ok: false, error: "FALTA_PAYPAL_ORDER_ID" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: pago, error: pagoError } = await admin
      .from("crm_cliente_pagos")
      .select("*")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();

    if (pagoError) throw pagoError;

    if (!pago) {
      return NextResponse.json({ ok: false, error: "PAGO_NO_EXISTE" }, { status: 404 });
    }

    if (cancelled) {
      const { data: cancelledPago, error: cancelledError } = await admin
        .from("crm_cliente_pagos")
        .update({
          estado: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pago.id)
        .select("*")
        .single();

      if (cancelledError) throw cancelledError;

      return NextResponse.json({ ok: true, pago: cancelledPago, status: "cancelled" });
    }

    if (String(pago.estado || "").toLowerCase() === "completed") {
      return NextResponse.json({ ok: true, pago, status: "completed" });
    }

    const accessToken = await getPayPalAccessToken();

    const captureRes = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const captureJson = await captureRes.json().catch(() => ({}));

    if (!captureRes.ok) {
      const { data: failedPago, error: failedError } = await admin
        .from("crm_cliente_pagos")
        .update({
          estado: "failed",
          notas: [pago.notas, captureJson?.message || captureJson?.name || "PAYPAL_CAPTURE_ERROR"].filter(Boolean).join(" · "),
          updated_at: new Date().toISOString(),
        })
        .eq("id", pago.id)
        .select("*")
        .single();

      if (failedError) throw failedError;

      return NextResponse.json(
        { ok: false, error: captureJson?.message || captureJson?.name || "PAYPAL_CAPTURE_ERROR", pago: failedPago },
        { status: 400 }
      );
    }

    const captureId =
      captureJson?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
      null;

    const payerId = captureJson?.payer?.payer_id || null;

    const { data: completedPago, error: completedError } = await admin
      .from("crm_cliente_pagos")
      .update({
        estado: "completed",
        paypal_capture_id: captureId,
        paypal_payer_id: payerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pago.id)
      .select("*")
      .single();

    if (completedError) throw completedError;

    return NextResponse.json({ ok: true, pago: completedPago, status: "completed" });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
