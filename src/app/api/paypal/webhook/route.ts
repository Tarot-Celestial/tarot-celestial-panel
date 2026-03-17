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

async function verifyWebhookSignature(rawBody: string, headers: Headers, eventBody: any) {
  const webhookId = getEnv("PAYPAL_WEBHOOK_ID");
  const accessToken = await getPayPalAccessToken();

  const payload = {
    auth_algo: headers.get("paypal-auth-algo") || headers.get("PAYPAL-AUTH-ALGO") || "",
    cert_url: headers.get("paypal-cert-url") || headers.get("PAYPAL-CERT-URL") || "",
    transmission_id: headers.get("paypal-transmission-id") || headers.get("PAYPAL-TRANSMISSION-ID") || "",
    transmission_sig: headers.get("paypal-transmission-sig") || headers.get("PAYPAL-TRANSMISSION-SIG") || "",
    transmission_time: headers.get("paypal-transmission-time") || headers.get("PAYPAL-TRANSMISSION-TIME") || "",
    webhook_id: webhookId,
    webhook_event: eventBody,
  };

  const res = await fetch(`${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json?.message || json?.name || "PAYPAL_WEBHOOK_VERIFY_ERROR");
  }

  return String(json?.verification_status || "").toUpperCase() === "SUCCESS";
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const eventBody = rawBody ? JSON.parse(rawBody) : {};

    const isValid = await verifyWebhookSignature(rawBody, req.headers, eventBody);

    if (!isValid) {
      return NextResponse.json({ ok: false, error: "INVALID_WEBHOOK_SIGNATURE" }, { status: 400 });
    }

    const eventType = String(eventBody?.event_type || "");
    const resource = eventBody?.resource || {};
    const admin = adminClient();

    const paypalOrderId =
      resource?.supplementary_data?.related_ids?.order_id ||
      resource?.id ||
      resource?.resource?.id ||
      "";

    if (!paypalOrderId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { data: pago, error: pagoError } = await admin
      .from("crm_cliente_pagos")
      .select("*")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();

    if (pagoError) throw pagoError;

    if (!pago) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const captureId = resource?.id || null;
      const payerId = resource?.payer?.payer_id || resource?.payee?.merchant_id || null;

      await admin
        .from("crm_cliente_pagos")
        .update({
          estado: "completed",
          paypal_capture_id: captureId,
          paypal_payer_id: payerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pago.id);

      return NextResponse.json({ ok: true });
    }

    if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "CHECKOUT.PAYMENT-APPROVAL.REVERSED") {
      await admin
        .from("crm_cliente_pagos")
        .update({
          estado: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pago.id);

      return NextResponse.json({ ok: true });
    }

    if (eventType === "PAYMENT.CAPTURE.PENDING") {
      await admin
        .from("crm_cliente_pagos")
        .update({
          estado: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pago.id);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, ignored: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
