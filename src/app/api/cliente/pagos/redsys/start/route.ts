import { adminClient } from "@/lib/server/auth-cliente";
import {
  createRedsysSignature,
  encodeMerchantParameters,
  REDSYS_SIGNATURE_VERSION,
  redsysCurrency,
  redsysEndpoint,
  redsysMerchantCode,
  redsysTerminal,
} from "@/lib/server/redsys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request) {
  try {
    const token = String(new URL(req.url).searchParams.get("token") || "").trim();
    if (!token) return new Response("Operación no válida", { status: 400 });

    const admin = adminClient();
    const { data: attempt, error } = await admin
      .from("cliente_payment_attempts")
      .select("id,cliente_id,order_id,pack_id,amount,currency,total_minutes,status")
      .eq("public_token", token)
      .eq("provider", "redsys")
      .maybeSingle();
    if (error) throw error;
    if (!attempt || attempt.status !== "pending") {
      return new Response("Operación no disponible", { status: 404 });
    }

    const appUrl = baseUrl(req);
    const amountCents = String(Math.round(Number(attempt.amount || 0) * 100));
    const parameters = encodeMerchantParameters({
      DS_MERCHANT_AMOUNT: amountCents,
      DS_MERCHANT_ORDER: String(attempt.order_id),
      DS_MERCHANT_MERCHANTCODE: redsysMerchantCode(),
      DS_MERCHANT_CURRENCY: redsysCurrency(),
      DS_MERCHANT_TRANSACTIONTYPE: "0",
      DS_MERCHANT_TERMINAL: redsysTerminal(),
      DS_MERCHANT_MERCHANTURL: `${appUrl}/api/webhooks/redsys`,
      DS_MERCHANT_URLOK: `${appUrl}/cliente/dashboard?checkout=ok`,
      DS_MERCHANT_URLKO: `${appUrl}/cliente/dashboard?checkout=cancelled`,
    });
    const signature = createRedsysSignature(parameters, String(attempt.order_id));

    const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectando con Redsys</title></head>
<body style="font-family:system-ui;background:#090511;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="text-align:center"><p>Conectando con Redsys…</p></div>
  <form id="redsys" method="post" action="${esc(redsysEndpoint())}">
    <input type="hidden" name="Ds_SignatureVersion" value="${REDSYS_SIGNATURE_VERSION}">
    <input type="hidden" name="Ds_MerchantParameters" value="${esc(parameters)}">
    <input type="hidden" name="Ds_Signature" value="${esc(signature)}">
  </form>
  <script>document.getElementById('redsys').submit();</script>
</body></html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("[redsys/start]", error);
    return new Response("No hemos podido iniciar el pago con Redsys", { status: 500 });
  }
}
