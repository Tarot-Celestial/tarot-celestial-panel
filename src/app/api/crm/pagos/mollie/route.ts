import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { gateCentralOrAdmin } from "@/lib/gate";
import { adminClient } from "@/lib/server/auth-cliente";
import { CLIENTE_MINUTE_PACKS, getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { createMolliePayment, getMolliePayment } from "@/lib/server/mollie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANUAL_PACK_ID = "crm_manual_amount";
const headers = { "Cache-Control": "private, no-store" };

function baseUrl(req: Request) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || url.host;
  const protocol = forwardedProto || url.protocol.replace(":", "") || "https";
  return `${protocol}://${host}`;
}

function publicPack(pack: (typeof CLIENTE_MINUTE_PACKS)[number]) {
  return {
    id: pack.id,
    nombre: pack.nombre,
    descripcion: pack.descripcion,
    amount: pack.priceUsd,
    total_minutes: pack.totalMinutes,
    roulette_level: pack.rouletteLevel,
    roulette_spins: pack.rouletteSpins,
    coins: pack.rewardCoins || 0,
    oracle_credits: pack.oracleCredits || 0,
    highlight: Boolean(pack.highlight),
  };
}

export async function GET(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401, headers });

    const attemptId = String(new URL(req.url).searchParams.get("attempt_id") || "").trim();
    if (!attemptId) {
      return NextResponse.json({
        ok: true,
        packs: CLIENTE_MINUTE_PACKS.map(publicPack),
        manual_pack_id: MANUAL_PACK_ID,
      }, { headers });
    }

    const admin = adminClient();
    const { data: attempt, error } = await admin
      .from("cliente_payment_attempts")
      .select("id,cliente_id,provider,order_id,pack_id,amount,currency,total_minutes,status,provider_response,last_error,completed_at,created_at,updated_at")
      .eq("id", attemptId)
      .eq("provider", "mollie")
      .maybeSingle();
    if (error) throw error;
    if (!attempt) return NextResponse.json({ ok: false, error: "COBRO_NO_ENCONTRADO" }, { status: 404, headers });

    let remoteStatus = "";
    if (["pending", "processing"].includes(String(attempt.status || "")) && String(attempt.order_id || "").startsWith("tr_")) {
      try {
        const remote = await getMolliePayment(String(attempt.order_id));
        remoteStatus = String(remote?.status || "");
      } catch {
        // El estado local sigue siendo la fuente operativa; Mollie puede estar temporalmente inaccesible.
      }
    }

    const checkoutUrl = String((attempt.provider_response as any)?._links?.checkout?.href || "").trim();
    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        cliente_id: attempt.cliente_id,
        pack_id: attempt.pack_id,
        amount: Number(attempt.amount || 0),
        currency: attempt.currency || "EUR",
        total_minutes: Number(attempt.total_minutes || 0),
        status: attempt.status,
        remote_status: remoteStatus || null,
        payment_id: String(attempt.order_id || "").startsWith("tr_") ? attempt.order_id : null,
        checkout_url: checkoutUrl || null,
        last_error: attempt.last_error || null,
        completed_at: attempt.completed_at || null,
        created_at: attempt.created_at || null,
        updated_at: attempt.updated_at || null,
      },
    }, { headers });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR_MOLLIE_CRM_STATUS" }, { status: 500, headers });
  }
}

