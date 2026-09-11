import {
  computeCurrentRankFromSpend,
  createClientNotification,
  monthRange,
  syncClientMonthTag,
  toNum,
} from "@/lib/server/cliente-platform";

export type PromotionPackageSnapshot = {
  kind: "promotion_minute_pack";
  promotion_id: string;
  promotion_name: string;
  package_id: string;
  package_name: string;
  description: string;
  paid_minutes: number;
  free_minutes: number;
  price: number;
  regular_price: number | null;
  currency: "EUR" | "USD";
  roulette_level: 1 | 2 | 3 | null;
  roulette_spins: number;
  coins: number;
  oracle_credits: number;
  extra_benefit: string | null;
  is_recommended: boolean;
};

function asIso(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function promotionIsLive(row: any, now = new Date()) {
  const status = String(row?.status || "").toLowerCase();
  if (!['active', 'scheduled'].includes(status)) return false;
  const start = row?.starts_at ? new Date(row.starts_at) : null;
  const end = row?.ends_at ? new Date(row.ends_at) : null;
  if (start && Number.isFinite(start.getTime()) && start.getTime() > now.getTime()) return false;
  if (!row?.active_until_disabled && end && Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()) return false;
  if (row?.active_until_disabled !== true && row?.ends_at && end && end.getTime() <= now.getTime()) return false;
  return true;
}

export function effectivePromotionStatus(row: any, now = new Date()) {
  const status = String(row?.status || "draft").toLowerCase();
  if (status === "archived" || status === "inactive" || status === "draft") return status;
  const start = row?.starts_at ? new Date(row.starts_at) : null;
  const end = row?.ends_at ? new Date(row.ends_at) : null;
  if (!row?.active_until_disabled && end && Number.isFinite(end.getTime()) && end.getTime() <= now.getTime()) return "finished";
  if (start && Number.isFinite(start.getTime()) && start.getTime() > now.getTime()) return "scheduled";
  return "active";
}

export async function loadActivePromotion(admin: any) {
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: promotions, error } = await admin
    .from("tc_client_promotions")
    .select("*")
    .in("status", ["active", "scheduled"])
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = promotions || [];
  const expired = rows.filter((row: any) => {
    if (row?.active_until_disabled || !row?.ends_at) return false;
    const end = new Date(row.ends_at);
    return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime();
  });
  if (expired.length) {
    await admin.from("tc_client_promotions").update({ status: "finished", deactivated_at: nowIso, updated_at: nowIso }).in("id", expired.map((row: any) => row.id));
  }

  const liveRows = rows.filter((row: any) => promotionIsLive(row, now));
  liveRows.sort((a: any, b: any) => {
    const ta = new Date(a.starts_at || a.activated_at || a.created_at || 0).getTime() || 0;
    const tb = new Date(b.starts_at || b.activated_at || b.created_at || 0).getTime() || 0;
    return tb - ta;
  });
  let live = liveRows[0] || null;
  if (!live) return null;

  // Solo una promoción principal puede quedar visible. Al llegar la hora de una
  // programada, sustituye automáticamente a cualquier campaña anterior.
  const otherLiveIds = liveRows.slice(1).map((row: any) => row.id);
  if (otherLiveIds.length) {
    await admin.from("tc_client_promotions").update({ status: "inactive", deactivated_at: nowIso, updated_at: nowIso }).in("id", otherLiveIds);
  }
  if (String(live.status) === "scheduled") {
    const { data: activated, error: activationError } = await admin.from("tc_client_promotions").update({
      status: "active",
      activated_at: live.activated_at || nowIso,
      deactivated_at: null,
      updated_at: nowIso,
    }).eq("id", live.id).select("*").single();
    if (activationError) throw activationError;
    live = activated;
  }

  const { data: packages, error: packageError } = await admin
    .from("tc_client_promotion_packages")
    .select("*")
    .eq("promotion_id", live.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (packageError) throw packageError;

  return {
    ...live,
    effective_status: effectivePromotionStatus(live),
    packages: packages || [],
  };
}

export function promotionPackageSnapshot(promotion: any, pack: any): PromotionPackageSnapshot {
  return {
    kind: "promotion_minute_pack",
    promotion_id: String(promotion.id),
    promotion_name: String(promotion.name || "Promoción"),
    package_id: String(pack.id),
    package_name: String(pack.name || "Pack promoción"),
    description: String(pack.description || ""),
    paid_minutes: Math.max(0, Number(pack.paid_minutes || 0)),
    free_minutes: Math.max(0, Number(pack.free_minutes || 0)),
    price: Number(pack.price || 0),
    regular_price: pack.regular_price == null ? null : Number(pack.regular_price),
    currency: String(pack.currency || "EUR").toUpperCase() === "USD" ? "USD" : "EUR",
    roulette_level: [1, 2, 3].includes(Number(pack.roulette_level)) ? Number(pack.roulette_level) as 1 | 2 | 3 : null,
    roulette_spins: Math.max(0, Math.floor(Number(pack.roulette_spins || 0))),
    coins: Math.max(0, Math.floor(Number(pack.coins || 0))),
    oracle_credits: Math.max(0, Math.floor(Number(pack.oracle_credits || 0))),
    extra_benefit: pack.extra_benefit ? String(pack.extra_benefit) : null,
    is_recommended: Boolean(pack.is_recommended),
  };
}

export async function applyPromotionMinutePurchase(
  admin: any,
  params: {
    clienteId: string;
    snapshot: PromotionPackageSnapshot;
    paymentRef: string;
    paymentIntent?: string | null;
    amount: number;
    currency: "EUR" | "USD";
  },
) {
  const snap = params.snapshot;
  if (snap.kind !== "promotion_minute_pack") throw new Error("PROMOTION_SNAPSHOT_INVALID");
  if (Math.abs(Number(params.amount) - Number(snap.price)) > 0.001) throw new Error("PROMOTION_AMOUNT_MISMATCH");
  if (params.currency !== snap.currency) throw new Error("PROMOTION_CURRENCY_MISMATCH");

  const totalMinutes = snap.paid_minutes + snap.free_minutes;
  const { data: transaction, error: transactionError } = await admin.rpc("cliente_confirmar_compra_ruleta_v3", {
    p: {
      cliente_id: params.clienteId,
      payment_ref: params.paymentRef,
      stripe_session_id: null,
      payment_intent: params.paymentIntent || null,
      amount: params.amount,
      currency: params.currency,
      metodo: "mollie_promotion",
      pack_id: `promo:${snap.package_id}`,
      pack_name: `${snap.promotion_name} · ${snap.package_name}`,
      free: snap.free_minutes,
      normal: snap.paid_minutes,
      points: snap.coins,
      oracle_credits: snap.oracle_credits,
      roulette_spins: snap.roulette_spins,
      notas: `Compra promoción · ${snap.promotion_name} · ${snap.package_name}`,
    },
  });
  if (transactionError) throw transactionError;

  const payment = transaction?.payment;
  if (payment?.id && snap.roulette_spins > 0 && snap.roulette_level) {
    const { error: spinError } = await admin
      .from("cliente_ruleta_giros")
      .update({ nivel: snap.roulette_level })
      .eq("purchase_id", payment.id);
    if (spinError) throw spinError;
  }

  if (transaction?.duplicated) return { ok: true, ...transaction };

  const nowIso = new Date().toISOString();
  const { start, end } = monthRange(new Date());
  const { data: monthPayments, error: monthError } = await admin
    .from("crm_cliente_pagos")
    .select("id,importe,estado")
    .eq("cliente_id", params.clienteId)
    .eq("estado", "completed")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (monthError) throw monthError;

  const monthlySpend = (monthPayments || []).reduce((acc: number, row: any) => acc + toNum(row?.importe), 0);
  const monthlyPurchases = (monthPayments || []).length;
  const nextRank = computeCurrentRankFromSpend(monthlySpend, monthlyPurchases);
  await syncClientMonthTag(admin, params.clienteId);

  const benefitBits = [
    `${snap.paid_minutes} min`,
    snap.free_minutes ? `+${snap.free_minutes} min GRATIS` : null,
    snap.coins ? `+${snap.coins} Coins` : null,
    snap.roulette_spins && snap.roulette_level ? `+${snap.roulette_spins} giro${snap.roulette_spins === 1 ? "" : "s"} Nivel ${snap.roulette_level}` : null,
    snap.oracle_credits ? `+${snap.oracle_credits} tirada${snap.oracle_credits === 1 ? "" : "s"} de Oráculo` : null,
  ].filter(Boolean).join(" · ");

  await createClientNotification(admin, {
    cliente_id: params.clienteId,
    tipo: "purchase_completed",
    titulo: `Promoción aplicada: ${snap.promotion_name}`,
    mensaje: `${snap.package_name} confirmada. ${benefitBits}.`,
    meta: {
      promotion_id: snap.promotion_id,
      package_id: snap.package_id,
      snapshot: snap,
      payment_reference: params.paymentRef,
    },
  });

  try {
    const { data: cliente } = await admin.from("crm_clientes").select("nombre,apellido").eq("id", params.clienteId).maybeSingle();
    const name = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente";
    await admin.from("notifications").insert({
      type: "cliente_payment_completed",
      title: "Compra de promoción completada",
      message: `${name} compró ${snap.promotion_name} · ${snap.package_name} por ${params.amount.toFixed(2)} ${params.currency}.`,
      cliente_id: params.clienteId,
      read: false,
      created_at: nowIso,
    });
  } catch {
    // Notificación interna opcional.
  }

  return { ok: true, duplicated: false, payment, rank: nextRank, monthlySpend, monthlyPurchases, totalMinutes };
}

export function normalizePromotionDate(value: unknown) {
  return asIso(value);
}
