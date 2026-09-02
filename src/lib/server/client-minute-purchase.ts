import {
  computeCurrentRankFromSpend,
  createClientNotification,
  monthRange,
  pointsFromAmount,
  splitMinutes,
  syncClientMonthTag,
  toNum,
} from "@/lib/server/cliente-platform";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";

export type ClientPurchaseCurrency = "USD" | "EUR";

export async function applyConfiguredMinutePurchase(
  admin: any,
  params: {
    clienteId: string;
    packId: string;
    paymentRef: string;
    paymentIntent?: string | null;
    stripeSessionId?: string | null;
    amount: number;
    currency: ClientPurchaseCurrency;
    metodo?: string;
    notas?: string;
  },
) {
  const pack = getConfiguredMinutePack(params.packId);
  if (!pack) throw new Error("PACK_NO_ENCONTRADO");

  const nowIso = new Date().toISOString();
  const metodo = String(params.metodo || "stripe_checkout");
  const currency: ClientPurchaseCurrency = params.currency === "EUR" ? "EUR" : "USD";
  const amount = Number(params.amount || pack.priceUsd);
  const totalMinutes = Number(pack.totalMinutes);
  const minutesSplit = splitMinutes(totalMinutes);
  const puntosGanados = pointsFromAmount(amount);

  // Idempotencia: un mismo identificador externo no vuelve a acreditar la compra.
  const { data: existingPayment, error: existingPaymentError } = await admin
    .from("crm_cliente_pagos")
    .select("id, referencia_externa, cliente_id")
    .eq("referencia_externa", params.paymentRef)
    .maybeSingle();
  if (existingPaymentError) throw existingPaymentError;
  if (existingPayment?.id) {
    return { ok: true, duplicated: true, payment: existingPayment };
  }

  const { data: clienteActual, error: clienteError } = await admin
    .from("crm_clientes")
    .select("id, nombre, apellido, puntos, minutos_free_pendientes, minutos_normales_pendientes")
    .eq("id", params.clienteId)
    .maybeSingle();
  if (clienteError) throw clienteError;
  if (!clienteActual?.id) throw new Error("CLIENTE_NO_EXISTE");

  const { data: pago, error: pagoError } = await admin
    .from("crm_cliente_pagos")
    .insert({
      cliente_id: params.clienteId,
      importe: amount,
      moneda: currency,
      metodo,
      estado: "completed",
      notas: params.notas || `Compra automatizada desde panel cliente · ${pack.nombre}`,
      referencia_externa: params.paymentRef,
      pack_id: pack.id,
      pack_name: pack.nombre,
      paid_minutes: totalMinutes,
      bonus_minutes: 0,
      stripe_session_id: params.stripeSessionId || null,
      payment_intent: params.paymentIntent || null,
      created_by_user_id: null,
      created_by_role: "cliente_webhook",
    })
    .select("*")
    .single();
  if (pagoError) throw pagoError;

  await admin
    .from("crm_clientes")
    .update({
      minutos_free_pendientes: toNum(clienteActual.minutos_free_pendientes) + minutesSplit.free,
      minutos_normales_pendientes: toNum(clienteActual.minutos_normales_pendientes) + minutesSplit.normal,
      puntos: toNum(clienteActual.puntos) + puntosGanados,
      updated_at: nowIso,
    })
    .eq("id", params.clienteId);

  await admin.from("cliente_puntos_historial").insert({
    cliente_id: params.clienteId,
    tipo: "ganado",
    puntos: puntosGanados,
    descripcion: `Compra ${pack.nombre} (${amount.toFixed(2)} ${currency}) → +${puntosGanados} puntos.`,
    created_at: nowIso,
  });

  const { start, end } = monthRange(new Date());
  const { data: monthPayments, error: monthPaymentsError } = await admin
    .from("crm_cliente_pagos")
    .select("id, importe, estado")
    .eq("cliente_id", params.clienteId)
    .eq("estado", "completed")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (monthPaymentsError) throw monthPaymentsError;

  const monthlySpend = (monthPayments || []).reduce(
    (acc: number, row: any) => acc + toNum(row?.importe),
    0,
  );
  const monthlyPurchases = (monthPayments || []).length;
  const nextRank = computeCurrentRankFromSpend(monthlySpend, monthlyPurchases);

  await syncClientMonthTag(admin, params.clienteId);

  await createClientNotification(admin, {
    cliente_id: params.clienteId,
    tipo: "purchase_completed",
    titulo: "Pago confirmado",
    mensaje: `Tu compra ${pack.nombre} ya está activa. Hemos añadido ${totalMinutes} minutos, +${puntosGanados} puntos y 1 giro de Ruleta Celestial a tu cuenta.`,
    meta: {
      pack_id: pack.id,
      pack_name: pack.nombre,
      total_minutes: totalMinutes,
      roulette_level: totalMinutes <= 30 ? 1 : 2,
      payment_intent: params.paymentIntent || null,
      stripe_session_id: params.stripeSessionId || null,
      payment_reference: params.paymentRef,
      currency,
    },
  });

  const nombre = [clienteActual?.nombre, clienteActual?.apellido]
    .filter(Boolean)
    .join(" ")
    .trim() || "Cliente";

  try {
    await admin.from("notifications").insert({
      type: "cliente_payment_completed",
      title: "Compra completada en panel cliente",
      message: `${nombre} compró ${pack.nombre} por ${amount.toFixed(2)} ${currency}.`,
      cliente_id: params.clienteId,
      read: false,
      created_at: nowIso,
    });
  } catch {
    // La notificación interna es opcional y no debe bloquear la acreditación.
  }

  return {
    ok: true,
    duplicated: false,
    payment: pago,
    rank: nextRank,
    monthlySpend,
    monthlyPurchases,
  };
}
