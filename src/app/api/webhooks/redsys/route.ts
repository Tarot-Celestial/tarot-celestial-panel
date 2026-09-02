import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server/auth-cliente";
import { applyClientPurchase } from "@/lib/server/cliente-platform";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { decodeMerchantParameters, verifyRedsysSignature } from "@/lib/server/redsys";

export const runtime = "nodejs";

function readParam(params: Record<string, any>, ...names: string[]) {
  for (const name of names) {
    const direct = params?.[name];
    if (direct !== undefined && direct !== null) return String(direct);
    const found = Object.keys(params || {}).find((key) => key.toLowerCase() === name.toLowerCase());
    if (found) return String(params[found]);
  }
  return "";
}

export async function POST(req: Request) {
  const admin = adminClient();
  let attemptId = "";

  try {
    const form = await req.formData();
    const merchantParameters = String(form.get("Ds_MerchantParameters") || "");
    const signature = String(form.get("Ds_Signature") || "");
    if (!merchantParameters || !signature) {
      return NextResponse.json({ ok: false, error: "REDSYS_PAYLOAD_INVALIDO" }, { status: 400 });
    }

    const params = decodeMerchantParameters(merchantParameters);
    const orderId = readParam(params, "Ds_Order", "DS_ORDER", "DS_MERCHANT_ORDER");
    if (!orderId || !verifyRedsysSignature(merchantParameters, signature, orderId)) {
      return NextResponse.json({ ok: false, error: "REDSYS_SIGNATURE_INVALIDA" }, { status: 400 });
    }

    const responseCode = Number(readParam(params, "Ds_Response", "DS_RESPONSE"));
    const approved = Number.isFinite(responseCode) && responseCode >= 0 && responseCode <= 99;

    const { data: existing, error: loadError } = await admin
      .from("cliente_payment_attempts")
      .select("*")
      .eq("provider", "redsys")
      .eq("order_id", orderId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!existing) return NextResponse.json({ ok: false, error: "REDSYS_ORDER_NOT_FOUND" }, { status: 404 });
    attemptId = String(existing.id || "");

    if (!approved) {
      await admin.from("cliente_payment_attempts").update({
        status: "failed",
        provider_response: params,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
      return NextResponse.json({ ok: true, approved: false });
    }

    if (existing.status === "completed") return NextResponse.json({ ok: true, approved: true, duplicate: true });

    const { data: locked, error: lockError } = await admin
      .from("cliente_payment_attempts")
      .update({ status: "processing", provider_response: params, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .in("status", ["pending", "failed"])
      .select("*")
      .maybeSingle();
    if (lockError) throw lockError;
    if (!locked) return NextResponse.json({ ok: true, approved: true, duplicate: true });

    const pack = getConfiguredMinutePack(locked.pack_id);
    if (!pack) throw new Error("PACK_REDSYS_NO_ENCONTRADO");

    await applyClientPurchase(admin, {
      clienteId: locked.cliente_id,
      packId: String(pack.id),
      paymentRef: `redsys:${orderId}`,
      paymentIntent: readParam(params, "Ds_AuthorisationCode", "DS_AUTHORISATIONCODE") || null,
      stripeSessionId: null,
      amountUsd: Number(locked.amount || pack.priceUsd),
      totalMinutes: Number(locked.total_minutes || pack.totalMinutes),
      metodo: "redsys_checkout",
      notas: `Redsys completado · ${pack.nombre}`,
    });

    await Promise.allSettled([
      admin.from("cliente_payment_attempts").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        provider_response: params,
        updated_at: new Date().toISOString(),
      }).eq("id", locked.id),
      admin.from("crm_client_notes").insert({
        cliente_id: locked.cliente_id,
        texto: `🟣 Compra web: ha comprado ${pack.nombre} (${Number(locked.amount || pack.priceUsd).toFixed(2)} USD) mediante Redsys`,
        author_user_id: null,
        author_name: "Sistema",
        author_email: null,
        is_pinned: false,
      }),
    ]);

    return NextResponse.json({ ok: true, approved: true });
  } catch (error: any) {
    console.error("[webhooks/redsys]", error);
    if (attemptId) {
      try {
        await admin.from("cliente_payment_attempts").update({ status: "pending", last_error: error?.message || "ERR_REDSYS", updated_at: new Date().toISOString() }).eq("id", attemptId).eq("status", "processing");
      } catch {}
    }
    return NextResponse.json({ ok: false, error: error?.message || "ERR_REDSYS_WEBHOOK" }, { status: 500 });
  }
}