export async function POST(req: Request) {
  let attemptId = "";
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401, headers });

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body?.cliente_id || "").trim();
    const requestedPackId = String(body?.pack_id || "").trim();
    const manualAmount = Number(String(body?.manual_amount ?? "").replace(",", "."));
    const notes = String(body?.notes || "").trim().slice(0, 500);
    if (!clienteId) return NextResponse.json({ ok: false, error: "FALTA_CLIENTE_ID" }, { status: 400, headers });

    const pack = requestedPackId ? getConfiguredMinutePack(requestedPackId) : null;
    const isManual = !pack;
    if (requestedPackId && !pack && requestedPackId !== MANUAL_PACK_ID) {
      return NextResponse.json({ ok: false, error: "PACK_NO_ENCONTRADO" }, { status: 400, headers });
    }
    if (isManual && (!Number.isFinite(manualAmount) || manualAmount <= 0)) {
      return NextResponse.json({ ok: false, error: "Introduce un importe manual válido." }, { status: 400, headers });
    }

    const amount = pack ? Number(pack.priceUsd) : Math.round(manualAmount * 100) / 100;
    if (amount > 5000) return NextResponse.json({ ok: false, error: "El importe supera el límite permitido para este cobrador." }, { status: 400, headers });

    const admin = adminClient();
    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id,nombre,apellido,telefono,telefono_normalizado,pais,email")
      .eq("id", clienteId)
      .maybeSingle();
    if (clienteError) throw clienteError;
    if (!cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_EXISTE" }, { status: 404, headers });

    const appUrl = baseUrl(req);
    const internalOrder = `crm-mollie-init-${randomUUID()}`;
    const packId = pack?.id || MANUAL_PACK_ID;
    const totalMinutes = pack?.totalMinutes || 0;
    const { data: attempt, error: attemptError } = await admin
      .from("cliente_payment_attempts")
      .insert({
        cliente_id: clienteId,
        provider: "mollie",
        order_id: internalOrder,
        public_token: randomUUID(),
        pack_id: packId,
        amount,
        currency: "EUR",
        total_minutes: totalMinutes,
        status: "pending",
      })
      .select("id")
      .single();
    if (attemptError) throw attemptError;
    attemptId = String(attempt?.id || "");

    const workerId = String(gate.me?.worker?.id || gate.me?.id || "").trim();
    const workerRole = String(gate.me?.role || "").trim();
    const workerName = String(gate.me?.display_name || gate.me?.email || "Central").trim();
    const customerName = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ").trim() || "Clienta";
    const description = pack
      ? `Tarot Celestial · ${pack.nombre}`
      : `Tarot Celestial · Cobro personalizado ${amount.toFixed(2)} €`;

    const { payment, checkoutUrl } = await createMolliePayment({
      amount,
      currency: "EUR",
      description,
      redirectUrl: `${appUrl}/pago-confirmado`,
      webhookUrl: `${appUrl}/api/webhooks/mollie`,
      metadata: {
        source: "crm_cobrador",
        attempt_id: attemptId,
        cliente_id: clienteId,
        pack_id: packId,
        total_minutes: totalMinutes,
        manual_amount: isManual,
        notes: notes || null,
        initiated_by_worker_id: workerId || null,
        initiated_by_role: workerRole || null,
        initiated_by_name: workerName || null,
      },
    });

    const { error: updateError } = await admin
      .from("cliente_payment_attempts")
      .update({
        order_id: payment.id,
        provider_response: payment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attemptId);
    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      attempt_id: attemptId,
      payment_id: payment.id,
      url: checkoutUrl,
      amount,
      currency: "EUR",
      pack: pack ? publicPack(pack) : null,
      manual: isManual,
      cliente: {
        id: cliente.id,
        nombre: customerName,
        telefono: cliente.telefono_normalizado || cliente.telefono || "",
        pais: cliente.pais || "",
      },
    }, { headers });
  } catch (error: any) {
    console.error("[crm/pagos/mollie]", error);
    if (attemptId) {
      try {
        await adminClient()
          .from("cliente_payment_attempts")
          .update({ status: "failed", last_error: error?.message || "ERR_MOLLIE_CRM", updated_at: new Date().toISOString() })
          .eq("id", attemptId);
      } catch {
        // Conservamos el error original.
      }
    }
    return NextResponse.json({ ok: false, error: error?.message || "ERR_MOLLIE_CRM" }, { status: 500, headers });
  }
}
