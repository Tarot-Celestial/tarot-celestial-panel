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

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) return null;

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;

  const admin = adminClient();

  const { data, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function getAppUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const cliente_id = String(body?.cliente_id || "").trim();
    const importe = Number(body?.importe || 0);
    const moneda = String(body?.moneda || "EUR").trim() || "EUR";
    const notas = String(body?.notas || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "FALTA_CLIENTE_ID" }, { status: 400 });
    }

    if (!importe || importe <= 0) {
      return NextResponse.json({ ok: false, error: "IMPORTE_INVALIDO" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido")
      .eq("id", cliente_id)
      .maybeSingle();

    if (clienteError) throw clienteError;

    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_EXISTE" }, { status: 404 });
    }

    const { data: pagoLocal, error: pagoLocalError } = await admin
      .from("crm_cliente_pagos")
      .insert({
        cliente_id,
        importe,
        moneda,
        metodo: "paypal",
        estado: "pending",
        notas: notas || null,
        created_by_user_id: worker.id,
        created_by_role: worker.role,
      })
      .select("*")
      .single();

    if (pagoLocalError) throw pagoLocalError;

    const accessToken = await getPayPalAccessToken();
    const appUrl = getAppUrl(req);

    const createPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: cliente_id,
          custom_id: String(pagoLocal.id),
          description: `Cobro CRM cliente ${cliente.nombre || ""} ${cliente.apellido || ""}`.trim(),
          amount: {
            currency_code: moneda,
            value: importe.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "Tarot Celestial",
        user_action: "PAY_NOW",
        return_url: `${appUrl}/paypal/finalizar`,
        cancel_url: `${appUrl}/paypal/finalizar?cancel=1`,
      },
    };

    const paypalRes = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": String(pagoLocal.id),
      },
      body: JSON.stringify(createPayload),
      cache: "no-store",
    });

    const paypalJson = await paypalRes.json().catch(() => ({}));

    if (!paypalRes.ok || !paypalJson?.id) {
      await admin
        .from("crm_cliente_pagos")
        .update({
          estado: "failed",
          notas: [notas, paypalJson?.message || paypalJson?.name || "PAYPAL_CREATE_ORDER_ERROR"].filter(Boolean).join(" · "),
          updated_at: new Date().toISOString(),
        })
        .eq("id", pagoLocal.id);

      throw new Error(paypalJson?.message || paypalJson?.name || "PAYPAL_CREATE_ORDER_ERROR");
    }

    const approveUrl =
      Array.isArray(paypalJson?.links)
        ? paypalJson.links.find((l: any) => l?.rel === "approve")?.href || null
        : null;

    const { data: pago, error: updateError } = await admin
      .from("crm_cliente_pagos")
      .update({
        paypal_order_id: paypalJson.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pagoLocal.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      approve_url: approveUrl,
      paypal_order_id: paypalJson.id,
      pago,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
