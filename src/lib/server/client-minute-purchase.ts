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
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("IMPORTE_CONFIRMADO_INVALIDO");
  const totalMinutes = Number(pack.totalMinutes);
  const minutesSplit = splitMinutes(totalMinutes);
  const puntosGanados = pack.rewardCoins ?? pointsFromAmount(amount);

  const { data: transaction, error: transactionError } = await admin.rpc("cliente_confirmar_compra_ruleta_v3", {
    p: { cliente_id: params.clienteId, payment_ref: params.paymentRef,
      stripe_session_id: params.stripeSessionId || null, payment_intent: params.paymentIntent || null,
      amount, currency, metodo, pack_id: pack.id, pack_name: pack.nombre,
      free: minutesSplit.free, normal: minutesSplit.normal, points: puntosGanados,
      oracle_credits: pack.oracleCredits || 0,
      roulette_spins: pack.rouletteSpins,
      notas: params.notas || "Compra automatizada desde panel cliente · " + pack.nombre },
  });
  if (transactionError) throw transactionError;
  const pago = transaction.payment;
  const { data: clienteActual } = await admin.from("crm_clientes").select("nombre,apellido").eq("id", params.clienteId).maybeSingle();
  const { data: grantedSpins } = await admin.from("cliente_ruleta_giros").select("id,nivel").eq("purchase_id", pago.id).order("created_at", { ascending: true });
  if (transaction.duplicated) return { ok: true, ...transaction, spins: grantedSpins || [] };

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
    mensaje: `Tu compra ${pack.nombre} ya está activa. Hemos añadido ${totalMinutes} minutos, +${puntosGanados} Coins${pack.oracleCredits ? `, +${pack.oracleCredits} tirada${pack.oracleCredits === 1 ? "" : "s"} de Oráculo` : ""} y ${pack.rouletteSpins} giro${pack.rouletteSpins === 1 ? "" : "s"} Nivel ${pack.rouletteLevel}.`,
    meta: {
      pack_id: pack.id,
      pack_name: pack.nombre,
      total_minutes: totalMinutes,
      roulette_level: pack.rouletteLevel,
      roulette_spins: pack.rouletteSpins,
      oracle_credits: pack.oracleCredits || 0,
      coins: puntosGanados,
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
